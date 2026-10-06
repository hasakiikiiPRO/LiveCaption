"""Test Stage 1: Edge-TTS synthesis and websocket dubbing_audio event delivery.

Run:
  cd ~/LiveCaption && venv/bin/python backend/tests/test_stage1_tts.py
"""
import asyncio
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

os.environ["LIVECAPTION_NO_LOCAL_CONFIG"] = "1"
os.environ["LIVECAPTION_DISABLE_GOOGLE"] = "1"

import main

results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))

def test_synth():
    text = "这是一句测试同传配音。"
    t0 = time.perf_counter()
    data = asyncio.run(main.synthesize_edge_tts(text))
    dt = time.perf_counter() - t0
    check("1a synthesize_edge_tts returns bytes", len(data) > 1000, f"size={len(data)} in {dt:.2f}s")

if __name__ == "__main__":
    test_synth()
    failed = [n for n, ok in results if not ok]
    sys.exit(1 if failed else 0)
