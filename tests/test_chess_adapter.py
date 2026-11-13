"""Research regression for independent Python execution adapter."""
import importlib.util
import unittest

from robot_voice_sdk.chess_adapter import ChessActionSDK


@unittest.skipUnless(importlib.util.find_spec("chess"), "python-chess dependency is not installed")
class TestChessSDK(unittest.TestCase):
    def setUp(self):
        self.sdk = ChessActionSDK()

    def test_legal_move(self):
        d = self.sdk.run("đi tốt e2 đến e4")
        self.assertTrue(d.approved)
        self.assertEqual(d.san, "e4")
        self.assertEqual(d.uci, "e2e4")
        self.assertNotEqual(d.fen_before, d.fen_after)

    def test_illegal_move_no_change(self):
        d = self.sdk.run("e2e5")
        self.assertEqual(d.reason, "ILLEGAL_CHESS_MOVE")
        self.assertEqual(d.fen_before, d.fen_after)

    def test_negated_phrase(self):
        d = self.sdk.run("không đi e2e4")
        self.assertEqual(d.reason, "NEGATED_COMMAND")
        self.assertEqual(d.execution, "NO_OP")

    def test_piece_mismatch(self):
        self.assertEqual(self.sdk.run("mã e2 e4").reason, "PIECE_MISMATCH")

    def test_estop_priority(self):
        self.sdk.run("dừng lại")
        self.assertEqual(self.sdk.run("e2e4").reason, "ESTOP_LATCHED")
        self.assertFalse(self.sdk.reset_estop())
        self.assertTrue(self.sdk.reset_estop(operator_ack=True))
        self.assertTrue(self.sdk.run("e2e4").approved)

    def test_keepout(self):
        self.sdk.keepout = True
        self.assertEqual(self.sdk.run("e2e4").reason, "KEEP_OUT")

    def test_heartbeat(self):
        self.sdk.heartbeat = False
        self.assertEqual(self.sdk.run("e2e4").reason, "HEARTBEAT_LOST")

    def test_source(self):
        self.assertEqual(self.sdk.run("e2e4", provenance="web_speech").reason, "UNVERIFIED_PERCEPTION")
        self.assertEqual(self.sdk.run("e2e4", branch="B", provenance="recorded_audio", confidence=1).reason, "UNTRAINED_AUDIO_MODEL")

    def test_branch_b_synthetic(self):
        self.assertEqual(self.sdk.run("e2e4", branch="B", provenance="synthetic", confidence=.82).reason, "LOW_CONFIDENCE")
        self.assertTrue(self.sdk.run("e2e4", branch="B", provenance="synthetic", confidence=.94).approved)

    def test_live_execution_disabled(self):
        self.sdk.simulation = False
        self.assertEqual(self.sdk.run("e2e4").reason, "REAL_ACTUATION_DISABLED")

    def test_robot_cannot_play_illegal_reply(self):
        self.sdk.run("e2e4")
        with self.assertRaises(ValueError):
            self.sdk.apply_opponent_uci("e7e4")
        self.assertEqual(self.sdk.apply_opponent_uci("e7e5"), "e5")

    def test_incomplete_multi_command(self):
        self.assertEqual(self.sdk.run("e2e4 rồi e7e5").reason, "UNRECOGNIZED_GRAMMAR")

    def test_policy_version(self):
        self.assertEqual(self.sdk.run("e2e4", policy_version=999).reason, "POLICY_VERSION_MISMATCH")


if __name__ == "__main__":
    unittest.main()
