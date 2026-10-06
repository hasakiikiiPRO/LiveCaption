import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '/home/hasakiikii/cc/pi-jev-browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/google/chrome/chrome',
  args: ['--autoplay-policy=no-user-gesture-required']
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  const contentJs = await fs.readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

  // 构建一个包含 HTML5 <video> 的网页宿主环境
  await page.setContent(`
    <html>
      <head></head>
      <body>
        <div id="player-box">
          <video id="test-video" width="640" height="360" controls loop muted playsinline></video>
        </div>
      </body>
    </html>
  `);

  // Mock chrome runtime
  await page.evaluate(() => {
    window.lastSentRuntimeMessages = [];
    window.chrome = {
      storage: {
        local: {
          get: (keys, cb) => cb({
            textColor: '#ffffff',
            fontSize: 'medium',
            historyLines: 0
          })
        }
      },
      runtime: {
        sendMessage: (msg) => { window.lastSentRuntimeMessages.push(msg); },
        onMessage: {
          addListener: (cb) => { window.contentMsgListener = cb; }
        }
      }
    };
  });

  // 注入 content.js
  await page.addScriptTag({ content: contentJs });

  // 启动视频播放
  await page.evaluate(async () => {
    const video = document.getElementById('test-video');
    let isPlaying = true;
    video.play = async () => { isPlaying = true; };
    video.pause = () => { isPlaying = false; };
    Object.defineProperty(video, 'paused', { get: () => !isPlaying, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 2.0, writable: true, configurable: true });
  });

  // 验证视频当前正在播放
  const isInitiallyPlaying = await page.evaluate(() => !document.getElementById('test-video').paused);
  assert.equal(isInitiallyPlaying, true, 'Mock video should initially be playing');

  // ==========================================
  // 测试 1：纯字幕模式下，完全不干扰视频播放
  // ==========================================
  console.log('[TEST 1] Testing pure subtitle mode (dubbingEnabled = false)...');
  await page.evaluate(() => {
    window.contentMsgListener({
      type: 'show-subtitles',
      targetLang: 'zh-CN',
      showBilingual: true,
      dubbingEnabled: false,
      prerollSync: true
    });
    window.contentMsgListener({
      type: 'render-subtitle',
      data: { text_raw: 'Hello world', text_zh: '你好世界', start: 1.0, duration: 2.0 },
      targetLang: 'zh-CN',
      showBilingual: true
    });
  });

  const isStillPlayingInPureMode = await page.evaluate(() => !document.getElementById('test-video').paused);
  assert.equal(isStillPlayingInPureMode, true, 'Pure subtitle mode must NEVER pause or interfere with video');
  console.log('-> PASS: Pure subtitle mode did not interfere with video playback.');

  // ==========================================
  // 测试 2：同传配音开启时，智能预热微顿与就绪对齐解锁
  // ==========================================
  console.log('[TEST 2] Testing dubbing mode with Smart Pre-roll Sync...');
  await page.evaluate(() => {
    window.contentMsgListener({
      type: 'show-subtitles',
      targetLang: 'zh-CN',
      showBilingual: true,
      dubbingEnabled: true,
      prerollSync: true
    });
    // 第一句话到来 (通常先是 ⌛ 翻譯中...)
    window.contentMsgListener({
      type: 'render-subtitle',
      data: { text_raw: 'This is a long clinical sentence.', text_zh: '⌛ 翻譯中...', start: 2.5, duration: 3.0 },
      targetLang: 'zh-CN',
      showBilingual: true
    });
  });

  // 验证在第一句话到来时，视频被自动轻轻暂停，等待配音缓冲
  const isPausedForBuffering = await page.evaluate(() => document.getElementById('test-video').paused);
  const containerText = await page.evaluate(() => document.getElementById('studio0808-subtitle-container').innerText);
  console.log('-> Video paused for pre-roll buffer:', isPausedForBuffering);
  console.log('-> Subtitle overlay status text:', containerText);
  assert.equal(isPausedForBuffering, true, 'Video should be briefly paused for initial pre-roll buffer');
  assert.ok(containerText.includes('預熱') || containerText.includes('同步'), 'Should display pre-roll sync indicator');

  // 模拟后台 Edge-TTS 配音就绪信号 dubbing-ready 送达
  console.log('[TEST 3] Simulating dubbing-ready event...');
  await page.evaluate(() => {
    window.contentMsgListener({
      type: 'dubbing-ready',
      data: { text: '这是一个长句。', start: 2.5, duration: 3.0 }
    });
  });

  // 验证视频立刻自动恢复播放，音画同频起跑！
  const isResumedPlaying = await page.evaluate(() => !document.getElementById('test-video').paused);
  assert.equal(isResumedPlaying, true, 'Video should immediately resume playing lock-step with dubbing');
  console.log('-> PASS: Video resumed playing lock-step with dubbing audio!');

  // ==========================================
  // 测试 4：模拟用户拖拽进度条 (seeking)，验证触发旧配音清空
  // ==========================================
  console.log('[TEST 4] Simulating user seeking video timeline...');
  await page.evaluate(() => {
    const video = document.getElementById('test-video');
    video.dispatchEvent(new Event('seeking'));
  });

  const lastMessages = await page.evaluate(() => window.lastSentRuntimeMessages);
  const hasSeekAction = lastMessages.some(m => m.type === 'video-control' && m.action === 'seek');
  assert.equal(hasSeekAction, true, 'Should send video-control:seek to clear stale queue on seeking');
  console.log('-> PASS: Seeking cleanly triggers stale dubbing purge signal.');

  console.log('\nAll Smart Lock-step Sync integration tests PASSED!');
} finally {
  await browser.close();
}
