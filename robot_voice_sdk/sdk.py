"""Public SDK orchestrator. Only Block 2 can authorize Block 3."""

import time

from .block1_perception.intent import parse_text
from .block2_safety.safety_gate import SafetyGate
from .block3_execution.ros2_bridge import SimulationBridge
from .types import Proposal, Result, RobotState


class Speech2ActionSDK:
    def __init__(self, *, bridge=None, state=None, threshold: float = 0.85):
        self.state = state if state is not None else RobotState()
        self.bridge = bridge if bridge is not None else SimulationBridge()
        self.gate = SafetyGate(threshold=threshold)
        self.events = []

    def process_text(
        self, text: str, *, source: str = "typed", confidence=None, evidence: str = "uncalibrated"
    ) -> Result:
        proposal = parse_text(text, source=source, confidence=confidence, evidence=evidence)
        return self.process_proposal(proposal)

    def process_proposal(self, proposal: Proposal) -> Result:
        t0 = time.perf_counter()
        trace = ["BLOCK1:" + proposal.source]
        decision = self.gate.validate(proposal, self.state)
        trace.append("BLOCK2:" + decision.reason)
        # The untrusted intent never goes directly to the executor.
        execution = self.bridge.execute(decision)
        trace.append("BLOCK3:" + execution)
        result = Result(proposal, decision, execution, (time.perf_counter() - t0) * 1000.0, trace)
        self.events.append(result)
        return result

    def process_wav(self, path: str, *, stt=None, confidence=None, evidence="uncalibrated") -> Result:
        if stt is None:
            from .block1_perception.stt import EdgeVoxVietnameseSTT

            stt = EdgeVoxVietnameseSTT()
        transcript = stt.transcribe_wav(path)
        # EdgeVox returns a transcript, not a calibrated action confidence.
        return self.process_text(transcript, source="stt", confidence=confidence, evidence=evidence)
