from __future__ import annotations

import asyncio
import csv
import os
import re
import tempfile
import threading
import time
import wave
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent
TRANSCRIPTIONS_DIR = Path(
    os.getenv("TRANSCRIPTIONS_DIR", str(BASE_DIR / "transcriptions"))
).resolve()
TRANSCRIPTIONS_DIR.mkdir(parents=True, exist_ok=True)

# Finestre audio usate dal classificatore multimodale. Ogni richiesta salva
# soltanto la coda nuova (massimo 20 secondi), evitando sovrapposizioni tra
# un'analisi e la successiva.
AUDIO_WINDOWS_DIR = Path(
    os.getenv("AUDIO_WINDOWS_DIR", str(TRANSCRIPTIONS_DIR / "audio-windows"))
).resolve()
AUDIO_WINDOWS_DIR.mkdir(parents=True, exist_ok=True)
SENTIMENT_CHUNK_SECONDS = max(
    0.5, float(os.getenv("SENTIMENT_CHUNK_SECONDS", "20"))
)

# "auto" usa CUDA quando CTranslate2 rileva una GPU NVIDIA configurata,
# altrimenti passa automaticamente alla CPU.
REQUESTED_MODEL = os.getenv("WHISPER_MODEL", "auto").strip()
REQUESTED_DEVICE = os.getenv("WHISPER_DEVICE", "auto").strip().lower()
REQUESTED_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "auto").strip().lower()
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "en").strip() or None
WHISPER_BEAM_SIZE = max(1, int(os.getenv("WHISPER_BEAM_SIZE", "3")))
WHISPER_CONTEXT_SECONDS = max(0.0, float(os.getenv("WHISPER_CONTEXT_SECONDS", "8")))
WHISPER_CPU_THREADS = max(0, int(os.getenv("WHISPER_CPU_THREADS", "0")))
WHISPER_WARMUP = os.getenv("WHISPER_WARMUP", "1").strip() not in {"0", "false", "False"}
WHISPER_VAD_MIN_SILENCE_MS = max(
    100, int(os.getenv("WHISPER_VAD_MIN_SILENCE_MS", "350"))
)

_model: Any | None = None
_runtime: "WhisperRuntime | None" = None
_model_lock = threading.Lock()
_csv_lock = threading.Lock()
_inference_lock = threading.Lock()


@dataclass(frozen=True)
class WhisperRuntime:
    model: str
    device: str
    compute_type: str
    gpu_count: int
    supported_compute_types: tuple[str, ...]


def resolve_whisper_runtime() -> WhisperRuntime:
    """Sceglie GPU/CPU, modello e precisione senza dipendere da PyTorch."""
    if REQUESTED_DEVICE not in {"auto", "cpu", "cuda"}:
        raise RuntimeError("WHISPER_DEVICE deve essere auto, cpu oppure cuda.")

    try:
        import ctranslate2
    except ImportError as error:
        raise RuntimeError(
            "CTranslate2 non è installato. Esegui: python -m pip install -r requirements.txt"
        ) from error

    gpu_count = 0
    try:
        gpu_count = int(ctranslate2.get_cuda_device_count())
    except Exception:
        # Se CUDA/cuDNN non sono utilizzabili, l'avvio automatico continua su CPU.
        gpu_count = 0

    if REQUESTED_DEVICE == "cuda" and gpu_count < 1:
        raise RuntimeError(
            "WHISPER_DEVICE=cuda ma CTranslate2 non rileva una GPU NVIDIA utilizzabile. "
            "Controlla driver, CUDA 12, cuBLAS e cuDNN 9 oppure usa WHISPER_DEVICE=auto."
        )

    device = "cuda" if REQUESTED_DEVICE == "cuda" else "cpu"
    if REQUESTED_DEVICE == "auto":
        device = "cuda" if gpu_count > 0 else "cpu"

    supported: set[str] = set()
    try:
        supported = set(ctranslate2.get_supported_compute_types(device))
    except Exception:
        pass

    if REQUESTED_MODEL and REQUESTED_MODEL.lower() != "auto":
        model = REQUESTED_MODEL
    else:
        # Turbo è molto più accurato di small ma resta adatto alla bassa latenza su GPU.
        model = "large-v3-turbo" if device == "cuda" else "small"

    if REQUESTED_COMPUTE_TYPE and REQUESTED_COMPUTE_TYPE != "auto":
        compute_type = REQUESTED_COMPUTE_TYPE
    elif device == "cuda":
        compute_type = "float16" if "float16" in supported else "auto"
    else:
        compute_type = "int8" if "int8" in supported else "auto"

    if supported and compute_type not in supported and compute_type != "auto":
        compute_type = "auto"

    return WhisperRuntime(
        model=model,
        device=device,
        compute_type=compute_type,
        gpu_count=gpu_count,
        supported_compute_types=tuple(sorted(supported)),
    )


def get_whisper_model() -> Any:
    """Carica il modello una sola volta e lo mantiene residente in RAM/VRAM."""
    global _model, _runtime

    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise RuntimeError(
                "faster-whisper non è installato. Esegui: "
                "python -m pip install -r requirements.txt"
            ) from error

        _runtime = resolve_whisper_runtime()

        def load(runtime: WhisperRuntime) -> Any:
            print(
                "[whisper] caricamento modello "
                f"model={runtime.model} device={runtime.device} "
                f"compute_type={runtime.compute_type}"
            )
            return WhisperModel(
                runtime.model,
                device=runtime.device,
                compute_type=runtime.compute_type,
                cpu_threads=WHISPER_CPU_THREADS,
                num_workers=1,
            )

        try:
            _model = load(_runtime)
        except Exception as first_error:
            # In modalità auto tentiamo prima una precisione GPU più leggera,
            # poi la CPU. Se l'utente forza CUDA, invece, mostriamo l'errore.
            if REQUESTED_DEVICE != "auto" or _runtime.device != "cuda":
                raise RuntimeError(
                    "Impossibile caricare Whisper con la configurazione "
                    f"model={_runtime.model}, device={_runtime.device}, "
                    f"compute_type={_runtime.compute_type}: {first_error}"
                ) from first_error

            if _runtime.compute_type != "int8_float16":
                gpu_fallback = WhisperRuntime(
                    model=_runtime.model,
                    device="cuda",
                    compute_type="int8_float16",
                    gpu_count=_runtime.gpu_count,
                    supported_compute_types=_runtime.supported_compute_types,
                )
                try:
                    print(f"[whisper] fallback GPU dopo errore: {first_error}")
                    _model = load(gpu_fallback)
                    _runtime = gpu_fallback
                    return _model
                except Exception as second_error:
                    print(f"[whisper] fallback GPU non riuscito: {second_error}")

            cpu_supported: tuple[str, ...] = ()
            try:
                import ctranslate2

                cpu_supported = tuple(
                    sorted(ctranslate2.get_supported_compute_types("cpu"))
                )
            except Exception:
                pass

            cpu_fallback = WhisperRuntime(
                model="small",
                device="cpu",
                compute_type="int8" if "int8" in cpu_supported else "auto",
                gpu_count=_runtime.gpu_count,
                supported_compute_types=cpu_supported,
            )
            try:
                print("[whisper] CUDA non utilizzabile: fallback automatico su CPU")
                _model = load(cpu_fallback)
                _runtime = cpu_fallback
            except Exception as final_error:
                raise RuntimeError(
                    "Whisper non è stato caricato né su GPU né su CPU. "
                    f"Errore GPU: {first_error}. Errore CPU: {final_error}"
                ) from final_error

    return _model


def create_silent_wav(path: Path, duration_seconds: float = 0.5) -> None:
    sample_rate = 16000
    frame_count = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\x00\x00" * frame_count)


def warm_up_model() -> None:
    """Carica modello e librerie prima che arrivi la prima finestra reale."""
    model = get_whisper_model()
    if not WHISPER_WARMUP:
        return

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temporary:
        warmup_path = Path(temporary.name)

    try:
        create_silent_wav(warmup_path)
        segments, _ = model.transcribe(
            str(warmup_path),
            language=WHISPER_LANGUAGE,
            beam_size=1,
            vad_filter=False,
            word_timestamps=False,
            condition_on_previous_text=False,
        )
        list(segments)
    finally:
        warmup_path.unlink(missing_ok=True)


def trim_wav_tail(source_path: Path, destination_path: Path, keep_seconds: float) -> float:
    """Copia solo la coda del WAV; restituisce la durata realmente copiata."""
    try:
        with wave.open(str(source_path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            total_frames = source.getnframes()
            compression_type = source.getcomptype()
            compression_name = source.getcompname()

            if compression_type != "NONE":
                raise RuntimeError("Il WAV deve essere PCM non compresso.")
            if sample_rate <= 0:
                raise RuntimeError("Sample rate WAV non valido.")

            keep_frames = min(total_frames, max(1, int(round(keep_seconds * sample_rate))))
            start_frame = max(0, total_frames - keep_frames)
            source.setpos(start_frame)
            frames = source.readframes(keep_frames)

        with wave.open(str(destination_path), "wb") as destination:
            destination.setnchannels(channels)
            destination.setsampwidth(sample_width)
            destination.setframerate(sample_rate)
            destination.setcomptype(compression_type, compression_name)
            destination.writeframes(frames)

        return keep_frames / sample_rate
    except wave.Error as error:
        raise RuntimeError(f"WAV non valido: {error}") from error


def transcribe_audio_file(audio_path: Path) -> dict[str, Any]:
    """Trascrive il WAV e restituisce testo, segmenti e metriche di latenza."""
    model = get_whisper_model()
    started_at = time.perf_counter()

    # Un solo worker evita che due invii concorrenti saturino la stessa GPU.
    with _inference_lock:
        segments_generator, info = model.transcribe(
            str(audio_path),
            language=WHISPER_LANGUAGE,
            beam_size=WHISPER_BEAM_SIZE,
            temperature=0.0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": WHISPER_VAD_MIN_SILENCE_MS},
            word_timestamps=True,
            condition_on_previous_text=False,
        )

        segments: list[dict[str, Any]] = []
        for segment in segments_generator:
            words = [
                {
                    "start": float(word.start),
                    "end": float(word.end),
                    "word": str(word.word),
                }
                for word in (segment.words or [])
            ]
            segments.append(
                {
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": str(segment.text).strip(),
                    "words": words,
                }
            )

    processing_seconds = time.perf_counter() - started_at
    full_text = " ".join(
        segment["text"] for segment in segments if segment["text"]
    ).strip()

    return {
        "full_text": full_text,
        "segments": segments,
        "language": getattr(info, "language", WHISPER_LANGUAGE),
        "language_probability": float(
            getattr(info, "language_probability", 0.0) or 0.0
        ),
        "processing_seconds": processing_seconds,
    }


def parse_captured_at(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=f"captured_at non è un timestamp ISO valido: {value}",
        ) from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def safe_session_id(session_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", session_id.strip()).strip("._")
    if not cleaned:
        raise HTTPException(status_code=422, detail="session_id non valido.")
    return cleaned[:120]


def get_csv_path(session_id: str) -> Path:
    return TRANSCRIPTIONS_DIR / f"{safe_session_id(session_id)}.csv"


def get_analysis_csv_path(session_id: str) -> Path:
    """CSV con una riga per ogni blocco audio destinato al sentiment."""
    return TRANSCRIPTIONS_DIR / f"{safe_session_id(session_id)}-audio-windows.csv"


def get_analysis_audio_dir(session_id: str) -> Path:
    directory = AUDIO_WINDOWS_DIR / safe_session_id(session_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def save_sentiment_audio_window(
    source_path: Path,
    *,
    session_id: str,
    sequence: int,
    captured_at: datetime,
    keep_seconds: float,
) -> tuple[Path, float]:
    """Salva la coda nuova del WAV e restituisce percorso e durata reale."""
    directory = get_analysis_audio_dir(session_id)
    captured_utc = captured_at.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = directory / f"{int(sequence):06d}_{captured_utc}.wav"
    saved_seconds = trim_wav_tail(source_path, destination, keep_seconds)
    return destination, saved_seconds


def append_analysis_window_to_csv(
    csv_path: Path,
    record: dict[str, Any],
) -> None:
    """Aggiunge una finestra audio/testo al CSV multimodale della sessione."""
    fieldnames = [
        "timestamp",
        "captured_at",
        "sequence",
        "duration_seconds",
        "text",
        "audio_file",
    ]

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with _csv_lock:
        file_exists = csv_path.exists() and csv_path.stat().st_size > 0
        with csv_path.open("a", newline="", encoding="utf-8-sig") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            writer.writerow({name: record.get(name, "") for name in fieldnames})


def absolute_audio_timestamp(
    captured_at: datetime,
    window_seconds: float,
    relative_seconds: float,
) -> str:
    window_start = captured_at - timedelta(seconds=max(0.0, window_seconds))
    absolute = window_start + timedelta(seconds=max(0.0, relative_seconds))
    return absolute.astimezone().strftime("%H:%M:%S")


def extract_new_chunks(
    segments: list[dict[str, Any]],
    *,
    captured_at: datetime,
    window_seconds: float,
    new_audio_seconds: float,
) -> list[dict[str, str]]:
    fresh_duration = min(max(new_audio_seconds, 0.0), max(window_seconds, 0.0))
    cutoff = max(0.0, window_seconds - fresh_duration)
    chunks: list[dict[str, str]] = []

    for segment in segments:
        words = segment.get("words") or []
        fresh_words = [
            word for word in words if float(word.get("end", 0.0)) > cutoff
        ]

        if fresh_words:
            text = "".join(str(word.get("word", "")) for word in fresh_words).strip()
            relative_start = max(cutoff, float(fresh_words[0].get("start", cutoff)))
        elif float(segment.get("end", 0.0)) > cutoff:
            text = str(segment.get("text", "")).strip()
            relative_start = max(cutoff, float(segment.get("start", cutoff)))
        else:
            continue

        if text:
            chunks.append(
                {
                    "timestamp": absolute_audio_timestamp(
                        captured_at, window_seconds, relative_start
                    ),
                    "text": text,
                }
            )

    return chunks


def append_chunks_to_csv(csv_path: Path, chunks: list[dict[str, str]]) -> int:
    if not chunks:
        return 0

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with _csv_lock:
        file_exists = csv_path.exists() and csv_path.stat().st_size > 0
        with csv_path.open("a", newline="", encoding="utf-8-sig") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=["timestamp", "text"])
            if not file_exists:
                writer.writeheader()
            writer.writerows(chunks)
    return len(chunks)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Il server risulta pronto solo dopo il caricamento del modello: la prima frase
    # non paga più il costo di download/caricamento/inizializzazione GPU.
    await asyncio.to_thread(warm_up_model)
    yield


app = FastAPI(
    title="Rolling Audio Transcription Receiver",
    lifespan=lifespan,
)

allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, Any]:
    runtime = _runtime or resolve_whisper_runtime()
    return {
        "status": "online",
        "message": "Audio transcription server is running",
        "endpoint": "/transcribe",
        "documentation": "/docs",
        "model": runtime.model,
        "device": runtime.device,
        "compute_type": runtime.compute_type,
        "gpu_count": runtime.gpu_count,
        "beam_size": WHISPER_BEAM_SIZE,
        "context_seconds": WHISPER_CONTEXT_SECONDS,
        "language": WHISPER_LANGUAGE or "automatic",
        "transcriptions_directory": str(TRANSCRIPTIONS_DIR),
        "audio_windows_directory": str(AUDIO_WINDOWS_DIR),
        "sentiment_chunk_seconds": SENTIMENT_CHUNK_SECONDS,
    }


@app.get("/status")
async def status() -> dict[str, Any]:
    runtime = _runtime or resolve_whisper_runtime()
    return {
        "ready": _model is not None,
        "model": runtime.model,
        "device": runtime.device,
        "compute_type": runtime.compute_type,
        "gpu_count": runtime.gpu_count,
        "supported_compute_types": runtime.supported_compute_types,
    }


@app.get("/transcriptions/{session_id}.csv", response_class=FileResponse)
async def download_transcription_csv(session_id: str) -> FileResponse:
    csv_path = get_csv_path(session_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="CSV non ancora disponibile.")
    return FileResponse(
        csv_path,
        media_type="text/csv; charset=utf-8",
        filename=csv_path.name,
    )


@app.get("/analysis-windows/{session_id}.csv", response_class=FileResponse)
async def download_analysis_windows_csv(session_id: str) -> FileResponse:
    csv_path = get_analysis_csv_path(session_id)
    if not csv_path.exists():
        raise HTTPException(
            status_code=404,
            detail="CSV delle finestre audio non ancora disponibile.",
        )
    return FileResponse(
        csv_path,
        media_type="text/csv; charset=utf-8",
        filename=csv_path.name,
    )


@app.get("/analysis-audio/{session_id}/{filename}", response_class=FileResponse)
async def download_analysis_audio(session_id: str, filename: str) -> FileResponse:
    safe_filename = Path(filename).name
    if safe_filename != filename or not safe_filename.lower().endswith(".wav"):
        raise HTTPException(status_code=422, detail="Nome file audio non valido.")

    audio_path = get_analysis_audio_dir(session_id) / safe_filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="File audio non trovato.")

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=audio_path.name,
    )


@app.post("/transcribe")
async def transcribe_window(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    sequence: int = Form(...),
    window_seconds: float = Form(...),
    sample_rate: int = Form(...),
    captured_at: str = Form(...),
    new_audio_seconds: float = Form(20.0),
) -> dict[str, Any]:
    if audio.content_type not in {
        "audio/wav",
        "audio/x-wav",
        "application/octet-stream",
    }:
        raise HTTPException(
            status_code=415,
            detail=f"Formato non supportato: {audio.content_type}",
        )
    if window_seconds <= 0:
        raise HTTPException(status_code=422, detail="window_seconds deve essere > 0.")
    if new_audio_seconds <= 0:
        raise HTTPException(status_code=422, detail="new_audio_seconds deve essere > 0.")

    captured_datetime = parse_captured_at(captured_at)
    csv_path = get_csv_path(session_id)
    analysis_csv_path = get_analysis_csv_path(session_id)
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as uploaded_file:
        uploaded_path = Path(uploaded_file.name)
        while chunk := await audio.read(1024 * 1024):
            uploaded_file.write(chunk)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as trimmed_file:
        trimmed_path = Path(trimmed_file.name)

    try:
        # Conserviamo 8 s circa di contesto prima dei 20 s nuovi. Il browser mantiene
        # comunque tutti i 60 s; il modello non deve ricalcolarli a ogni richiesta.
        requested_analysis_seconds = min(
            window_seconds,
            new_audio_seconds + WHISPER_CONTEXT_SECONDS,
        )
        processed_audio_seconds = await asyncio.to_thread(
            trim_wav_tail,
            uploaded_path,
            trimmed_path,
            requested_analysis_seconds,
        )

        transcription = await asyncio.to_thread(
            transcribe_audio_file,
            trimmed_path,
        )

        fresh_chunks = extract_new_chunks(
            transcription["segments"],
            captured_at=captured_datetime,
            window_seconds=processed_audio_seconds,
            new_audio_seconds=min(new_audio_seconds, processed_audio_seconds),
        )
        saved_rows = await asyncio.to_thread(
            append_chunks_to_csv,
            csv_path,
            fresh_chunks,
        )

        fresh_text = " ".join(chunk["text"] for chunk in fresh_chunks).strip()

        # Il classificatore è stato addestrato su clip di massimo 20 secondi.
        # Salviamo quindi la coda nuova, non l'intera finestra rolling da 60 s.
        sentiment_seconds = min(
            float(window_seconds),
            float(new_audio_seconds),
            float(SENTIMENT_CHUNK_SECONDS),
        )
        sentiment_chunks = extract_new_chunks(
            transcription["segments"],
            captured_at=captured_datetime,
            window_seconds=processed_audio_seconds,
            new_audio_seconds=min(sentiment_seconds, processed_audio_seconds),
        )
        sentiment_text = " ".join(
            chunk["text"] for chunk in sentiment_chunks
        ).strip()
        saved_audio_path, saved_audio_seconds = await asyncio.to_thread(
            save_sentiment_audio_window,
            uploaded_path,
            session_id=session_id,
            sequence=sequence,
            captured_at=captured_datetime,
            keep_seconds=sentiment_seconds,
        )

        try:
            relative_audio_path = saved_audio_path.relative_to(TRANSCRIPTIONS_DIR)
            audio_file_value = relative_audio_path.as_posix()
        except ValueError:
            audio_file_value = str(saved_audio_path)

        await asyncio.to_thread(
            append_analysis_window_to_csv,
            analysis_csv_path,
            {
                "timestamp": captured_datetime.astimezone().strftime("%H:%M:%S"),
                "captured_at": captured_datetime.isoformat(),
                "sequence": int(sequence),
                "duration_seconds": round(saved_audio_seconds, 3),
                "text": sentiment_text,
                "audio_file": audio_file_value,
            },
        )

        safe_id = safe_session_id(session_id)
        processing_seconds = float(transcription["processing_seconds"])
        realtime_factor = (
            processing_seconds / processed_audio_seconds
            if processed_audio_seconds > 0
            else 0.0
        )
        runtime = _runtime or resolve_whisper_runtime()

        return {
            "session_id": session_id,
            "sequence": sequence,
            "window_seconds_received": window_seconds,
            "audio_seconds_processed": round(processed_audio_seconds, 3),
            "new_audio_seconds": new_audio_seconds,
            "sample_rate": sample_rate,
            "captured_at": captured_at,
            "text": fresh_text,
            "full_text": transcription["full_text"],
            "language": transcription["language"],
            "language_probability": transcription["language_probability"],
            "saved_rows": saved_rows,
            "processing_seconds": round(processing_seconds, 3),
            "realtime_factor": round(realtime_factor, 3),
            "model": runtime.model,
            "device": runtime.device,
            "compute_type": runtime.compute_type,
            "csv_file": csv_path.name,
            "csv_download_url": f"/transcriptions/{safe_id}.csv",
            "analysis_csv_file": analysis_csv_path.name,
            "analysis_csv_download_url": f"/analysis-windows/{safe_id}.csv",
            "analysis_audio_file": audio_file_value,
            "analysis_audio_seconds": round(saved_audio_seconds, 3),
            "analysis_audio_download_url": (
                f"/analysis-audio/{safe_id}/{saved_audio_path.name}"
            ),
        }
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        uploaded_path.unlink(missing_ok=True)
        trimmed_path.unlink(missing_ok=True)