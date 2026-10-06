let mediaStream = null;
let audioContext = null;
let playbackContext = null;
let duckingGain = null;
let dubbingQueue = [];
let isPlayingDub = false;
let currentDubSource = null;
let processor = null;
let ws = null;
let config = {};
let reconnectTimer = null;
let reconnectDelay = 1000;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'offscreen') return;
  
  if (message.type === 'init-recording') {
    config = message.config;
    await startRecording(message.streamId);
  }
  
  if (message.type === 'update-config') {
    config = message.config;
    sendConfigToBackend();
  }

  if (message.type === 'video-control') {
    if (message.action === 'seek' || message.action === 'stop-stale') {
      dubbingQueue = [];
      if (currentDubSource) {
        try { currentDubSource.stop(); } catch (e) {}
        currentDubSource = null;
      }
      isPlayingDub = false;
      if (duckingGain && playbackContext && playbackContext.state !== 'closed') {
        const now = playbackContext.currentTime;
        duckingGain.gain.cancelScheduledValues(now);
        duckingGain.gain.setValueAtTime(1.0, now);
      }
    }
  }
});

async function startRecording(streamId) {
  try {
    // Proactively clean up any previous recording resources/connections
    cleanup();
    
    // Wait 200ms to allow Chrome to release previous streams
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // 1. Capture stream with retry logic
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId
            }
          }
        });
        break; // Success, exit retry loop
      } catch (err) {
        attempt++;
        console.warn(`Attempt ${attempt} to capture tab audio failed:`, err);
        if (attempt >= maxRetries) {
          throw err; // Re-throw error if all retries failed
        }
        // Wait 300ms before retrying
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    // 2. Play original audio stream back to user so they hear it (with Audio Ducking)
    playbackContext = new AudioContext();
    const playbackSource = playbackContext.createMediaStreamSource(mediaStream);
    duckingGain = playbackContext.createGain();
    duckingGain.gain.setValueAtTime(1.0, playbackContext.currentTime);
    playbackSource.connect(duckingGain);
    duckingGain.connect(playbackContext.destination);
    
    // 3. Connect to WebSocket backend
    connectWebSocket();
    
    // 4. Downsample captured stream to 16kHz for SenseVoice ASR
    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    // Buffer size of 4096 frames
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    
    source.connect(processor);
    processor.connect(audioContext.destination); // Required to trigger onaudioprocess
    
    processor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      
      const inputData = e.inputBuffer.getChannelData(0); // Float32 Array
      
      // Convert Float32 to 16-bit PCM (Int16)
      const int16Buffer = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        let s = Math.max(-1, Math.min(1, inputData[i]));
        int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      // Send binary data over WS
      ws.send(int16Buffer.buffer);
    };
    
  } catch (err) {
    console.error("Offscreen capture failure:", err);
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'offscreen-error',
      error: err.message
    });
  }
}

function connectWebSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  
  // Hardcoded to localhost backend (as we want offline/local security)
  ws = new WebSocket('ws://127.0.0.1:8000/stream');
  
  ws.onopen = () => {
    console.log("WebSocket backend connected successfully.");
    reconnectDelay = 1000; // Reset delay
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'websocket-connected'
    });
    
    // Send configuration instantly after connection opens
    sendConfigToBackend();
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'subtitle') {
        // Forward ASR & translation subtitles to background worker
        chrome.runtime.sendMessage({
          target: 'background',
          type: 'subtitle-data',
          data: data
        });
      }
      if (data.event === 'dubbing_audio') {
        enqueueDubbingAudio(data);
      }
    } catch (e) {
      console.warn("Failed to parse backend message:", e);
    }
  };
  
  ws.onclose = () => {
    console.warn("WebSocket closed.");
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'websocket-disconnected'
    });
    
    // Attempt auto-reconnect if capture is active
    if (mediaStream) {
      console.log(`WebSocket disconnected. Retrying in ${reconnectDelay / 1000}s...`);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 16000);
        connectWebSocket();
      }, reconnectDelay);
    }
  };
  
  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}

function enqueueDubbingAudio(item) {
  if (!config.dubbingEnabled && !config.dubbing_enabled) {
    return;
  }
  // 隊列積壓保護：若堆積超過 2 句，丟棄過早的陳舊音訊，防止時延惡性膨脹
  if (dubbingQueue.length >= 2) {
    console.warn("Dubbing queue backlog exceeded, dropping stale items to catch up.");
    dubbingQueue.splice(0, dubbingQueue.length - 1);
  }
  dubbingQueue.push(item);
  if (!isPlayingDub) {
    playNextDubbing();
  }
}

async function playNextDubbing() {
  if (!playbackContext || playbackContext.state === 'closed') return;
  
  const targetDuckVol = (config.duckingVolume !== undefined) ? Number(config.duckingVolume) : 0.10;
  
  if (dubbingQueue.length === 0) {
    isPlayingDub = false;
    currentDubSource = null;
    // 250ms 平滑漸變回 1.0 原聲音量
    if (duckingGain) {
      const now = playbackContext.currentTime;
      duckingGain.gain.cancelScheduledValues(now);
      duckingGain.gain.setTargetAtTime(1.0, now, 0.08);
    }
    return;
  }
  
  const item = dubbingQueue.shift();
  try {
    const binaryStr = atob(item.audio_base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    const audioBuffer = await playbackContext.decodeAudioData(bytes.buffer.slice(0));
    const dubDuration = audioBuffer.duration;
    const origDuration = (item.duration && Number(item.duration) > 0) ? Number(item.duration) : dubDuration;
    
    // 自適應語速鎖步：若配音長度超過原聲，微調語速 (1.0x - 1.25x) 確保在原句結束前及時念完
    let speedRatio = 1.0;
    if (dubDuration > origDuration && origDuration > 0.5) {
      speedRatio = Math.min(1.25, Math.max(1.0, dubDuration / origDuration));
    }

    // 發送配音就緒訊號給標籤頁，用於解鎖開頭預熱對齊微頓
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'dubbing-ready',
      data: {
        text: item.text,
        start: item.start,
        duration: origDuration,
        speedRatio: speedRatio
      }
    });
    
    // 平滑壓低原聲音量 (80ms 快速淡出到 duckingVolume)
    if (duckingGain) {
      const now = playbackContext.currentTime;
      duckingGain.gain.cancelScheduledValues(now);
      duckingGain.gain.setTargetAtTime(Math.max(0.0, Math.min(1.0, targetDuckVol)), now, 0.025);
    }
    
    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = speedRatio;
    source.connect(playbackContext.destination);
    currentDubSource = source;
    isPlayingDub = true;
    
    source.onended = () => {
      if (currentDubSource === source) {
        currentDubSource = null;
      }
      playNextDubbing();
    };
    source.start(0);
  } catch (err) {
    console.warn("Failed to decode or play dubbing audio:", err);
    playNextDubbing();
  }
}

function sendConfigToBackend() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      event: 'config',
      ollama_url: config.ollamaUrl,
      model_name: config.modelName,
      deepseek_key: config.deepseekKey,
      min_silence: config.minSilence,
      max_speech: config.maxSpeech,
      source_lang: config.sourceLang,
      target_lang: config.targetLang,
      preset: config.preset || config.promptPreset || 'general',
      dubbing_enabled: !!(config.dubbingEnabled || config.dubbing_enabled),
      tts_voice: config.ttsVoice || 'yunxi'
    }));
  }
}

// Ensure cleanup on window unload
window.addEventListener('unload', () => {
  cleanup();
});

function cleanup() {
  console.log("Cleaning up offscreen contexts...");
  
  dubbingQueue = [];
  isPlayingDub = false;
  if (currentDubSource) {
    try {
      currentDubSource.stop();
    } catch (e) {}
    currentDubSource = null;
  }
  duckingGain = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 1000;
  
  if (processor) {
    try {
      processor.disconnect();
    } catch (e) {
      console.warn("Error disconnecting processor:", e);
    }
    processor = null;
  }
  
  if (audioContext) {
    try {
      audioContext.close();
    } catch (e) {
      console.warn("Error closing audioContext:", e);
    }
    audioContext = null;
  }
  
  if (playbackContext) {
    try {
      playbackContext.close();
    } catch (e) {
      console.warn("Error closing playbackContext:", e);
    }
    playbackContext = null;
  }
  
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (err) {
          console.warn("Error stopping track:", err);
        }
      });
    } catch (e) {
      console.warn("Error stopping mediaStream tracks:", e);
    }
    mediaStream = null;
  }
  
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      console.warn("Error closing WebSocket:", e);
    }
    ws = null;
  }
}
