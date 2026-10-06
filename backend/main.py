import os
import re
import json
import base64
import asyncio
import numpy as np
import httpx
import edge_tts
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import sherpa_onnx
from opencc import OpenCC

# 初始化簡繁體轉換器
cc_s2t = OpenCC('s2t')
cc_t2s = OpenCC('t2s')

app = FastAPI(title="Studio0808_LiveCaption Backend")

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
import sys
if getattr(sys, 'frozen', False):
    # 打包後的執行檔路徑（LiveCaptionServer.exe 所在的目錄）
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # 開發模式下的 Python 檔案路徑
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

VAD_MODEL_PATH = os.path.join(BASE_DIR, "silero_vad.onnx")

# Find SenseVoice directory
SENSE_VOICE_DIR = os.path.join(BASE_DIR, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")
SENSE_VOICE_MODEL = os.path.join(SENSE_VOICE_DIR, "model.int8.onnx")
SENSE_VOICE_TOKENS = os.path.join(SENSE_VOICE_DIR, "tokens.txt")

# Global models initialized on startup
vad_detector = None
asr_recognizer = None

def init_models():
    global vad_detector, asr_recognizer
    if vad_detector is not None and asr_recognizer is not None:
        return
    
    if not os.path.exists(VAD_MODEL_PATH):
        raise FileNotFoundError(f"找不到 VAD 模型: {VAD_MODEL_PATH}，請先執行 download_models.py")
    if not os.path.exists(SENSE_VOICE_MODEL):
        raise FileNotFoundError(f"找不到 SenseVoice 模型: {SENSE_VOICE_MODEL}，請先執行 download_models.py")
        
    print("正在初始化 Silero VAD 模型...")
    vad_config = sherpa_onnx.VadModelConfig(
        silero_vad=sherpa_onnx.SileroVadModelConfig(
            model=VAD_MODEL_PATH,
            threshold=0.4,
            min_silence_duration=0.5,  # 0.5 秒靜音判定為說話結束
            min_speech_duration=0.15,
            max_speech_duration=10.0,  # 最長單句 10 秒強迫切分
        ),
        sample_rate=16000,
    )
    vad_detector = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=30)
    
    print("正在初始化 SenseVoice ASR 模型...")
    asr_recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=SENSE_VOICE_MODEL,
        tokens=SENSE_VOICE_TOKENS,
        num_threads=4,
        use_itn=True,
    )
    print("所有離線 AI 模型載入成功！")

# 追蹤閒置連線與釋放記憶體/顯存相關變數
active_connections = 0
last_active_time = None

async def monitor_idle_timeout():
    global asr_recognizer, vad_detector, active_connections, last_active_time
    import gc
    import time
    # 閒置超時時間設定為 10 分鐘 (600 秒)
    IDLE_TIMEOUT = 600
    
    while True:
        await asyncio.sleep(30)  # 每 30 秒檢查一次
        if active_connections == 0 and last_active_time is not None:
            elapsed = time.time() - last_active_time
            if elapsed >= IDLE_TIMEOUT and asr_recognizer is not None:
                print(f"後端閒置已達 {IDLE_TIMEOUT // 60} 分鐘，開始主動釋放 AI 模型資源...")
                asr_recognizer = None
                vad_detector = None
                gc.collect()
                print("後端 AI 模型資源釋放完成！")

@app.on_event("startup")
def startup_event():
    try:
        init_models()
        # 啟動閒置監控工作
        asyncio.create_task(monitor_idle_timeout())
    except Exception as e:
        print(f"啟動初始化失敗: {e}")

def clean_sense_voice_text(text: str) -> str:
    # 移除 SenseVoice 的特有標籤，例如 <|zh|>, <|NEUTRAL|>, <|speech|> 等
    cleaned = re.sub(r'<\|.*?\|>', '', text)
    # 清理多餘空白
    return cleaned.strip()

SAMPLE_RATE = 16000

# VAD 斷句參數：預設值與外掛面板滑桿範圍（popup.html 的 min/max）一致
VAD_DEFAULT_MIN_SILENCE = 0.3
VAD_DEFAULT_MAX_SPEECH = 4.0
VAD_MIN_SILENCE_RANGE = (0.2, 1.2)
VAD_MAX_SPEECH_RANGE = (2.0, 12.0)


def parse_vad_settings(config_data: dict) -> tuple:
    """取用戶在面板設定的 VAD 參數；缺少或無效時用預設值，超出面板範圍時夹到邊界。"""
    def pick(key, default, bounds):
        try:
            value = float(config_data.get(key))
        except (TypeError, ValueError):
            return default
        if value != value:  # NaN
            return default
        return min(max(value, bounds[0]), bounds[1])

    return (
        pick("min_silence", VAD_DEFAULT_MIN_SILENCE, VAD_MIN_SILENCE_RANGE),
        pick("max_speech", VAD_DEFAULT_MAX_SPEECH, VAD_MAX_SPEECH_RANGE),
    )


def make_vad(min_silence: float, max_speech: float):
    config = sherpa_onnx.VadModelConfig(
        silero_vad=sherpa_onnx.SileroVadModelConfig(
            model=VAD_MODEL_PATH,
            threshold=0.4,
            min_silence_duration=min_silence,
            min_speech_duration=0.15,
            max_speech_duration=max_speech,
        ),
        sample_rate=SAMPLE_RATE,
    )
    return sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)


# 翻譯提示詞預設（外掛面板「翻譯場景」選單選擇）。所有預設共用 ASR 糾錯與輸出規則。
TRANSLATION_PRESETS = {
    "general": (
        "你是一个专业的视频字幕实时翻译。",
        "译文自然、口语化，简洁易懂。",
    ),
    "lecture": (
        "你是一个专业的网课与学术讲座字幕翻译。",
        "专业术语使用该领域公认的中文译名，常见缩写（如 CT、GPU）保留英文；表达准确、条理清楚。",
    ),
    "drama": (
        "你是一个影视剧字幕翻译。",
        "贴合人物语气和剧情氛围，口语地道，保留情绪，不要书面化。",
    ),
    "news": (
        "你是一个新闻与访谈字幕翻译。",
        "用词规范客观，人名、地名、机构名使用通行译名。",
    ),
}
DEFAULT_PRESET = "general"


def build_system_prompt(target_name: str, preset: str = None) -> str:
    role, style = TRANSLATION_PRESETS.get(preset or DEFAULT_PRESET, TRANSLATION_PRESETS[DEFAULT_PRESET])
    return (
        f"{role}\n"
        "【规则】\n"
        "1. 输入来自实时语音识别（ASR），可能有同音错字、断句不当或漏字。请结合前文语境判断原意后再翻译，不要逐字硬译。\n"
        f"2. {style}\n"
        "3. 译文长度尽量和原句相当，适合作为字幕阅读。\n"
        f"4. 只输出翻译好的{target_name}，不要任何解释、前缀或引号。"
    )


# 中繼翻譯逾時：實測 p99 約 3.1 s；讀取等待最多 6 s，連線建立 2 s 內失敗就降級。
RELAY_TIMEOUT = httpx.Timeout(6.0, connect=2.0)

# Edge-TTS 音色映射
TTS_VOICE_MAP = {
    "yunxi": "zh-CN-YunxiNeural",
    "xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "yunjian": "zh-CN-YunjianNeural",
    "yunyang": "zh-CN-YunyangNeural",
}
DEFAULT_TTS_VOICE = "zh-CN-YunxiNeural"

async def synthesize_edge_tts(text: str, voice: str = None, rate: str = "+0%") -> bytes:
    """使用 Edge-TTS 合成 MP3 音訊字節，優先走代理並自帶 1 次快速重試，超時限制嚴格把控，失敗靜默跳過不阻礙字幕。"""
    if not text or not text.strip():
        return b""
    clean_text = text.strip()
    target_voice = TTS_VOICE_MAP.get(voice, voice or DEFAULT_TTS_VOICE)
    proxy_url = os.environ.get("HTTP_PROXY") or "http://127.0.0.1:7897"

    for attempt in range(2):
        try:
            comm = edge_tts.Communicate(clean_text, target_voice, rate=rate, proxy=proxy_url, connect_timeout=4, receive_timeout=6)
            buf = bytearray()
            async with asyncio.timeout(5.0):
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        buf.extend(chunk["data"])
            if buf:
                return bytes(buf)
        except Exception as e:
            if attempt == 1:
                print(f"Edge-TTS 合成失敗（{type(e).__name__}）: {e}")
            await asyncio.sleep(0.1)
    return b""


def load_relay_config():
    """環境變數優先，其次是 backend/config.local.json（不進 git）。"""
    local_cfg = {}
    cfg_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.local.json")
    if not os.environ.get("LIVECAPTION_NO_LOCAL_CONFIG") and os.path.exists(cfg_file):
        try:
            with open(cfg_file, "r", encoding="utf-8") as f:
                local_cfg = json.load(f)
        except Exception:
            pass
    base = os.environ.get("ANTHROPIC_BASE_URL") or local_cfg.get("relay_base")
    key = os.environ.get("ANTHROPIC_API_KEY") or local_cfg.get("relay_key")
    return base, key


# 全局變數，用來快取 Ollama 是否在線，避免每次都等待 3 秒超時
ollama_online = True

LANG_MAP = {
    "zh-TW": "繁體中文 (Traditional Chinese)",
    "zh-CN": "簡體中文 (Simplified Chinese)",
    "en": "英文 (English)",
    "ja": "日文 (Japanese)",
    "ko": "韓文 (Korean)",
    "es": "西班牙文 (Spanish)",
    "fr": "法文 (French)",
    "de": "德文 (German)",
    "ru": "俄文 (Russian)",
}
ollama_online = False
http_client = None

def get_http_client():
    global http_client
    if http_client is None or http_client.is_closed:
        proxy_url = os.environ.get("HTTP_PROXY") or "http://127.0.0.1:7897"
        http_client = httpx.AsyncClient(
            proxy=proxy_url,
            timeout=3.0,
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
        )
    return http_client

async def translate_text(text: str, target_lang: str, ollama_url: str, model_name: str, deepseek_key: str = None, source_lang: str = "auto", context_history: list = None, preset: str = None) -> str:
    global ollama_online
    """
    四軌翻譯引擎：支援高效能中繼 (Gemini 3.1 Flash-Lite)、線上 DeepSeek API、本機 Ollama、以及免費 Google Translate API。
    """
    target_name = LANG_MAP.get(target_lang, "簡體中文")
    system_prompt = build_system_prompt(target_name, preset)

    user_content = text
    if context_history:
        ctx_str = "\n".join([f"「{h}」" for h in context_history if h])
        if ctx_str:
            user_content = f"【前文语境参考】\n{ctx_str}\n\n【待翻译字幕】\n{text}"

    # 0. 優先使用中繼 API (Gemini 3.1 Flash-Lite)
    relay_base, relay_key = load_relay_config()
    if relay_base and relay_key:
        try:
            async with httpx.AsyncClient(timeout=RELAY_TIMEOUT) as client:
                r = await client.post(
                    f"{relay_base.rstrip('/')}/v1/messages",
                    headers={
                        "x-api-key": relay_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": "gemini-3.1-flash-lite",
                        "max_tokens": 60,
                        "system": system_prompt,
                        "messages": [{"role": "user", "content": user_content}]
                    }
                )
                if r.status_code == 200:
                    res_json = r.json()
                    for c in res_json.get("content", []):
                        if c.get("type") == "text" and c.get("text"):
                            return c.get("text").strip()
                else:
                    print(f"中繼翻譯回應 HTTP {r.status_code}，改用備援翻譯")
        except Exception as e:
            print(f"中繼翻譯失敗（{type(e).__name__}），改用備援翻譯: {e}")

    # 1. 優先嘗試 DeepSeek API (若有提供 API Key)
    if deepseek_key and len(deepseek_key.strip()) > 10:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.post(
                    "https://api.deepseek.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {deepseek_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        # 舊模型代號 deepseek-chat 已於 2026-07-24 停用，改用 V4-Flash
                        "model": "deepseek-v4-flash",
                        "messages": [
                            {"role": "system", "content": f"你是一個專業的影片字幕即時翻譯官。請將輸入的影片語音字幕，翻譯成簡短流暢的{target_name}。請只輸出翻譯後的文字，不要包含任何解釋、引言或額外標記，保持字數與原句差不多。"},
                            {"role": "user", "content": text}
                        ],
                        "temperature": 0.3
                    }
                )
                if response.status_code == 200:
                    res_json = response.json()
                    return res_json["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"DeepSeek 翻譯失敗: {e}")

    # 2. 本機離線 Ollama 翻譯
    if ollama_url and ollama_online:
        try:
            prompt = (
                f"你是一個專業的影片字幕即時翻譯官。請將輸入的影片語音字幕，翻譯成簡短流暢的{target_name}。請只輸出翻譯後的文字，不要包含任何解釋、引言或額外標記。\n\n"
                f"原文字幕：{text}\n"
                f"翻譯結果："
            )
            async with httpx.AsyncClient(timeout=0.6) as client:
                response = await client.post(
                    f"{ollama_url}/api/generate",
                    json={
                        "model": model_name,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.3,
                            "num_predict": 100
                        }
                    }
                )
                if response.status_code == 200:
                    res_json = response.json()
                    return res_json.get("response", "").strip()
        except Exception as e:
            print("偵測到本機 Ollama 未啟動，本工作階段後續將自動跳過 Ollama，避免連線超時延遲。")
            ollama_online = False

    # 3. 終極備用：免費 Google Translate Web API (免 Key、免配置、即開即用，長連接池)
    if os.environ.get("LIVECAPTION_DISABLE_GOOGLE"):
        return f"[未翻譯] {text}"
    try:
        client = get_http_client()
        url = "https://translate.googleapis.com/translate_a/single"
        sl_code = source_lang if (source_lang and source_lang != "auto") else "auto"
        params = {
            "client": "dict-chrome-ex",
            "sl": sl_code,
            "tl": target_lang,
            "dt": "t",
            "q": text
        }
        response = await client.get(url, params=params)
        if response.status_code == 200:
            res_json = response.json()
            translated = "".join([part[0] for part in res_json[0] if part[0]])
            return translated.strip()
    except Exception as e:
        print(f"Google 翻譯失敗: {e}")
        
    # 如果都失敗，則返回原文字
    return f"[未翻譯] {text}"

@app.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket):
    global active_connections, asr_recognizer, vad_detector
    await websocket.accept()
    active_connections += 1
    print(f"WebSocket 客戶端已連線。當前連線數: {active_connections}")
    
    # 確保模型已載入
    if asr_recognizer is None or vad_detector is None:
        print("檢測到模型已被釋放，正在重新載入模型...")
        init_models()
        
    # 建立會議記錄存檔目錄與檔案
    import datetime
    transcripts_dir = os.path.join(os.path.dirname(BASE_DIR), "transcripts")
    try:
        os.makedirs(transcripts_dir, exist_ok=True)
        now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        transcript_file_path = os.path.join(transcripts_dir, f"transcript_{now_str}.md")
        with open(transcript_file_path, "w", encoding="utf-8") as f:
            f.write(f"# LiveCaption 語音辨識與翻譯會議紀錄\n\n")
            f.write(f"*   **開始時間**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"*   **存檔路徑**：{transcript_file_path}\n")
            f.write(f"---\n\n")
        print(f"已建立本次會議/影片紀錄存檔：{transcript_file_path}")
    except Exception as e:
        print(f"建立紀錄存檔目錄或檔案失敗: {e}")
        transcript_file_path = None
    
    # 建立連線專用的獨立 VAD 實例以避免不同連線互相干擾
    min_silence = VAD_DEFAULT_MIN_SILENCE
    max_speech = VAD_DEFAULT_MAX_SPEECH
    local_vad = make_vad(min_silence, max_speech)
    total_samples_received = 0
    stream_offset_samples = 0
    
    # 設定選項 (預設為 Ollama 本地)
    ollama_url = "http://localhost:11434"
    model_name = "qwen2.5:3b-instruct"
    deepseek_key = None
    source_lang = "auto"
    target_lang = "none"
    preset = DEFAULT_PRESET
    dubbing_enabled = False
    tts_voice = DEFAULT_TTS_VOICE
    dialogue_history = []  # 保存最近的對話歷史 (原文, 翻譯)，提供大模型語境推斷

    try:
        while True:
            # 接收前端發送的封包
            message = await websocket.receive()
            
            # 如果收到的是文字設定訊息
            if "text" in message:
                try:
                    config_data = json.loads(message["text"])
                    if config_data.get("event") == "config":
                        ollama_url = config_data.get("ollama_url", ollama_url).rstrip("/")
                        model_name = config_data.get("model_name", model_name)
                        deepseek_key = config_data.get("deepseek_key", deepseek_key)
                        source_lang = config_data.get("source_lang", source_lang)
                        target_lang = config_data.get("target_lang", target_lang)
                        preset = config_data.get("preset", preset)
                        dubbing_enabled = bool(config_data.get("dubbing_enabled", dubbing_enabled))
                        tts_voice = config_data.get("tts_voice", tts_voice)
                        global ollama_online
                        if ollama_url and ("localhost" in ollama_url or "127.0.0.1" in ollama_url):
                            ollama_online = False
                        
                        # 解析面板設定的 VAD 參數，若有變更則重新建立 VAD
                        new_min_silence, new_max_speech = parse_vad_settings(config_data)
                        if (new_min_silence != min_silence) or (new_max_speech != max_speech):
                            min_silence = new_min_silence
                            max_speech = new_max_speech
                            local_vad = make_vad(min_silence, max_speech)
                            stream_offset_samples = total_samples_received
                            print(f"已動態更新 VAD 設定: min_silence={min_silence}s, max_speech={max_speech}s")
                        print(f"已更新後端設定: Ollama={ollama_url}, Model={model_name}, SourceLang={source_lang}, TargetLang={target_lang}, Preset={preset}")
                except Exception as e:
                    print(f"解析設定訊息或更新 VAD 失敗: {e}")
                continue
                
            # 如果收到的是二進位音訊數據
            if "bytes" in message:
                audio_bytes = message["bytes"]
                if not audio_bytes:
                    continue
                
                # 轉成 16kHz float32 NumPy 陣列
                # 前端會以 16-bit signed PCM (Int16) 發送
                pcm_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                total_samples_received += len(pcm_data)
                
                # 餵給 VAD
                local_vad.accept_waveform(pcm_data)
                
                # 檢查是否有切分好的語音段落
                while not local_vad.empty():
                    speech_segment = local_vad.front
                    samples = speech_segment.samples
                    start_time = (stream_offset_samples + speech_segment.start) / float(SAMPLE_RATE)
                    duration = len(samples) / float(SAMPLE_RATE)
                    
                    # 丟給 SenseVoice 解碼
                    if len(samples) > 0 and asr_recognizer is not None:
                        stream = asr_recognizer.create_stream()
                        stream.accept_waveform(16000, samples)
                        asr_recognizer.decode_stream(stream)
                        
                        full_asr_text = stream.result.text
                        raw_text = clean_sense_voice_text(full_asr_text)
                        
                        if raw_text:
                            # 偵測 ASR 識別語音標籤
                            recognized_lang = "auto"
                            if "<|zh|>" in full_asr_text or "<|yue|>" in full_asr_text:
                                recognized_lang = "zh"
                            elif "<|en|>" in full_asr_text:
                                recognized_lang = "en"
                            elif "<|ja|>" in full_asr_text:
                                recognized_lang = "ja"
                            elif "<|ko|>" in full_asr_text:
                                recognized_lang = "ko"

                            # 判定是否需要翻譯
                            effective_target_lang = target_lang
                            # 智能守護：若啟用同傳配音且原音為外語，但目標語言為 none，自動提升為中文以完成同傳，防止用外語生肉朗讀
                            if dubbing_enabled and effective_target_lang == "none" and recognized_lang != "zh":
                                effective_target_lang = "zh-CN"

                            if effective_target_lang == "none":
                                # 僅顯示原文
                                translated_text = raw_text
                                print(f"ASR 識別 [{start_time:.2f}s] (僅顯示原文): {raw_text}")
                            elif effective_target_lang == recognized_lang:
                                # 識別語言與目標翻譯語言一致，跳過翻譯
                                translated_text = raw_text
                                print(f"ASR 識別 [{start_time:.2f}s] (識別與目標一致 '{effective_target_lang}'，跳過翻譯): {raw_text}")
                            elif recognized_lang == "zh" and effective_target_lang in ["zh-TW", "zh-CN"]:
                                # 都是中文，使用本地 OpenCC
                                if effective_target_lang == "zh-TW":
                                    translated_text = cc_s2t.convert(raw_text)
                                    raw_text = translated_text  # 同步為繁體，方便前端去重
                                else:
                                    translated_text = cc_t2s.convert(raw_text)
                                    raw_text = translated_text  # 同步為簡體
                                print(f"ASR 識別 [{start_time:.2f}s] (中文本地 CC 轉換): {translated_text}")
                            else:
                                print(f"ASR 識別 [{start_time:.2f}s] (目標語言 '{effective_target_lang}'): {raw_text}")
                                # 1. 立即上屏原文（0 延遲，50ms 內上屏）
                                await websocket.send_json({
                                    "event": "subtitle",
                                    "text_raw": raw_text,
                                    "text_zh": "⌛ 翻譯中...",
                                    "start": start_time,
                                    "duration": duration
                                })
                                
                                # 2. 非阻塞背景非同步翻譯，絕不卡頓音訊接收管道
                                ctx_snapshot = [f"{h[0]} ({h[1]})" for h in dialogue_history[-2:]]
                                cur_preset = preset
                                cur_dub_enabled = dubbing_enabled
                                cur_voice = tts_voice
                                
                                async def async_translate_and_update(cur_text, cur_start, cur_duration, cur_src_lang, f_path, cur_ctx, cur_pr, cur_target, is_dub, voice_name):
                                    translated_str = await translate_text(
                                        cur_text, cur_target, ollama_url, model_name, deepseek_key, source_lang=cur_src_lang, context_history=cur_ctx, preset=cur_pr
                                    )
                                    print(f"翻譯結果: {translated_str}")
                                    dialogue_history.append((cur_text, translated_str))
                                    if len(dialogue_history) > 6:
                                        dialogue_history.pop(0)
                                    try:
                                        await websocket.send_json({
                                            "event": "subtitle",
                                            "text_raw": cur_text,
                                            "text_zh": translated_str,
                                            "start": cur_start,
                                            "duration": cur_duration
                                        })
                                    except Exception:
                                        pass
                                    if f_path:
                                        try:
                                            abs_time = datetime.datetime.now().strftime("%H:%M:%S")
                                            m, s = divmod(int(cur_start), 60)
                                            h, m = divmod(m, 60)
                                            rel_time = f"{h:02d}:{m:02d}:{s:02d}"
                                            with open(f_path, "a", encoding="utf-8") as f:
                                                f.write(f"### 🕒 [{abs_time} | 影片 {rel_time}]\n")
                                                f.write(f"*   **原文**：{cur_text}\n")
                                                f.write(f"*   **中文**：{translated_str}\n\n")
                                        except Exception as file_err:
                                            print(f"寫入紀錄檔失敗: {file_err}")
                                    
                                    # 3. 若啟用同傳配音，非同步合成並推送音訊
                                    if is_dub and translated_str and not translated_str.startswith("[未翻譯]"):
                                        try:
                                            print(f"正在為譯文生成同傳配音 (音色: {voice_name}): {translated_str}")
                                            dub_bytes = await synthesize_edge_tts(translated_str, voice=voice_name)
                                            if dub_bytes:
                                                print(f"同傳配音合成成功，大小: {len(dub_bytes)} bytes，正在推送至前端...")
                                                await websocket.send_json({
                                                    "event": "dubbing_audio",
                                                    "text": translated_str,
                                                    "start": cur_start,
                                                    "duration": cur_duration,
                                                    "audio_base64": base64.b64encode(dub_bytes).decode('ascii')
                                                })
                                        except Exception as dub_err:
                                            print(f"生成同傳配音失敗: {dub_err}")
                                
                                asyncio.create_task(
                                    async_translate_and_update(raw_text, start_time, duration, recognized_lang, transcript_file_path, ctx_snapshot, cur_preset, effective_target_lang, cur_dub_enabled, cur_voice)
                                )
                            
                            if effective_target_lang in ["none", recognized_lang] or (recognized_lang == "zh" and effective_target_lang in ["zh-TW", "zh-CN"]):
                                # 傳回給前端外掛
                                await websocket.send_json({
                                    "event": "subtitle",
                                    "text_raw": raw_text,
                                    "text_zh": translated_text,
                                    "start": start_time,
                                    "duration": duration
                                })
                                if transcript_file_path:
                                    try:
                                        abs_time = datetime.datetime.now().strftime("%H:%M:%S")
                                        m, s = divmod(int(start_time), 60)
                                        h, m = divmod(m, 60)
                                        rel_time = f"{h:02d}:{m:02d}:{s:02d}"
                                        with open(transcript_file_path, "a", encoding="utf-8") as f:
                                            f.write(f"### 🕒 [{abs_time} | 影片 {rel_time}]\n")
                                            f.write(f"*   **原文**：{raw_text}\n")
                                            f.write(f"*   **中文**：{translated_text}\n\n")
                                    except Exception as file_err:
                                        print(f"寫入紀錄檔失敗: {file_err}")

                                if dubbing_enabled and translated_text and not translated_text.startswith("[未翻譯]"):
                                    cur_s = start_time
                                    cur_d = duration
                                    cur_txt = translated_text
                                    async def async_direct_tts(text_val, s_val, d_val, v_val):
                                        try:
                                            d_bytes = await synthesize_edge_tts(text_val, voice=v_val)
                                            if d_bytes:
                                                await websocket.send_json({
                                                    "event": "dubbing_audio",
                                                    "text": text_val,
                                                    "start": s_val,
                                                    "duration": d_val,
                                                    "audio_base64": base64.b64encode(d_bytes).decode('ascii')
                                                })
                                        except Exception as d_err:
                                            print(f"生成同傳配音失敗: {d_err}")
                                    asyncio.create_task(async_direct_tts(cur_txt, cur_s, cur_d, tts_voice))
                    local_vad.pop()

    except WebSocketDisconnect:
        print("WebSocket 客戶端已中斷連線。")
    except Exception as e:
        print(f"WebSocket 發生錯誤: {e}")
    finally:
        active_connections = max(0, active_connections - 1)
        import time
        last_active_time = time.time()
        print(f"WebSocket 客戶端已中斷連線。當前連線數: {active_connections}")

if __name__ == "__main__":
    import uvicorn
    # 預設執行在 8000 埠
    uvicorn.run(app, host="127.0.0.1", port=8000)
