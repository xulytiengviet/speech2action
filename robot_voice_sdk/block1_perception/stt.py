"""Use EdgeVox's Vietnamese Sherpa-ONNX Zipformer STT, without fake confidence."""

import wave
from pathlib import Path


class EdgeVoxVietnameseSTT:
    def __init__(self, *, device: str = "cpu", require_sherpa: bool = True):
        try:
            from edgevox.stt import create_stt
        except ImportError as exc:
            raise RuntimeError("Install repository EdgeVox dependencies first") from exc
        self.engine = create_stt(language="vi", model_size="sherpa", device=device)
        self.backend = self.engine.display_name
        if require_sherpa and "sherpa" not in self.backend.lower():
            raise RuntimeError("Sherpa unavailable; EdgeVox silently fell back to " + self.backend)

    def transcribe_wav(self, path: str) -> str:
        import numpy as np

        path = Path(path)
        with wave.open(str(path), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000:
                raise ValueError("Expected 16kHz, mono, PCM16 WAV; resample explicitly before STT")
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype("float32") / 32768.0
        if len(samples) == 0:
            raise ValueError("Audio is empty")
        return self.engine.transcribe(samples, language="vi")
