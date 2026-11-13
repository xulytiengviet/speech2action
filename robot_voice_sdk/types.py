"""Data contracts shared between perception, safety and execution."""
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class Proposal:
    action_id: Optional[int]
    transcript: str
    confidence: Optional[float] = None
    source: str = "stt"
    evidence: str = "uncalibrated"


@dataclass
class RobotState:
    simulation: bool = True
    connected: bool = True
    heartbeat_ok: bool = True
    keepout: bool = False
    estop_latched: bool = False
    operator_authorized: bool = False


@dataclass(frozen=True)
class Decision:
    approved: bool
    action_id: Optional[int]
    reason: str
    action_name: str = "NO_OP"


@dataclass
class Result:
    proposal: Proposal
    decision: Decision
    execution: str
    latency_ms: float
    trace: list[str] = field(default_factory=list)
