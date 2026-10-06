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
  // 测试 2：同传配音开启时，绝不暂停或中断视频播放 (保证 100% 流畅)
  // ==========================================
  console.log('[TEST 2] Testing dubbing mode video non-interference...');
  await page.evaluate(() => {
    window.contentMsgListener({
      type: 'show-subtitles',
      targetLang: 'zh-CN',
      showBilingual: true,
      dubbingEnabled: true
    });
    // 第一句话到来
    window.contentMsgListener({
      type: 'render-subtitle',
      data: { text_raw: 'This is a clinical sentence.', text_zh: '这是一个长句。', start: 2.5, duration: 3.0 },
      targetLang: 'zh-CN',
      showBilingual: true
    });
  });

  const isStillPlayingInDubbingMode = await page.evaluate(() => !document.getElementById('test-video').paused);
  assert.equal(isStillPlayingInDubbingMode, true, 'Video must NEVER be paused, even in dubbing mode!');
  console.log('-> PASS: Video continues smooth playback without being paused.');

  // ==========================================
  // 测试 3：模拟用户拖拽进度条 (seeking)，验证触发旧配音清空
  // ==========================================
  console.log('[TEST 3] Simulating user seeking video timeline...');
  await page.evaluate(() => {
    const video = document.getElementById('test-video');
    video.dispatchEvent(new Event('seeking'));
  });

  const lastMessages = await page.evaluate(() => window.lastSentRuntimeMessages);
  const hasSeekAction = lastMessages.some(m => m.type === 'video-control' && m.action === 'seek');
  assert.equal(hasSeekAction, true, 'Should send video-control:seek to clear stale queue on seeking');
  console.log('-> PASS: Seeking cleanly triggers stale dubbing purge signal.');

  console.log('\nAll Smooth Dubbing non-interference tests PASSED!');
} finally {
  await browser.close();
}
