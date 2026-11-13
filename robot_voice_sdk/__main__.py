"""python -m robot_voice_sdk --text 'xoay trái'  (simulation only)"""

import argparse
import json

from .sdk import Speech2ActionSDK


def main():
    parser = argparse.ArgumentParser(description="Speech2Action safe Vietnamese command demo")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--text", help="Exact Vietnamese text command (simulator)")
    group.add_argument("--wav", help="16 kHz mono PCM16 WAV (EdgeVox Sherpa)")
    parser.add_argument("--confidence", type=float, default=None, help="Externally calibrated confidence")
    parser.add_argument("--calibrated", action="store_true", help="Assert independent score calibration")
    args = parser.parse_args()
    sdk = Speech2ActionSDK()
    if args.text is not None:
        result = sdk.process_text(args.text)
    else:
        result = sdk.process_wav(
            args.wav, confidence=args.confidence, evidence="calibrated" if args.calibrated else "uncalibrated"
        )
    print(
        json.dumps(
            {
                "action_id": result.proposal.action_id,
                "decision": result.decision.reason,
                "approved": result.decision.approved,
                "execution": result.execution,
                "latency_ms": round(result.latency_ms, 3),
                "trace": result.trace,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
