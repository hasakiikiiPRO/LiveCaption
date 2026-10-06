"""SenseVoice decode-time benchmark (no network). Feeds 1/3/5/8 s of audio and times decode.

Run: venv/bin/python backend/bench_asr.py
"""
import os
import time

import numpy as np
import sherpa_onnx

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SV_DIR = os.path.join(BASE_DIR, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")

recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=os.path.join(SV_DIR, "model.int8.onnx"),
    tokens=os.path.join(SV_DIR, "tokens.txt"),
    num_threads=4,
    use_itn=True,
)

rng = np.random.default_rng(0)
for seconds in (1, 3, 5, 8):
    # Speech-band noise: decode cost depends on frame count, not on content.
    samples = (rng.standard_normal(16000 * seconds) * 0.05).astype(np.float32)
    runs = []
    for _ in range(3):
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        t0 = time.perf_counter()
        recognizer.decode_stream(stream)
        runs.append(time.perf_counter() - t0)
    print(f"audio={seconds}s  decode best={min(runs) * 1000:6.1f} ms  worst={max(runs) * 1000:6.1f} ms")
