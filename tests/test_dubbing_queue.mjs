// 同傳配音佇列回歸測試：時間戳排序、不疊音、拖動丟棄在途配音、嚴重落後才跳過。
// Run: node tests/test_dubbing_queue.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '/home/hasakiikii/cc/pi-jev-browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/google/chrome/chrome',
  args: ['--autoplay-policy=no-user-gesture-required']
});

try {
  const page = await browser.newPage();
  const offscreenJs = await fs.readFile(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
  await page.goto('data:text/html,<html><head></head><body></body></html>');
  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        sendMessage: () => {},
        onMessage: { addListener: (cb) => { window.msgListener = cb; } }
      }
    };
  });
  await page.addScriptTag({ content: offscreenJs });
  await page.addScriptTag({ content: `
    window.T = {
      enqueue: (item) => enqueueDubbingAudio(item),
      setConfig: (c) => { config = c; },
      setSent: (s) => { streamSecondsSent = s; },
      state: () => ({ queue: dubbingQueue.map(i => i.text), isPlayingDub, playing: !!currentDubSource }),
      setup: () => {
        playbackContext = new AudioContext();
        duckingGain = playbackContext.createGain();
        duckingGain.connect(playbackContext.destination);
        // 記錄每次真正開始播放的配音，以及同時在播的數量
        window.started = [];
        window.maxConcurrent = 0;
        let live = 0;
        const orig = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function () {
          live++;
          window.maxConcurrent = Math.max(window.maxConcurrent, live);
          window.started.push(this.__text);
          this.addEventListener('ended', () => { live--; });
          return orig.apply(this, arguments);
        };
        const origCreate = playbackContext.createBufferSource.bind(playbackContext);
        playbackContext.createBufferSource = () => {
          const n = origCreate();
          n.__text = window.__nextText;
          return n;
        };
        const origDecode = playbackContext.decodeAudioData.bind(playbackContext);
        playbackContext.decodeAudioData = async (buf) => {
          const text = window.__byLen[buf.byteLength];
          const b = await origDecode(buf);
          window.__nextText = text;
          return b;
        };
        window.__byLen = {};
        let seq = 0;
        // 每句配音用不同長度的音訊，以位元組長度反查是哪一句
        window.send = (text, start, duration, seconds) => {
          const a = T.wav(seconds + (seq++) * 0.01);
          window.__byLen[atob(a).length] = text;
          T.enqueue({ text, start, duration, audio_base64: a });
        };
      },
      wav: (seconds) => {
        const sr = 16000, n = Math.floor(sr * seconds);
        const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 10) * 8000, true);
        let bin = ''; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }
    };
  ` });

  await page.evaluate(() => { T.setup(); T.setConfig({ dubbingEnabled: true, duckingVolume: 0.1 }); });

  // 1. 亂序到達：先到 s=5 的，再到 s=2、s=8；第一句已開始播，其餘須按時間排序且不疊音
  const r1 = await page.evaluate(async () => {
    const D = 2, SECS = 0.25;
    T.setSent(6);
    send('A@5', 5, D, SECS);
    await new Promise(r => setTimeout(r, 20));
    send('C@8', 8, D, SECS);
    send('B@2', 2, D, SECS);
    const queued = T.state().queue;
    await new Promise(r => setTimeout(r, 1200));
    return { queued, started: window.started, maxConcurrent: window.maxConcurrent, after: T.state() };
  });
  console.log('[TEST 1]', r1);
  assert.deepEqual(r1.queued, ['B@2', 'C@8'], 'Pending dubs must be ordered by source timestamp');
  assert.deepEqual(r1.started, ['A@5', 'B@2', 'C@8'], 'Every dub must be played, none dropped');
  assert.equal(r1.maxConcurrent, 1, 'Two dubs must never overlap');
  assert.equal(r1.after.isPlayingDub, false);

  // 2. 拖動進度條：清掉排隊中的配音，且拖動前就已在途的舊配音之後到達也要丟棄
  const r2 = await page.evaluate(async () => {
    window.started = [];
    const D = 2, SECS = 0.4;
    T.setSent(20);
    send('old1@15', 15, D, SECS);
    send('old2@16', 16, D, SECS);
    await new Promise(r => setTimeout(r, 50));
    window.msgListener({ target: 'offscreen', type: 'video-control', action: 'seek' });
    const afterSeek = T.state();
    send('late-old@17', 17, D, SECS);
    T.setSent(21);
    send('new@20.5', 20.5, D, SECS);
    await new Promise(r => setTimeout(r, 800));
    return { afterSeek, started: window.started };
  });
  console.log('[TEST 2]', r2);
  assert.deepEqual(r2.afterSeek, { queue: [], isPlayingDub: false, playing: false });
  assert.deepEqual(r2.started, ['old1@15', 'new@20.5'], 'Only the post-seek dub may play after seeking');

  // 3. 嚴重落後才跳過，且不吞掉最後一句
  const r3 = await page.evaluate(async () => {
    window.started = [];
    const D = 1, SECS = 0.2;
    T.setSent(100);
    send('stale@60', 60, D, SECS);
    await new Promise(r => setTimeout(r, 20));
    send('stale@61', 61, D, SECS);
    send('fresh@97', 97, D, SECS);
    await new Promise(r => setTimeout(r, 900));
    const run1 = window.started.slice();
    window.started = [];
    T.setSent(200);
    send('only@100', 100, D, SECS);
    await new Promise(r => setTimeout(r, 400));
    return { run1, run2: window.started };
  });
  console.log('[TEST 3]', r3);
  assert.deepEqual(r3.run1, ['stale@60', 'fresh@97'], 'A badly lagging dub is skipped when a newer one is waiting');
  assert.deepEqual(r3.run2, ['only@100'], 'The last pending dub is never skipped');

  console.log('\nAll dubbing queue tests PASSED');
} finally {
  await browser.close();
}
