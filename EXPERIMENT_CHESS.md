# Speech2Action — Browser Chess / Virtual ESP32-S3 lab

**Research application.** Based on the design principles of [EdgeVox](https://github.com/nrl-ai/edgevox) and its [RookApp Desktop Chess Robot](https://github.com/nrl-ai/edgevox/blob/main/docs/documentation/desktop.md), not a port of PySide6, Stockfish or llama.cpp to a microcontroller.

## What is real in the browser

- Real chess legal move verification via the pinned `chess.js@1.4.0` browser ESM dependency (BSD-2-Clause).
- Deterministic command parser for Vietnamese text and UCI-style squares (`e2e4`).
- Exact negation rejection, policy version check, simulation-only actuator gate, legal-move check, STOP priority, keep-out, E-stop latch, source provenance and low-confidence rejection.
- Base27 A–Z+SPACE trit mapping and 5-symbol/24-bit round trip.
- Demo CRC8 frame and repeatable JSON audit; web performance timings are real **browser timings**, never ESP32-S3 measured data.
- Human user (white) versus lightweight chess-rule-based virtual Rook opponent (black). **Not Stockfish**.
- Optional local file WAV inspection / browser-derived spectrogram, **not a trained recognizer**.

## What is simulated

- ESP32-S3 "device" is a constrained **digital twin UI** with memory budgets / serial packet examples. No ESP32-S3 Xtensa ISA, QEMU, peripherals, GPIO, timer, or firmware compiled or executed in browser.
- Path A is **typed text** standing in for EdgeVox Sherpa-STT output. No acoustic confidence; its provenance is exact typed input only.
- Path B accepts explicit **synthetic CNN predictions** (confidence selected by the tester). WAV inputs do not authorize moves without a trained and calibrated model.
- Browser speechSynthesis, if enabled, is platform voice, **not VieNeu-TTS**.

## Lab usage

1. Visit site root (Pages artifact from `site/`). Choose branch A or B.
2. Type "đi tốt e2 đến e4", "mã g1 f3", or simply "e2e4"; press Run.
3. Observe the two stage proposals and shared Safety Gate. Illegal moves, "không đi e2e4", keep-out, E-stop, and low confidence are NO_OP.
4. Click a white piece and destination on the chessboard to submit a typed command through the same Safety Gate.
5. Export JSON audit with input provenance, proposal, policy result, FEN, action and browser timing. Download is local only.
6. Try WAV: spectrogram renders with real audio features; no action is inferred until Vietnamese classifier is trained.

## On-device experiment

A practical MCU path runs (1) front-end VAD/audio as available; (2) a bounded classifier with measured INT8 or ternary kernels; (3) a C/C++ policy built from the same golden test vectors; (4) hardware watchdog and independent physical E-stop. It should not try to run complete EdgeVox RookApp and the large Gemma/Stockfish runtime on ESP32-S3.

Suggested measurements: held-out Vietnamese speakers/dialects, false-actuation count, STOP/controller-neutral P95/P99, actual firmware PSRAM/Flash, cycles/inference, measured Joules, and wire integrity. Never infer hardware latency from browser performance.

### Development checks

```sh
node --test site/tests.mjs
node --check site/app.mjs
python -m unittest discover -s tests -p test_robot_voice_sdk.py -v
```

### Attribution / licensing

- Project extension: Long Ngo, MIT repository license.
- EdgeVox / RookApp: nrl-ai/edgevox (MIT). The original desktop program is separate.
- chess.js 1.4.0: Jeff Hlywa, BSD-2-Clause; loaded from a pinned public CDN. Full chess validation requires this module to load.
- Stockfish: GPL; not embedded in the browser demo. Browser opponent is a simple own-code heuristic.
