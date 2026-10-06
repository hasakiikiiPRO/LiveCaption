"""Test Stage 2: Batch Dubbing Pre-fetching API (YouTube Transcript Fast-Path).

Run:
  cd ~/LiveCaption && venv/bin/python backend/tests/test_batch_dubbing.py
"""
import asyncio
import base64
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

def start_server(port):
    import uvicorn
    config = uvicorn.Config(main.app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(300):
        if server.started:
            return server
        time.sleep(0.1)
    raise RuntimeError("server did not start")

async def run_batch_test():
    import websockets
    port = 18979
    start_server(port)

    batch_resp = None

    async with websockets.connect(f"ws://127.0.0.1:{port}/stream") as ws:
        req = {
            "event": "batch_dubbing_request",
            "target_lang": "zh-CN",
            "tts_voice": "yunxi",
            "items": [
                { "id": 101, "text": "Welcome to today's medical lecture.", "start": 1.2, "duration": 2.4 },
                { "id": 102, "text": "We will study the human nervous system.", "start": 4.0, "duration": 3.1 }
            ]
        }
        await ws.send(json.dumps(req))

        # 等待批量响应
        for _ in range(80):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=0.2)
                d = json.loads(msg)
                if d.get("event") == "batch_dubbing_response":
                    batch_resp = d
                    break
            except asyncio.TimeoutError:
                pass
            except Exception:
                break

    check("2a received batch_dubbing_response", batch_resp is not None)
    if batch_resp:
        items = batch_resp.get("items", [])
        check("2b batch contains items", len(items) >= 2, f"count={len(items)}")
        if items:
            check("2c first item has valid translation & audio",
                  bool(items[0].get("text_zh")) and len(base64.b64decode(items[0].get("audio_base64", ""))) > 2000,
                  f"text_zh={items[0].get('text_zh')}, audio_size={len(items[0].get('audio_base64', ''))}")

if __name__ == "__main__":
    asyncio.run(run_batch_test())
    failed = [n for n, ok in results if not ok]
    sys.exit(1 if failed else 0)
