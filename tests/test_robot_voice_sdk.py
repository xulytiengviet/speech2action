"""Pure stdlib reproducibility tests, independent of large audio models."""
import math
import unittest

from robot_voice_sdk import Proposal, RobotState, Speech2ActionSDK
from robot_voice_sdk.block2_safety.lexicon import ACTIONS, cvnss_annotation, lookup


class RobotVoiceTests(unittest.TestCase):
    def setUp(self):
        self.sdk = Speech2ActionSDK()

    def test_text_exact_pass(self):
        r = self.sdk.process_text("Quay trái")
        self.assertTrue(r.decision.approved)
        self.assertEqual(r.proposal.action_id, 3)
        self.assertEqual(r.execution, "SIMULATED_TURN_LEFT")

    def test_stop_bypasses_model_confidence(self):
        self.sdk.state.estop_latched = True
        r = self.sdk.process_text("dừng lại", source="stt")
        self.assertTrue(r.decision.approved)
        self.assertEqual(r.execution, "SIMULATED_STOP")

    def test_unsupported_noise_rejects(self):
        self.assertEqual(self.sdk.process_text("tiến lên rồi đập tường").execution, "NO_OP")

    def test_negation_not_substring_match(self):
        self.assertIsNone(lookup("không tiến lên"))
        self.assertEqual(self.sdk.process_text("không tiến lên").execution, "NO_OP")

    def test_uncalibrated_voice_never_moves(self):
        r = self.sdk.process_text("tiến lên", source="stt", confidence=0.99)
        self.assertEqual(r.decision.reason, "UNCALIBRATED_CONFIDENCE")
        self.assertEqual(r.execution, "NO_OP")

    def test_low_confidence(self):
        r = self.sdk.process_text("xoay phải", source="stt", confidence=0.62, evidence="calibrated")
        self.assertEqual(r.decision.reason, "LOW_CONFIDENCE")

    def test_keepout(self):
        self.sdk.state.keepout = True
        r = self.sdk.process_text("quay trái")
        self.assertEqual(r.decision.reason, "KEEP_OUT")
        self.assertEqual(r.execution, "NO_OP")

    def test_disconnected(self):
        self.sdk.state.connected = False
        self.assertEqual(self.sdk.process_text("tiến lên").decision.reason, "ROBOT_NOT_READY")

    def test_operator_auth_for_grasp(self):
        self.assertEqual(self.sdk.process_text("gắp vật").decision.reason, "OPERATOR_AUTH_REQUIRED")

    def test_invalid_confidence(self):
        for conf in (None, float("nan"), float("inf"), -1, 1.01, True):
            with self.subTest(conf=conf):
                r = self.sdk.process_text("tiến lên", source="stt", confidence=conf, evidence="calibrated")
                self.assertFalse(r.decision.approved)

    def test_id_and_phrase_mismatch(self):
        r = self.sdk.process_proposal(Proposal(4, "xoay trái", 0.99, "classifier", "calibrated"))
        self.assertEqual(r.decision.reason, "UNKNOWN_OR_MISMATCHED_COMMAND")

    def test_typed_cannot_drive_live(self):
        sdk = Speech2ActionSDK(state=RobotState(simulation=False))
        self.assertEqual(sdk.process_text("tiến lên").decision.reason, "TYPED_LIVE_DISABLED")

    def test_whitelist_annotations_not_codec(self):
        self.assertEqual({a.action_id for a in ACTIONS}, set(range(6)))
        self.assertTrue(all(cvnss_annotation(a.action_id) for a in ACTIONS))

    def test_emergency_stop_even_disconnected(self):
        self.sdk.state.connected = False
        self.assertTrue(self.sdk.process_text("dừng").decision.approved)

    def test_sdk_no_robot_state_change_on_reject(self):
        self.sdk.process_text("tiến lên")
        before = (self.sdk.bridge.x, self.sdk.bridge.y, self.sdk.bridge.yaw)
        self.sdk.state.keepout = True
        self.sdk.process_text("tiến lên")
        self.assertEqual(before, (self.sdk.bridge.x, self.sdk.bridge.y, self.sdk.bridge.yaw))


if __name__ == "__main__":
    unittest.main()
