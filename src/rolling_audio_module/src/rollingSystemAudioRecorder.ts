export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "stopped"
  | "error";

export interface TranscriptionResponse {
  text?: string;
  [key: string]: unknown;
}

export interface RollingSystemAudioRecorderOptions {
  /** Endpoint che riceve multipart/form-data. */
  uploadUrl: string;

  /** URL pubblico del file pcm-capture-processor.js. */
  workletModuleUrl: string;

  /** Durata massima conservata nel buffer. Default: 60 secondi. */
  windowSeconds?: number;

  /** Frequenza degli invii. Default: 20 secondi. */
  uploadEverySeconds?: number;

  /** Identificativo della sessione/test. */
  sessionId?: string;

  /** Timeout di ogni richiesta HTTP. Default: 60 secondi. */
  requestTimeoutMs?: number;

  onStatusChange?: (status: RecorderStatus, detail?: string) => void;
  onTranscription?: (response: TranscriptionResponse) => void;
  onError?: (error: Error) => void;
}

interface DisplayCaptureOptions extends DisplayMediaStreamOptions {
  systemAudio?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
}

export class RollingSystemAudioRecorder {
  private readonly options: Required<
    Pick<
      RollingSystemAudioRecorderOptions,
      | "windowSeconds"
      | "uploadEverySeconds"
      | "requestTimeoutMs"
      | "sessionId"
    >
  > &
    RollingSystemAudioRecorderOptions;

  private displayStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentGainNode: GainNode | null = null;
  private uploadTimer: number | null = null;

  private pcmChunks: Float32Array[] = [];
  private totalSamples = 0;
  private sequence = 0;
  private running = false;
  private uploadInProgress = false;
  private uploadPending = false;
  private lastSuccessfulUploadAtMs: number | null = null;

  constructor(options: RollingSystemAudioRecorderOptions) {
    if (!options.uploadUrl) {
      throw new Error("uploadUrl è obbligatorio.");
    }

    if (!options.workletModuleUrl) {
      throw new Error("workletModuleUrl è obbligatorio.");
    }

    this.options = {
      ...options,
      windowSeconds: options.windowSeconds ?? 60,
      uploadEverySeconds: options.uploadEverySeconds ?? 20,
      requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
      sessionId: options.sessionId ?? crypto.randomUUID(),
    };

    if (this.options.windowSeconds <= 0) {
      throw new Error("windowSeconds deve essere maggiore di zero.");
    }

    if (this.options.uploadEverySeconds <= 0) {
      throw new Error("uploadEverySeconds deve essere maggiore di zero.");
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  get bufferedSeconds(): number {
    if (!this.audioContext) return 0;
    return this.totalSamples / this.audioContext.sampleRate;
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        "Questo browser non supporta navigator.mediaDevices.getDisplayMedia()."
      );
    }

    this.emitStatus("requesting-permission");

    try {
      const captureOptions: DisplayCaptureOptions = {
        video: true,
        audio: true,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      };

      const displayStream = await navigator.mediaDevices.getDisplayMedia(
        captureOptions
      );

      const audioTracks = displayStream.getAudioTracks();

      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach((track) => track.stop());
        throw new Error(
          "Nessuna traccia audio ricevuta. Seleziona una scheda o uno schermo e abilita 'Condividi audio'."
        );
      }

      this.displayStream = displayStream;
      this.audioContext = new AudioContext({ latencyHint: "interactive" });

      await this.audioContext.audioWorklet.addModule(
        this.options.workletModuleUrl
      );
      await this.audioContext.resume();

      const audioOnlyStream = new MediaStream(audioTracks);
      this.sourceNode =
        this.audioContext.createMediaStreamSource(audioOnlyStream);

      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "pcm-capture-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            chunkSeconds: 1,
          },
        }
      );

      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;

      this.workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!(event.data instanceof Float32Array)) return;
        this.appendPcm(event.data);
      };

      this.sourceNode
        .connect(this.workletNode)
        .connect(this.silentGainNode)
        .connect(this.audioContext.destination);

      this.running = true;
      this.sequence = 0;
      this.pcmChunks = [];
      this.totalSamples = 0;
      this.lastSuccessfulUploadAtMs = null;

      for (const track of displayStream.getTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (this.running) {
              void this.stop(false);
            }
          },
          { once: true }
        );
      }

      this.uploadTimer = window.setInterval(() => {
        void this.requestUpload();
      }, this.options.uploadEverySeconds * 1000);

      this.emitStatus("recording");
    } catch (error) {
      await this.cleanup();
      const normalized = this.normalizeError(error);
      this.emitStatus("error", normalized.message);
      this.options.onError?.(normalized);
      throw normalized;
    }
  }

  /**
   * Interrompe la cattura. Se flush=true, prova prima a inviare l'audio
   * attualmente presente nel buffer.
   */
  async stop(flush = true): Promise<void> {
    if (!this.running && !this.displayStream && !this.audioContext) return;

    this.running = false;

    if (this.uploadTimer !== null) {
      window.clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }

    if (flush && this.totalSamples > 0) {
      try {
        await this.uploadCurrentWindow();
      } catch (error) {
        const normalized = this.normalizeError(error);
        this.options.onError?.(normalized);
      }
    }

    await this.cleanup();
    this.emitStatus("stopped");
  }

  /** Forza manualmente un invio dell'ultima finestra disponibile. */
  async flush(): Promise<void> {
    await this.requestUpload();
  }

  private appendPcm(chunk: Float32Array): void {
    if (!this.audioContext || chunk.length === 0) return;

    this.pcmChunks.push(chunk);
    this.totalSamples += chunk.length;

    const maxSamples = Math.floor(
      this.audioContext.sampleRate * this.options.windowSeconds
    );

    while (this.totalSamples > maxSamples && this.pcmChunks.length > 0) {
      const excessSamples = this.totalSamples - maxSamples;
      const oldest = this.pcmChunks[0];

      if (oldest.length <= excessSamples) {
        this.pcmChunks.shift();
        this.totalSamples -= oldest.length;
      } else {
        this.pcmChunks[0] = oldest.slice(excessSamples);
        this.totalSamples -= excessSamples;
      }
    }
  }

  private async requestUpload(): Promise<void> {
    if (!this.running || this.totalSamples === 0) return;

    if (this.uploadInProgress) {
      this.uploadPending = true;
      return;
    }

    await this.uploadCurrentWindow();
  }

  private async uploadCurrentWindow(): Promise<void> {
    if (!this.audioContext || this.totalSamples === 0) return;

    this.uploadInProgress = true;
    this.uploadPending = false;
    this.emitStatus("uploading");

    const sampleRate = this.audioContext.sampleRate;
    const snapshot = this.copyCurrentSamples();
    const windowSeconds = snapshot.length / sampleRate;
    const sequence = this.sequence;
    this.sequence += 1;

    const capturedAtMs = Date.now();
    const elapsedSinceLastUpload =
      this.lastSuccessfulUploadAtMs === null
        ? windowSeconds
        : (capturedAtMs - this.lastSuccessfulUploadAtMs) / 1000;
    const newAudioSeconds = Math.min(
      windowSeconds,
      Math.max(0.001, elapsedSinceLastUpload)
    );

    const wavBlob = encodeMonoPcm16Wav(snapshot, sampleRate);
    const formData = new FormData();
    const filename = `${this.options.sessionId}-${sequence}.wav`;

    formData.append("audio", wavBlob, filename);
    formData.append("session_id", this.options.sessionId);
    formData.append("sequence", String(sequence));
    formData.append("window_seconds", windowSeconds.toFixed(3));
    formData.append("new_audio_seconds", newAudioSeconds.toFixed(3));
    formData.append("sample_rate", String(sampleRate));
    formData.append("captured_at", new Date(capturedAtMs).toISOString());

    const abortController = new AbortController();
    const timeout = window.setTimeout(
      () => abortController.abort(),
      this.options.requestTimeoutMs
    );

    try {
      const response = await fetch(this.options.uploadUrl, {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Trascrizione fallita (${response.status}): ${body || response.statusText}`
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const result: TranscriptionResponse = contentType.includes(
        "application/json"
      )
        ? ((await response.json()) as TranscriptionResponse)
        : { text: await response.text() };

      this.lastSuccessfulUploadAtMs = capturedAtMs;
      this.options.onTranscription?.(result);
    } catch (error) {
      const normalized = this.normalizeError(error);
      this.emitStatus("error", normalized.message);
      this.options.onError?.(normalized);
      throw normalized;
    } finally {
      window.clearTimeout(timeout);
      this.uploadInProgress = false;

      if (this.running) {
        this.emitStatus("recording");
      }

      if (this.uploadPending && this.running) {
        this.uploadPending = false;
        queueMicrotask(() => {
          void this.requestUpload();
        });
      }
    }
  }

  private copyCurrentSamples(): Float32Array {
    const output = new Float32Array(this.totalSamples);
    let offset = 0;

    for (const chunk of this.pcmChunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    return output;
  }

  private async cleanup(): Promise<void> {
    if (this.uploadTimer !== null) {
      window.clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }

    try {
      this.sourceNode?.disconnect();
      this.workletNode?.disconnect();
      this.silentGainNode?.disconnect();
    } catch {
      // I nodi potrebbero essere già disconnessi.
    }

    this.workletNode?.port.close();

    this.displayStream?.getTracks().forEach((track) => track.stop());

    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }

    this.displayStream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.silentGainNode = null;
    this.pcmChunks = [];
    this.totalSamples = 0;
    this.uploadInProgress = false;
    this.uploadPending = false;
    this.lastSuccessfulUploadAtMs = null;
  }

  private emitStatus(status: RecorderStatus, detail?: string): void {
    this.options.onStatusChange?.(status, detail);
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Error("Timeout durante l'invio dell'audio al trascrittore.");
    }

    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}

function encodeMonoPcm16Wav(
  samples: Float32Array,
  sampleRate: number
): Blob {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;

  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcmValue =
      clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);

    view.setInt16(offset, pcmValue, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
