class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const requestedChunkSeconds =
      options?.processorOptions?.chunkSeconds ?? 1;

    this.framesPerMessage = Math.max(
      128,
      Math.floor(sampleRate * requestedChunkSeconds)
    );

    this.buffer = new Float32Array(this.framesPerMessage);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];

    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }

    const channelCount = input.length;
    const frameCount = input[0].length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      let monoSample = 0;

      for (let channel = 0; channel < channelCount; channel += 1) {
        monoSample += input[channel][frame] ?? 0;
      }

      monoSample /= channelCount;
      this.buffer[this.offset] = monoSample;
      this.offset += 1;

      if (this.offset === this.buffer.length) {
        const completedBuffer = this.buffer;
        this.port.postMessage(completedBuffer, [completedBuffer.buffer]);

        this.buffer = new Float32Array(this.framesPerMessage);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
