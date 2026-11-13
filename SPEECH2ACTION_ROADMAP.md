# Speech2Action — lộ trình nghiên cứu CVNSS4.0 / Base27 / Trit / Firmware

**Long Ngo · experimental research · MIT · 2026**

## Thesis

Speech2Action studies safe Vietnamese speech-command compilation into typed, bounded robot actions.
Compare **A** (audio → EdgeVox Sherpa-ONNX STT → Unicode/CVNSS policy → action) with **B**
(audio → log-mel → small INT8/ternary classifier → action). Both must pass **the same**
deterministic safety gate before ROS2/simulation/firmware output.

## Reuse decisions

| Existing component | What to reuse | What remains unproven |
|---|---|---|
| EdgeVox | Vietnamese Sherpa Zipformer, ROS2 bridge, IR-SIM/MuJoCo | STT output does not include calibrated action confidence |
| CVNSS4.0 / vifirmware | Canonical command lexicon, NFC audit, possible ASCII communication | Current demo annotations are not the complete verified codec |
| Base27 / morsetrit | Alphabet A-Z + SPACE; each symbol is three trits | 27=3^3 is a bijection, not an error-correcting code |
| Tinytrit / ternary-eco | Compare -1,0,+1 weights against INT8 | ESP32-S3 has binary vector instructions, not native ternary compute |
| BilaScript / NHDL | Typed policy DSL; C or VHDL compilation | Compiler equivalence and safe firmware deployment |
| ESP32-S3 | Firmware watchdog, bounded commands, optional trained tiny Vietnamese classifier | ESP-SR MultiNet official recognition models cover English/Chinese, not Vietnamese |
| VieNeu v1.2.4 | Spoken Vietnamese feedback from host PC/Jetson | 0.3B–0.5B models not appropriate to assume ESP32-S3 native |
| NeuDecide v0.1.0a1 | English direct speech-to-tool comparator | English only and lacks calibrated confidence |

## Portable action contract

Action IDs: 0 STOP; 1 FORWARD; 2 BACK; 3 LEFT; 4 RIGHT; 5 GRASP.
Packet envelope should include: version, sequence number, action_id, bounded parameters,
TTL, policy version, source, confidence provenance, message authentication tag.
Treat CRC as accidental-corruption detection only, not authentication.

Fail-safe principles: unknown/compound/negated input → reject; stale/unsigned/replayed packets
→ reject; no heartbeat → zero motor output; manual independent hardware E-stop.
An exact STOP may bypass the slow model pipeline but **must not be the only emergency stop**.

## Base27 and balanced ternary technical facts

Choose alphabet: A=0, ..., Z=25, SPACE=26. Value k in [0,26]:
k = 9*t2 + 3*t1 + t0, with trits in {0,1,2}.
Balanced trits can be (t2-1,t1-1,t0-1), which are in {-1,0,+1}.
The mapping is lossless **only for the defined alphabet**.

5 symbols fit in 24 bits because 27^5=14,348,907 < 2^24.
Theoretical 4.8 bits/symbol for complete 5-character groups
(vs 8 bits/symbol ASCII: 40% less, ignoring headers, padding and checks).
For just six commands, transmit uint8 action_id, NOT full Base27 text.
A ternary weight packer can fit five {-1,0,1} weights in one byte (~1.6 bits per weight);
benchmark unpack cost and MAC throughput against ESP-DL w8a8/w8a16 INT8.

## Reproducible experimental plan

E0: static exact-text commands, adversarial negation, out-of-vocabulary, stop and keepout, no-actuation invariant.
E1: recorded Vietnamese WAV commands with speaker-disjoint splits, dialects, noise, levels, NFC/NFD.
E2: EdgeVox STT + Unicode whitelist vs verified CVNSS4.0 canonical policy; inspect ambiguity and round-trip.
E3: 6-action + UNKNOWN direct log-mel CNN in ONNX; confidence calibration and false-actuation rate.
E4: int8 vs ternary weight models with same training/test sets; run on actual ESP32-S3 after export.
E5: UART/Wi-Fi packet loss, delayed/replayed packets, watchdog timeout, link failure, motor neutral timing.
E6: optional FPGA/NHDL target only after code-generation and fixed-point equivalence tests.

Publish exact data hashes, held-out speakers, model hashes, seed/config, CPU/MCU frequency,
peak RAM/PSRAM, flash bytes, measured energy, latency P50/P95/P99, accuracy/F1,
false actuation and false rejection plus hardware stop latency.
Do not substitute browser animation delay for measured inference latency.

## Implementation stages

- P0: safety-first SDK, reproducible unit tests and browser synthetic lab.
- P1: WAV corpus and calibrated confidence or abstention; direct STOP path.
- P2: verified CVNSS4.0 codec + Base27 framing and golden tests; separate ESP32-S3 gate firmware.
- P3: small Vietnamese CNN, ESP-DL INT8 baseline, ternary ablation.
- P4: ROS2 + IR-SIM/MuJoCo field evaluation, FPGA compiler/firmware HIL, preprint.

## Commands

    python -m unittest discover -s tests -p test_robot_voice_sdk.py -v
    python -m robot_voice_sdk --text "xoay trái"
    python -m robot_voice_sdk --text "không tiến lên"

A static synthetic demonstration lives at site/index.html.
Reference: https://github.com/nrl-ai/edgevox
https://github.com/espressif/esp-dl
https://github.com/espressif/esp-sr
https://pypi.org/project/vieneu/1.2.4/
https://pypi.org/project/neudecide/0.1.0a1/
