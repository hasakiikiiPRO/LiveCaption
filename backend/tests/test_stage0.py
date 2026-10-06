"""Stage-0 regression tests: timestamps, translation timeout, prompt presets, VAD settings.

Run (backend must NOT need to be running; this starts its own copy in-process):
  cd ~/LiveCaption && venv/bin/python backend/tests/test_stage0.py

Speech fixtures are synthesized once with edge-tts and cached in backend/tests/fixtures/.
"""
import asyncio
import json
import os
import subprocess
import sys
import threading
import time

import httpx
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
FIXTURES = os.path.join(HERE, "fixtures")
EDGE_TTS_PY = os.path.expanduser("~/.local/share/uv/tools/edge-tts/bin/python")
SR = 16000

sys.path.insert(0, BACKEND)
os.environ.pop("ANTHROPIC_BASE_URL", None)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["LIVECAPTION_NO_LOCAL_CONFIG"] = "1"

import main  # noqa: E402  (path set above)

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))


def speech_fixture(name, text):
    """Return 16 kHz float32 speech for `text`, synthesizing and caching it on first use."""
    os.makedirs(FIXTURES, exist_ok=True)
    mp3 = os.path.join(FIXTURES, f"{name}.mp3")
    if not os.path.exists(mp3):
        for _ in range(4):
            r = subprocess.run([EDGE_TTS_PY, "-m", "edge_tts", "--voice", "en-US-AndrewNeural",
                                "--text", text, "--write-media", mp3], capture_output=True, timeout=60)
            if r.returncode == 0 and os.path.getsize(mp3) > 1000:
                break
            time.sleep(2)
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", mp3, "-f", "s16le", "-ac", "1", "-ar", str(SR), "pipe:1"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def silence(seconds):
    return np.zeros(int(seconds * SR), dtype=np.float32)


def to_pcm16(x):
    return (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()


# ---------------------------------------------------------------------------------------------
# Run the real FastAPI app in-process on a free port and talk to it over a real WebSocket.
# ---------------------------------------------------------------------------------------------
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


async def run_session(port, frames, config_events=None, target_lang="none", tail_wait=3.0):
    """Send config + audio frames; return list of subtitle events.

    config_events: {frame_index: extra_config_dict} sent just before that frame.
    """
    import websockets
    events = []
    base_cfg = {"event": "config", "ollama_url": "", "model_name": "", "deepseek_key": "",
                "min_silence": 0.3, "max_speech": 4.0, "source_lang": "auto", "target_lang": target_lang}
    async with websockets.connect(f"ws://127.0.0.1:{port}/stream", max_size=None) as ws:
        async def reader():
            try:
                async for msg in ws:
                    if isinstance(msg, str):
                        d = json.loads(msg)
                        if d.get("event") == "subtitle":
                            events.append(d)
            except Exception:
                pass
        rt = asyncio.create_task(reader())
        await ws.send(json.dumps(base_cfg))
        for i, fr in enumerate(frames):
            if config_events and i in config_events:
                await ws.send(json.dumps({**base_cfg, **config_events[i]}))
            await ws.send(fr)
            await asyncio.sleep(0)  # yield; send much faster than real time
        await asyncio.sleep(tail_wait)
        await ws.close()
        rt.cancel()
    return events


def frames_of(audio, n=4096):
    return [to_pcm16(audio[i:i + n]) for i in range(0, len(audio), n)]


# =============================================================================================
# 1. Timestamps must be seconds of stream time, and survive a config change (VAD rebuild).
# =============================================================================================
def test_timestamps(port):
    s1 = speech_fixture("s1", "C is a twenty eight year old woman presenting to the emergency room with a throbbing headache.")
    s2 = speech_fixture("s2", "Six months earlier, Casey started having massive abdominal cramps once a month.")
    lead, gap = 2.0, 2.0
    audio = np.concatenate([silence(lead), s1, silence(gap), s2, silence(1.5)])
    frames = frames_of(audio)
    s2_start = lead + len(s1) / SR + gap
    # Send a config change in the middle of the gap (forces a VAD rebuild in the old code).
    change_at = int((lead + len(s1) / SR + gap / 2) * SR) // 4096
    ev = asyncio.run(run_session(port, frames, config_events={change_at: {"min_silence": 0.3}}))
    starts = sorted({round(e["start"], 2) for e in ev})
    print(f"      subtitle starts={starts}  expected ~[{lead:.2f}, {s2_start:.2f}]")
    check("1a timestamps are seconds (first sentence starts near 2.0 s)",
          len(starts) >= 1 and abs(starts[0] - lead) < 0.6, f"got {starts[:1]}")
    check("1b timestamps survive a config change (second sentence near stream time)",
          len(starts) >= 2 and abs(starts[-1] - s2_start) < 0.6, f"got {starts[-1:] if starts else None}")


# =============================================================================================
# 2. Translation: slow relay must not be abandoned at 3.5 s; failures must not hang the session.
# =============================================================================================
def test_translation_timeout():
    import uvicorn
    from fastapi import FastAPI

    fake = FastAPI()
    state = {"delay": 0.0, "status": 200, "calls": 0}

    @fake.post("/v1/messages")
    async def messages():
        state["calls"] += 1
        await asyncio.sleep(state["delay"])
        if state["status"] != 200:
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": "boom"}, status_code=state["status"])
        return {"content": [{"type": "text", "text": "测试译文"}], "stop_reason": "end_turn"}

    port = 18977
    srv = uvicorn.Server(uvicorn.Config(fake, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    while not srv.started:
        time.sleep(0.05)

    os.environ["ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{port}"
    os.environ["ANTHROPIC_API_KEY"] = "test-key"
    os.environ["LIVECAPTION_DISABLE_GOOGLE"] = "1"  # keep the test offline and deterministic

    async def call():
        t0 = time.perf_counter()
        out = await main.translate_text("hello world", "zh-CN", "", "", None, "en", [])
        return out, time.perf_counter() - t0

    state.update(delay=4.5, status=200)
    out, dt = asyncio.run(call())
    check("2a relay answer after 4.5 s is used (no 3.5 s give-up)", out == "测试译文", f"got {out!r} in {dt:.1f}s")

    state.update(delay=0.0, status=500)
    out, dt = asyncio.run(call())
    check("2b relay error falls through quickly", dt < 2.0, f"{dt:.2f}s -> {out!r}")

    state.update(delay=30.0, status=200)
    out, dt = asyncio.run(call())
    check("2c relay hang is bounded (< 8 s)", dt < 8.0, f"{dt:.1f}s -> {out!r}")

    for k in ("ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "LIVECAPTION_DISABLE_GOOGLE"):
        os.environ.pop(k, None)
    srv.should_exit = True


# =============================================================================================
# 3. Prompt presets: default must not carry the hard-coded Japanese adult-drama glossary.
# =============================================================================================
def test_prompt_presets():
    build = getattr(main, "build_system_prompt", None)
    check("3a build_system_prompt() exists", callable(build))
    if not callable(build):
        return
    default = build("簡體中文 (Simplified Chinese)", None)
    check("3b default preset has no adult/JP glossary", "罩杯" not in default and "高潮" not in default)
    check("3c default preset keeps ASR-error-correction rule", "语音识别" in default or "ASR" in default)
    lecture = build("簡體中文 (Simplified Chinese)", "lecture")
    check("3d lecture preset is distinct", lecture != default and "术语" in lecture)
    drama = build("簡體中文 (Simplified Chinese)", "drama")
    check("3e drama preset exists and differs", drama != default)
    check("3f unknown preset falls back to default", build("x", "nope") == build("x", None))


# =============================================================================================
# 4. VAD settings from the panel must be honoured (not clamped to <=0.3 s / <=4 s).
# =============================================================================================
def test_vad_settings():
    parse = getattr(main, "parse_vad_settings", None)
    check("4a parse_vad_settings() exists", callable(parse))
    if not callable(parse):
        return
    check("4b user min_silence 0.8 is honoured", parse({"min_silence": 0.8, "max_speech": 8})[0] == 0.8)
    check("4c user max_speech 8 is honoured", parse({"min_silence": 0.8, "max_speech": 8})[1] == 8.0)
    d = parse({})
    check("4d defaults stay 0.3 s / 4 s", d == (0.3, 4.0), f"got {d}")
    check("4e out-of-range values are clamped to panel range",
          parse({"min_silence": 5, "max_speech": 99}) == (1.2, 12.0) and parse({"min_silence": 0.0, "max_speech": 0})[0] == 0.2)
    check("4f garbage falls back to defaults", parse({"min_silence": "abc", "max_speech": None}) == (0.3, 4.0))


if __name__ == "__main__":
    PORT = 18976
    start_server(PORT)
    test_timestamps(PORT)
    test_translation_timeout()
    test_prompt_presets()
    test_vad_settings()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)
