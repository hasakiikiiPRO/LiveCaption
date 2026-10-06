import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '/home/hasakiikii/cc/pi-jev-browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/google/chrome/chrome'
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  const contentJs = await fs.readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

  const mockHtml = `
    <html>
      <head></head>
      <body>
        <div id="movie_player"></div>
        <video id="yt-video" width="640" height="360" controls loop playsinline></video>
        <script>
          const mockEvents = {
            events: [
              { tStartMs: 1000, dDurationMs: 800, segs: [{ utf8: "Welcome " }, { utf8: "to " }] },
              { tStartMs: 1800, dDurationMs: 1200, segs: [{ utf8: "the tutorial." }] },
              { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: "Here is the key insight." }] }
            ]
          };

          const mockTracks = [
            {
              languageCode: "en",
              name: { simpleText: "English (auto-generated)" },
              baseUrl: "https://mock.youtube.timedtext.api?v=mock&lang=en",
              kind: "asr"
            }
          ];

          document.getElementById('movie_player').getPlayerResponse = () => ({
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: mockTracks
              }
            }
          });

          // Mock window.fetch for timedtext
          const originalFetch = window.fetch;
          window.fetch = async (url, opts) => {
            if (url && url.includes('mock.youtube.timedtext.api')) {
              return {
                ok: true,
                json: async () => mockEvents
              };
            }
            return originalFetch ? originalFetch(url, opts) : null;
          };
        </script>
      </body>
    </html>
  `;

  await page.route('https://www.youtube.com/watch?v=mock_video_id', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: mockHtml
    });
  });

  await page.goto('https://www.youtube.com/watch?v=mock_video_id');

  // Mock chrome API
  await page.evaluate(() => {
    window.capturedRuntimeMessages = [];
    window.chrome = {
      storage: {
        local: {
          get: (keys, cb) => cb({ textColor: '#ffffff', fontSize: 'medium', historyLines: 0 })
        }
      },
      runtime: {
        sendMessage: (msg) => { window.capturedRuntimeMessages.push(msg); },
        onMessage: {
          addListener: (cb) => { window.contentListener = cb; }
        }
      }
    };

    const video = document.getElementById('yt-video');
    let currentTimeVal = 0.0;
    Object.defineProperty(video, 'currentTime', {
      get: () => currentTimeVal,
      set: (v) => { currentTimeVal = v; }
    });
    Object.defineProperty(video, 'paused', { get: () => false });
  });

  await page.addScriptTag({ content: contentJs });

  // 1. 触发 show-subtitles 并开启配音
  console.log('[TEST 1] Triggering show-subtitles with dubbingEnabled = true...');
  await page.evaluate(async () => {
    window.contentListener({
      type: 'show-subtitles',
      targetLang: 'zh-CN',
      showBilingual: true,
      dubbingEnabled: true
    });
    // 等待字幕探针与 fetch 完成
    await new Promise(r => setTimeout(r, 600));
  });

  // 2. 检查 prefetch 是否触发
  const messagesAfterInit = await page.evaluate(() => window.capturedRuntimeMessages);
  console.log('-> Captured messages after init:', messagesAfterInit.map(m => m.type));
  const batchReq = messagesAfterInit.find(m => m.type === 'request-batch-dubbing');
  assert.ok(batchReq, 'Should request batch dubbing for upcoming transcript sentences');
  assert.equal(batchReq.items.length, 2, 'Should merge 3 fragmented events into 2 coherent sentences');
  console.log('-> PASS: Transcript extracted & merged into 2 sentences:', batchReq.items.map(it => it.text));

  // 3. 模拟后台推送 batch-dubbing-data
  console.log('[TEST 2] Simulating backend batch-dubbing-data response...');
  await page.evaluate((items) => {
    window.contentListener({
      type: 'batch-dubbing-data',
      items: items.map(it => ({
        id: it.id,
        text_raw: it.text,
        text_zh: '中文翻译: ' + it.text,
        audio_base64: 'mock_audio_bytes_base64'
      }))
    });
  }, batchReq.items);

  // 4. 将视频时间步进到第 1.05 秒 (第一句话开始时刻)
  console.log('[TEST 3] Advancing video currentTime to 1.05s...');
  const debugInfo = await page.evaluate(async () => {
    const video = document.getElementById('yt-video');
    video.currentTime = 1.05;
    await new Promise(r => setTimeout(r, 450));
    return {
      curTime: video.currentTime,
      ytEnabled: ytDubber.enabled,
      hasVid: !!ytDubber.video,
      sentenceCount: ytDubber.sentences.length,
      playedCount: ytDubber.playedIds.size,
      firstSent: ytDubber.sentences[0],
      subtitleHistory: subtitleHistory,
      overlayText: document.getElementById('studio0808-subtitle-container').innerText
    };
  });
  console.log('-> Debug info at 1.05s:', debugInfo);

  const messagesAfterPlay = await page.evaluate(() => window.capturedRuntimeMessages);
  const playMsg = messagesAfterPlay.find(m => m.type === 'play-scheduled-dub');
  assert.ok(playMsg, 'Should precisely trigger play-scheduled-dub when video reaches timestamp!');
  assert.equal(playMsg.audio_base64, 'mock_audio_bytes_base64');

  const overlayText = await page.evaluate(() => document.getElementById('studio0808-subtitle-container').innerText);
  console.log('-> Subtitle overlay at 1.05s:', overlayText);
  assert.ok(overlayText.includes('Welcome to the tutorial.'), 'Should display bilingual subtitle lock-step with video');
  console.log('-> PASS: Scheduled dubbing & subtitle triggered exactly on time!');

  console.log('\nAll YouTube Dubbing Fast-Path tests PASSED 100%!');
} finally {
  await browser.close();
}
