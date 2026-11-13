"""Python chess execution adapter for the verified Speech2Action policy contract.

Independent from the browser. Reuses python-chess already listed in EdgeVox's
pyproject.toml and shares the domain invariants with site/core.mjs.

Not an interface to robot motors. No neural model/ESP32 inference is claimed.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import re
import unicodedata

POLICY_VERSION = 1
THRESHOLD = 0.85

PIECE_NAMES = {
    "tốt": "p", "tot": "p", "mã": "n", "ma": "n", "ngựa": "n",
    "tượng": "b", "tuong": "b", "xe": "r", "hậu": "q", "hau": "q", "vua": "k",
}
_PIECE_RE = "|".join(map(re.escape, PIECE_NAMES))
_GRAMMAR = re.compile(
    rf"^(?:(?:hãy |xin |cho )?(?:đi |di chuyển |đưa |kéo |đẩy )?"
    rf"(?:(?P<piece>{_PIECE_RE}) )?)?"
    r"(?P<from>[a-h][1-8])\s*(?:đến|tới|sang|qua|->|-| )?\s*"
    r"(?P<to>[a-h][1-8])\s*(?P<promotion>[qrbn])?$"
)
_NEGATION = re.compile(r"(?:^|\s)(?:không|đừng|chớ|hủy|huỷ|cancel)(?:\s|$)")
_STOPS = frozenset({"dừng", "dừng lại", "dừng khẩn cấp", "stop", "emergency stop"})


@dataclass(frozen=True)
class ChessDecision:
    approved: bool
    reason: str
    execution: str
    fen_before: str
    fen_after: str
    uci: str | None = None
    san: str | None = None

    def jsonable(self) -> dict:
        return asdict(self)


class ChessActionSDK:
    """Simulation-only. On live robot hardware, commands are rejected."""

    def __init__(self):
        try:
            import chess
        except ImportError as exc:
            raise RuntimeError("Install python-chess: pip install python-chess") from exc
        self._chess = chess
        self.board = chess.Board()
        self.estop_latched = False
        self.keepout = False
        self.heartbeat = True
        self.simulation = True

    def reset_estop(self, operator_ack: bool = False) -> bool:
        if not operator_ack:
            return False
        self.estop_latched = False
        return True

    def _result(self, approved: bool, reason: str, initial: str,
                execution: str = "NO_OP", uci: str | None = None,
                san: str | None = None) -> ChessDecision:
        return ChessDecision(approved, reason, execution, initial, self.board.fen(), uci, san)

    def run(self, command: str, *, branch: str = "A",
            provenance: str = "exact_typed_text",
            confidence: float | None = None, policy_version: int = POLICY_VERSION) -> ChessDecision:
        initial = self.board.fen()
        text = unicodedata.normalize("NFC", str(command)).lower().strip()
        text = re.sub(r"\s+", " ", text).rstrip(".!?").strip()
        if text in _STOPS:
            self.estop_latched = True
            return self._result(True, "STOP_PRIORITY", initial, "STOP_LATCHED")
        if _NEGATION.search(text):
            return self._result(False, "NEGATED_COMMAND", initial)
        match = _GRAMMAR.fullmatch(text)
        if not match:
            return self._result(False, "UNRECOGNIZED_GRAMMAR", initial)
        start, end = match.group("from"), match.group("to")
        if start == end:
            return self._result(False, "SAME_SQUARE", initial)
        if self.estop_latched:
            return self._result(False, "ESTOP_LATCHED", initial)
        if self.keepout:
            return self._result(False, "KEEP_OUT", initial)
        if not self.heartbeat:
            return self._result(False, "HEARTBEAT_LOST", initial)
        if policy_version != POLICY_VERSION:
            return self._result(False, "POLICY_VERSION_MISMATCH", initial)
        if not self.simulation:
            return self._result(False, "REAL_ACTUATION_DISABLED", initial)
        if branch == "B":
            if provenance != "synthetic":
                return self._result(False, "UNTRAINED_AUDIO_MODEL", initial)
            if (confidence is None or isinstance(confidence, bool)
                    or not isinstance(confidence, (float, int))
                    or not math.isfinite(confidence) or confidence < 0 or confidence > 1):
                return self._result(False, "INVALID_CONFIDENCE", initial)
            if confidence < THRESHOLD:
                return self._result(False, "LOW_CONFIDENCE", initial)
        elif branch != "A" or provenance != "exact_typed_text":
            return self._result(False, "UNVERIFIED_PERCEPTION", initial)
        if self.board.turn != self._chess.WHITE:
            return self._result(False, "NOT_YOUR_TURN", initial)
        square = self._chess.parse_square(start)
        piece = self.board.piece_at(square)
        expected_piece = PIECE_NAMES.get(match.group("piece"))
        if expected_piece and (piece is None or piece.symbol().lower() != expected_piece):
            return self._result(False, "PIECE_MISMATCH", initial)
        notation = start + end + (match.group("promotion") or "")
        move = self._chess.Move.from_uci(notation)
        if move not in self.board.legal_moves:
            if not match.group("promotion"):
                # An unqualified pawn promotion defaults to a queen.
                promotion = self._chess.Move.from_uci(start + end + "q")
                if promotion in self.board.legal_moves:
                    move = promotion
            if move not in self.board.legal_moves:
                return self._result(False, "ILLEGAL_CHESS_MOVE", initial)
        san = self.board.san(move)
        self.board.push(move)
        return self._result(True, "PASS", initial, "SIMULATED_MOVE", move.uci(), san)

    def apply_opponent_uci(self, uci: str) -> str:
        """Optional deterministic opponent move: does not bypass chess legality."""
        if self.estop_latched or self.keepout or not self.heartbeat or not self.simulation:
            raise RuntimeError("Robot not authorized")
        if self.board.turn != self._chess.BLACK:
            raise RuntimeError("Not opponent turn")
        move = self._chess.Move.from_uci(uci)
        if move not in self.board.legal_moves:
            raise ValueError("Opponent move illegal")
        san = self.board.san(move)
        self.board.push(move)
        return san
