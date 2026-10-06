import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '/home/hasakiikii/cc/pi-jev-browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/google/chrome/chrome',
  args: ['--autoplay-policy=no-user-gesture-required']
});

try {
  const context = await browser.newContext({
    permissions: ['microphone']
  });
  const page = await context.newPage();
  const offscreenJs = await fs.readFile(new URL('../extension/offscreen.js', import.meta.url), 'utf8');

  // 构建模拟宿主
  await page.goto('data:text/html,<html><head></head><body><div id="status">Offscreen Mock Test</div></body></html>');

  await page.evaluate(() => {
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    window.chrome = {
      runtime: {
        sendMessage: (msg) => { window.lastSentMessage = msg; },
        onMessage: { addListener: (cb) => { window.msgListener = cb; } }
      }
    };
  });

  await page.addScriptTag({ content: offscreenJs });
  await page.addScriptTag({ content: `
    window.getDubbingState = () => ({
      hasQueue: Array.isArray(dubbingQueue),
      isPlayingDub,
      hasPlaybackContext: !!playbackContext,
      hasDuckingGain: !!duckingGain,
      duckingGainValue: duckingGain ? duckingGain.gain.value : null
    });
    window.callStartRecording = (streamId) => startRecording(streamId);
    window.callEnqueueDubbingAudio = (item) => enqueueDubbingAudio(item);
    window.setOffscreenConfig = (cfg) => { config = cfg; };
  ` });

  // 1. 测试初始全局变量定义
  const initialVars = await page.evaluate(() => window.getDubbingState());
  console.log('[TEST 1] Initial variables:', initialVars);
  assert.equal(initialVars.hasQueue, true, 'dubbingQueue array should be initialized');
  assert.equal(initialVars.isPlayingDub, false, 'isPlayingDub should initially be false');

  // 2. 模拟触发 init-recording 并验证 AudioContext 与 GainNode 初始化
  const audioGraphResult = await page.evaluate(async () => {
    // 构造一个静音音频流作为测试输入
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    const fakeStream = dst.stream;

    // mock navigator.mediaDevices.getUserMedia
    navigator.mediaDevices.getUserMedia = async () => fakeStream;

    // 触发 startRecording
    window.setOffscreenConfig({
      dubbingEnabled: true,
      duckingVolume: 0.10,
      ttsVoice: 'yunxi'
    });

    await window.callStartRecording('fake-stream-id');
    return window.getDubbingState();
  });
  console.log('[TEST 2] Audio graph initialization:', audioGraphResult);
  assert.equal(audioGraphResult.hasPlaybackContext, true);
  assert.equal(audioGraphResult.hasDuckingGain, true);
  assert.equal(audioGraphResult.duckingGainValue, 1.0);

  // 3. 生成一段小 PCM WAV 作为 base64 模拟配音，喂给 enqueueDubbingAudio
  // 采样率 16000，时长 0.3 秒纯音
  const fakeMp3B64 = await page.evaluate(async () => {
    const sampleRate = 16000;
    const duration = 0.3;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeString = (view, offset, string) => {
      for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const sample = Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 10000;
      view.setInt16(44 + i * 2, sample, true);
    }

    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  });

  // 4. 发送配音事件并观察 Audio Ducking 音量下压
  const duckingTriggered = await page.evaluate(async (b64) => {
    window.callEnqueueDubbingAudio({
      event: 'dubbing_audio',
      text: '测试测试',
      audio_base64: b64
    });

    // 等待 60ms 让 Web Audio 调度开始下压
    await new Promise(r => setTimeout(r, 60));

    const stateDuring = window.getDubbingState();
    const gainDuringDubbing = stateDuring.duckingGainValue;
    const isPlaying = stateDuring.isPlayingDub;

    // 等待配音播放完毕 (约 350ms) 并回弹
    await new Promise(r => setTimeout(r, 550));

    const stateAfter = window.getDubbingState();
    const gainAfterRestore = stateAfter.duckingGainValue;
    const isPlayingAfter = stateAfter.isPlayingDub;

    return {
      gainDuringDubbing,
      isPlaying,
      gainAfterRestore,
      isPlayingAfter
    };
  }, fakeMp3B64);

  console.log('[TEST 3] Audio Ducking & Restoration result:', duckingTriggered);
  assert.equal(duckingTriggered.isPlaying, true, 'Should be playing dubbing audio');
  assert.ok(duckingTriggered.gainDuringDubbing < 0.5, 'Gain should duck down significantly during playback (target ~0.10)');
  assert.equal(duckingTriggered.isPlayingAfter, false, 'Should finish playing dubbing audio');
  assert.ok(duckingTriggered.gainAfterRestore > 0.8, 'Gain should restore smoothly back toward 1.0 after playback');

  console.log('\nAll Chrome Offscreen Web Audio Ducking tests PASSED!');
} finally {
  await browser.close();
}
