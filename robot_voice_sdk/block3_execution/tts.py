"""Lazy VieNeu 1.2.4 synthesis adapter; no audio played automatically."""

from pathlib import Path


class VieNeuTTS:
    def __init__(self):
        try:
            from vieneu import Vieneu
        except ImportError as exc:
            raise RuntimeError("Install vieneu==1.2.4 (optional TTS)") from exc
        self.engine = Vieneu()

    def save(self, text: str, path: str = "speech2action_response.wav") -> str:
        if not text or not text.strip():
            raise ValueError("Speech text is empty")
        dest = Path(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        audio = self.engine.infer(text=text)
        self.engine.save(audio, str(dest))
        return str(dest)
