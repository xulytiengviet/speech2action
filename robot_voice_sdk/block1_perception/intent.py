"""Exact-match Vietnamese command parser: no hallucinated or fuzzy action IDs."""

from typing import ClassVar

from robot_voice_sdk.block2_safety.lexicon import lookup


def parse_text(text: str, *, source: str = "typed", confidence=None, evidence: str = "uncalibrated"):
    from robot_voice_sdk.types import Proposal

    spec = lookup(text)
    # Only direct typed input in a simulation receives deterministic match evidence.
    # This is NOT an acoustic model confidence.
    if source == "typed" and spec is not None:
        confidence, evidence = 1.0, "exact_text"
    return Proposal(spec.action_id if spec else None, text, confidence, source, evidence)


class NeuDecideProbe:
    """Research-only English waveform-to-tool diagnostics; NEVER authorized actuation."""

    TOOLS: ClassVar[list[dict[str, object]]] = [
        {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": {}},
        }
        for name, description in [
            ("stop", "Stop immediately"),
            ("moveForward", "Move forward"),
            ("moveBack", "Move backward"),
            ("turnLeft", "Turn left"),
            ("turnRight", "Turn right"),
            ("grasp", "Grasp an object"),
        ]
    ]

    def __init__(self):
        try:
            from neudecide import NeuDecide
        except ImportError as exc:
            raise RuntimeError("Install optional neudecide==0.1.0a1 for research mode") from exc
        self.model = NeuDecide.from_pretrained()

    def inspect(self, wav_path: str):
        # English-only model; no calibrated confidence; do not feed output to SDK.execute.
        return self.model.generate(wav_path, self.TOOLS)
