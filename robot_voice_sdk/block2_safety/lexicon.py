"""Small audited whitelist. CVNSS labels below are illustrative keys, NOT a full codec."""
import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class ActionSpec:
    action_id: int
    name: str
    phrases: tuple[str, ...]
    cvnss_demo: str
    risk: int


ACTIONS = (
    ActionSpec(0, "STOP", ("dừng lại", "dừng", "đứng lại", "khẩn cấp dừng"), "duwng2", 0),
    ActionSpec(1, "MOVE_FORWARD", ("tiến lên", "đi thẳng", "tiến"), "tieens1 leen1", 1),
    ActionSpec(2, "MOVE_BACK", ("lùi lại", "lùi"), "lui3", 1),
    ActionSpec(3, "TURN_LEFT", ("xoay trái", "quay trái", "rẽ trái"), "xoay1 trai3", 1),
    ActionSpec(4, "TURN_RIGHT", ("xoay phải", "quay phải", "rẽ phải"), "xoay1 fai3", 1),
    ActionSpec(5, "GRASP", ("gắp vật", "gắp"), "gap1", 3),
)
BY_ID = {a.action_id: a for a in ACTIONS}


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFC", text).casefold().strip()
    return re.sub(r"\s+", " ", value)


PHRASES = {normalize(phrase): action for action in ACTIONS for phrase in action.phrases}


def lookup(text: str):
    # No partial matching: "không tiến lên" must not become MOVE_FORWARD.
    return PHRASES.get(normalize(text))


def lookup_id(action_id: int):
    return BY_ID.get(action_id)


def cvnss_annotation(action_id: int):
    spec = lookup_id(action_id)
    return spec.cvnss_demo if spec else None
