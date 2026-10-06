"""Edge-TTS benchmark for the dubbing plan: latency, reliability, and dub-vs-source duration.

For each line, the English source is synthesized with an en-US voice (a stand-in for how long
a speaker takes to say it) and the Chinese translation with a zh-CN voice (the dub). Both use
the default rate. Failures are reported, not retried, because reliability is being measured.

Run with the edge-tts tool interpreter (unbuffered so partial output survives a timeout):
  ~/.local/share/uv/tools/edge-tts/bin/python -u backend/bench_tts.py [proxy_url]
"""
import asyncio
import statistics
import subprocess
import sys
import time

import edge_tts

ZH_VOICE = "zh-CN-YunxiNeural"
EN_VOICE = "en-US-AndrewNeural"
# Source/translation pairs from transcripts/transcript_20261006_162751.md
PAIRS = [
    ("woman had a three day long headache this is what her kidney did to her liver.",
     "这女人头疼了整整三天，来看看她的肾是怎么折磨她肝脏的。"),
    ("C is a 28 year old woman presenting to the emergency room with a throbbing headache.",
     "C是一位28岁的女性，因剧烈的搏动性头痛前往急诊室就诊。"),
    ("Six months earlier, Casey started having massive abdominal cramps that would happen once a month.",
     "六个月前，凯西开始出现剧烈的腹部绞痛，且每月发作一次。"),
    ("told her it was her period, but it would happen at least a week before, and it was the worst pain she had ever experienced in her life.",
     "她跟医生说那是月经痛，但痛感总是在生理期前至少一周就开始了，而且那简直是她这辈子经历过最剧烈的疼痛。"),
    ("To that point, at an urgent Care Center she told.",
     "说到这，她在急诊中心时曾告诉医生。"),
]


def mp3_seconds(data: bytes) -> float:
    # Decode to raw 16 kHz mono s16le and count samples (ffprobe reports N/A for piped MP3).
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
        input=data, capture_output=True, check=True,
    ).stdout
    return len(pcm) / 2 / 16000


async def synth(text: str, voice: str, proxy):
    t0 = time.perf_counter()
    first = None
    buf = bytearray()
    comm = edge_tts.Communicate(text, voice, proxy=proxy, connect_timeout=8, receive_timeout=20)
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            if first is None:
                first = time.perf_counter() - t0
            buf.extend(chunk["data"])
    return first, time.perf_counter() - t0, mp3_seconds(bytes(buf))


async def attempt(text, voice, proxy):
    t0 = time.perf_counter()
    try:
        return await synth(text, voice, proxy), None
    except Exception as e:  # noqa: BLE001 - benchmark records failures as data
        return None, f"{type(e).__name__} after {time.perf_counter() - t0:.1f}s"


async def main():
    proxy = sys.argv[1] if len(sys.argv) > 1 else None
    print(f"proxy={proxy}  zh={ZH_VOICE}  en={EN_VOICE}")
    firsts, ratios, fails, calls = [], [], 0, 0
    for en, zh in PAIRS:
        en_res, en_err = await attempt(en, EN_VOICE, proxy)
        zh_res, zh_err = await attempt(zh, ZH_VOICE, proxy)
        calls += 2
        fails += (en_err is not None) + (zh_err is not None)
        en_s = f"{en_res[2]:5.2f}s" if en_res else f"FAIL({en_err})"
        if zh_res:
            firsts.append(zh_res[0])
            zh_s = f"{zh_res[2]:5.2f}s first_audio={zh_res[0]:4.2f}s total={zh_res[1]:4.2f}s {len(zh) / zh_res[2]:3.1f}字/秒"
        else:
            zh_s = f"FAIL({zh_err})"
        ratio = ""
        if en_res and zh_res:
            ratios.append(zh_res[2] / en_res[2])
            ratio = f"  zh/en={ratios[-1]:.2f}x"
        print(f"  [{len(en.split()):2d} words | {len(zh):2d} 字]  en={en_s}  zh={zh_s}{ratio}")
    print(f"  failures {fails}/{calls}")
    if firsts:
        print(f"  zh first_audio median={statistics.median(firsts):.2f}s max={max(firsts):.2f}s")
    if ratios:
        print(f"  dub/source duration ratio median={statistics.median(ratios):.2f}x  range={min(ratios):.2f}-{max(ratios):.2f}x")


asyncio.run(main())
