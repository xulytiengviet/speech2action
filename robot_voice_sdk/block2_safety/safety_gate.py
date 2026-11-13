"""Fail-closed rules executed BEFORE dispatch; no LLM may override these checks."""
import math

from robot_voice_sdk.block2_safety.lexicon import lookup, lookup_id
from robot_voice_sdk.types import Decision, Proposal, RobotState


class SafetyGate:
    def __init__(self, threshold: float = 0.85):
        if not 0 < threshold <= 1:
            raise ValueError("threshold must be in (0,1]")
        self.threshold = threshold

    def validate(self, proposal: Proposal, state: RobotState) -> Decision:
        spec = lookup_id(proposal.action_id) if proposal.action_id is not None else None
        # Independent phrase-to-ID cross-check prevents hallucinated tool IDs.
        if spec is None or lookup(proposal.transcript) != spec:
            return Decision(False, None, "UNKNOWN_OR_MISMATCHED_COMMAND")
        # A precisely recognised emergency stop is always permitted, even if the
        # model is uncalibrated / estop latched / keep-out already active.
        if spec.action_id == 0:
            return Decision(True, 0, "EMERGENCY_STOP", "STOP")
        if state.estop_latched:
            return Decision(False, spec.action_id, "ESTOP_LATCHED")
        if not state.connected or not state.heartbeat_ok:
            return Decision(False, spec.action_id, "ROBOT_NOT_READY")
        if state.keepout:
            return Decision(False, spec.action_id, "KEEP_OUT")
        if proposal.source == "typed" and not state.simulation:
            return Decision(False, spec.action_id, "TYPED_LIVE_DISABLED")
        if proposal.source not in {"typed", "stt", "classifier"}:
            return Decision(False, spec.action_id, "UNTRUSTED_SOURCE")
        if proposal.source in {"stt", "classifier"} and proposal.evidence != "calibrated":
            return Decision(False, spec.action_id, "UNCALIBRATED_CONFIDENCE")
        if (proposal.confidence is None or not isinstance(proposal.confidence, (int, float))
                or isinstance(proposal.confidence, bool)
                or not math.isfinite(proposal.confidence)
                or not 0 <= proposal.confidence <= 1):
            return Decision(False, spec.action_id, "MISSING_OR_INVALID_CONFIDENCE")
        if proposal.confidence < self.threshold:
            return Decision(False, spec.action_id, "LOW_CONFIDENCE")
        if spec.risk >= 3 and not state.operator_authorized:
            return Decision(False, spec.action_id, "OPERATOR_AUTH_REQUIRED")
        return Decision(True, spec.action_id, "PASS", spec.name)
