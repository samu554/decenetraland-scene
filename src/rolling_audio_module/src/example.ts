import { RollingSystemAudioRecorder } from "./rollingSystemAudioRecorder";

const startButton = document.querySelector<HTMLButtonElement>("#start-audio");
const stopButton = document.querySelector<HTMLButtonElement>("#stop-audio");
const statusElement = document.querySelector<HTMLElement>("#audio-status");
const transcriptElement = document.querySelector<HTMLElement>("#transcript");

if (!startButton || !stopButton || !statusElement || !transcriptElement) {
  throw new Error("Elementi HTML mancanti.");
}

const recorder = new RollingSystemAudioRecorder({
  uploadUrl: "http://localhost:8000/transcribe",
  workletModuleUrl: "/pcm-capture-processor.js",
  windowSeconds: 60,
  uploadEverySeconds: 20,
  sessionId: `test-${Date.now()}`,

  onStatusChange: (status, detail) => {
    statusElement.textContent = detail ? `${status}: ${detail}` : status;
  },

  onTranscription: (response) => {
    if (typeof response.text === "string") {
      transcriptElement.textContent = response.text;
    }

    console.log("Risposta trascrizione:", response);
  },

  onError: (error) => {
    console.error(error);
  },
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;

  try {
    await recorder.start();
    stopButton.disabled = false;
  } catch {
    startButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  await recorder.stop(true);
  startButton.disabled = false;
});
