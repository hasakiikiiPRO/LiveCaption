"""Test Stage 1 End-to-End: Speech audio -> ASR -> Translation -> Dubbing Audio Event.

Run:
  cd ~/LiveCaption && venv/bin/python backend/tests/test_stage1_e2e.py
"""
import asyncio
import base64
import json
import os
import subprocess
import sys
import threading
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
FIXTURES = os.path.join(HERE, "fixtures")
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

async def run_e2e():
    import websockets
    port = 18978
    start_server(port)
    
    # 准备测试音频：使用 Stage 0 的 s1 音频片段
    mp3_path = os.path.join(FIXTURES, "s1.mp3")
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", mp3_path, "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
                         capture_output=True, check=True).stdout
    speech = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    silence = np.zeros(int(1.5 * 16000), dtype=np.float32)
    audio = np.concatenate([speech, silence])
    
    chunks = [(np.clip(audio[i:i + 4096], -1, 1) * 32767).astype(np.int16).tobytes() for i in range(0, len(audio), 4096)]
    
    subtitles = []
    dubbing_audios = []
    
    async with websockets.connect(f"ws://127.0.0.1:{port}/stream") as ws:
        # 开启同传配音，使用云希男声
        cfg = {
            "event": "config",
            "source_lang": "en",
            "target_lang": "zh-CN",
            "dubbing_enabled": True,
            "tts_voice": "yunxi",
            "min_silence": 0.3,
            "max_speech": 4.0
        }
        await ws.send(json.dumps(cfg))
        
        async def reader():
            try:
                async for msg in ws:
                    d = json.loads(msg)
                    if d.get("event") == "subtitle":
                        subtitles.append(d)
                    elif d.get("event") == "dubbing_audio":
                        dubbing_audios.append(d)
            except Exception:
                pass
                
        r_task = asyncio.create_task(reader())
        
        for c in chunks:
            await ws.send(c)
            await asyncio.sleep(0.01)
            
        # 等待后台翻译与 Edge-TTS 合成返回（通常在 3-5 秒内完成）
        for _ in range(35):
            if len(dubbing_audios) > 0:
                break
            await asyncio.sleep(0.2)
            
        await ws.close()
        r_task.cancel()
        
    check("1a received subtitle events", len(subtitles) > 0, f"count={len(subtitles)}")
    check("1b received dubbing_audio event", len(dubbing_audios) > 0, f"count={len(dubbing_audios)}")
    if dubbing_audios:
        first_dub = dubbing_audios[0]
        b64 = first_dub.get("audio_base64", "")
        raw_bytes = base64.b64decode(b64)
        check("1c dubbing audio has valid MP3 payload", len(raw_bytes) > 2000, f"bytes={len(raw_bytes)}, text={first_dub.get('text')}")

if __name__ == "__main__":
    asyncio.run(run_e2e())
    failed = [n for n, ok in results if not ok]
    sys.exit(1 if failed else 0)
