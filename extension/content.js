let subtitleContainer = null;
let clearTimer = null;
let subtitleHistory = [];
let maxHistoryLines = 0; // 0 = only show latest, 1 = latest + 1 history, 2 = latest + 2 history
let isDragAttached = false;

// 同傳配音狀態變數 (永不擅自暫停用戶視頻，保證視頻 100% 流暢播放)
let isDubbingActive = false;

function getActiveVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  const playing = videos.find(v => !v.paused && v.currentTime > 0);
  if (playing) return playing;
  return videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
}

function attachVideoListeners(video) {
  if (!video || video.__lcAttached) return;
  video.__lcAttached = true;
  video.addEventListener('seeking', () => {
    if (isDubbingActive) {
      chrome.runtime.sendMessage({ type: 'video-control', action: 'seek' }).catch(() => {});
    }
  });
}

// Initialize subtitle overlay
function initSubtitleOverlay() {
  // 1. Remove all legacy injected style tags (both with or without id)
  document.querySelectorAll('style').forEach(st => {
    if (st.id === 'studio0808-subtitle-style' || (st.textContent && st.textContent.includes('studio0808-subtitle-container'))) {
      st.remove();
    }
  });

  // 2. Inject modern 100% pure transparent subtitle styling
  const styleEl = document.createElement('style');
  styleEl.id = 'studio0808-subtitle-style';
  styleEl.textContent = `
    #studio0808-subtitle-container {
      position: fixed !important;
      bottom: 8% !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2147483647 !important;
      width: max-content !important;
      min-width: 0 !important;
      max-width: 90vw !important;
      padding: 0 !important;
      margin: 0 !important;
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      outline: none !important;
      text-align: center !important;
      pointer-events: auto !important;
      cursor: grab !important;
      user-select: none !important;
      display: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    }
    
    #studio0808-subtitle-container:active {
      cursor: grabbing !important;
    }
    
    #studio0808-subtitle-container.visible {
      opacity: 1 !important;
    }
    
    .studio0808-subtitle-line {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      outline: none !important;
      margin-bottom: 6px !important;
      padding: 0 !important;
    }
    
    .studio0808-subtitle-line:last-child {
      margin-bottom: 0 !important;
    }
    
    .studio0808-subtitle-line.history-line {
      opacity: 0.55 !important;
      transform: scale(0.96) !important;
      margin-bottom: 4px !important;
    }
    
    .studio0808-subtitle-raw-item {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
      box-shadow: none !important;
      outline: none !important;
      font-size: calc(var(--subtitle-font-size-raw, 14px) * 0.95) !important;
      color: rgba(235, 240, 255, 0.95) !important;
      margin-bottom: 2px !important;
      padding: 0 !important;
      line-height: 1.35 !important;
      text-shadow: 0 0 4px #000, 0 0 8px #000, 1px 1px 2px #000, -1px -1px 2px #000, 0 2px 4px rgba(0, 0, 0, 0.95) !important;
      font-weight: 500 !important;
    }
    
    .studio0808-subtitle-zh-item {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
      box-shadow: none !important;
      outline: none !important;
      font-size: var(--subtitle-font-size-zh, 20px) !important;
      color: var(--subtitle-color, #ffffff) !important;
      padding: 0 !important;
      line-height: 1.35 !important;
      text-shadow: 0 0 5px #000, 0 0 10px #000, 2px 2px 3px #000, -1px -1px 2px #000, 0 2px 4px rgba(0, 0, 0, 0.95) !important;
      font-weight: 700 !important;
    }
  `;
  document.head.appendChild(styleEl);

  // 3. Obtain or create subtitleContainer
  const existing = document.getElementById('studio0808-subtitle-container');
  if (existing) {
    subtitleContainer = existing;
    subtitleContainer.style.removeProperty('--subtitle-bg');
    subtitleContainer.style.background = 'transparent';
    subtitleContainer.style.backgroundColor = 'transparent';
    subtitleContainer.style.backgroundImage = 'none';
    subtitleContainer.style.backdropFilter = 'none';
    subtitleContainer.style.webkitBackdropFilter = 'none';
    subtitleContainer.style.border = 'none';
    subtitleContainer.style.borderRadius = '0';
    subtitleContainer.style.boxShadow = 'none';
    subtitleContainer.style.outline = 'none';
  } else {
    subtitleContainer = document.createElement('div');
    subtitleContainer.id = 'studio0808-subtitle-container';
    document.body.appendChild(subtitleContainer);
  }

  // 4. Always synchronize styles from storage
  chrome.storage.local.get(['textColor', 'fontSize', 'historyLines'], (result) => {
    const text = result.textColor || '#ffffff';
    const size = result.fontSize || 'medium';
    maxHistoryLines = result.historyLines !== undefined ? parseInt(result.historyLines) : 0;
    applySubtitleStyles(null, text, size);
  });

  // 5. Drag and drop logic
  if (!isDragAttached && subtitleContainer) {
    isDragAttached = true;
    let isDragging = false;
    let startX, startY;
    let initialX, initialY;
    
    subtitleContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Left click only
      isDragging = true;
      const rect = subtitleContainer.getBoundingClientRect();
      subtitleContainer.style.transform = 'none';
      subtitleContainer.style.left = rect.left + 'px';
      subtitleContainer.style.top = rect.top + 'px';
      subtitleContainer.style.bottom = 'auto';
      startX = e.clientX;
      startY = e.clientY;
      initialX = rect.left;
      initialY = rect.top;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      subtitleContainer.style.left = (initialX + dx) + 'px';
      subtitleContainer.style.top = (initialY + dy) + 'px';
    });
    
    document.addEventListener('mouseup', () => { isDragging = false; });
    
    // Double click to reset to default position
    subtitleContainer.addEventListener('dblclick', () => {
      subtitleContainer.style.transform = 'translateX(-50%)';
      subtitleContainer.style.left = '50%';
      subtitleContainer.style.top = 'auto';
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenElement) {
        subtitleContainer.style.position = 'absolute';
        subtitleContainer.style.bottom = '10%';
      } else {
        subtitleContainer.style.position = 'fixed';
        subtitleContainer.style.bottom = '8%';
      }
    });
    
    // Listen to Fullscreen Change Event
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  }
}

function handleFullscreenChange() {
  if (!subtitleContainer) return;
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenElement) {
    fullscreenElement.appendChild(subtitleContainer);
    subtitleContainer.style.position = 'absolute';
    subtitleContainer.style.bottom = '10%';
  } else {
    document.body.appendChild(subtitleContainer);
    subtitleContainer.style.position = 'fixed';
    subtitleContainer.style.bottom = '8%';
  }
}

// Render history subtitles based on configurations
function renderHistorySubtitles(targetLang, showBilingual) {
  if (!subtitleContainer) return;
  
  subtitleContainer.innerHTML = ''; // Clear previous elements
  
  subtitleHistory.forEach((item, index) => {
    const isLatest = (index === subtitleHistory.length - 1);
    
    const lineWrapper = document.createElement('div');
    lineWrapper.className = 'studio0808-subtitle-line';
    if (!isLatest) {
      lineWrapper.classList.add('history-line');
    }
    
    if (targetLang === 'none') {
      // Show only raw text with primary styling (larger and bolder)
      const rawEl = document.createElement('div');
      rawEl.className = 'studio0808-subtitle-zh-item';
      rawEl.textContent = item.text_raw || item.text_zh;
      lineWrapper.appendChild(rawEl);
    } else {
      // Translation is active
      if (showBilingual) {
        // Show raw (top) + translated (bottom)
        if (item.text_raw && item.text_raw !== item.text_zh) {
          const rawEl = document.createElement('div');
          rawEl.className = 'studio0808-subtitle-raw-item';
          rawEl.textContent = item.text_raw;
          lineWrapper.appendChild(rawEl);
        }
        const zhEl = document.createElement('div');
        zhEl.className = 'studio0808-subtitle-zh-item';
        zhEl.textContent = item.text_zh;
        lineWrapper.appendChild(zhEl);
      } else {
        // Show only translated text with primary styling (larger and bolder)
        const zhEl = document.createElement('div');
        zhEl.className = 'studio0808-subtitle-zh-item';
        zhEl.textContent = item.text_zh;
        lineWrapper.appendChild(zhEl);
      }
    }
    
    subtitleContainer.appendChild(lineWrapper);
  });
  
  subtitleContainer.style.display = 'block';
  subtitleContainer.classList.add('visible');
}

// Listen to runtime messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'show-subtitles') {
    initSubtitleOverlay();
    subtitleHistory = []; // Reset history queue
    subtitleContainer.innerHTML = '';
    
    const targetLang = message.targetLang || 'none';
    const showBilingual = message.showBilingual !== false;
    
    // 更新配音模式標記 (視頻播放 100% 由用戶掌握，絕不強行暫停視頻)
    isDubbingActive = !!message.dubbingEnabled;
    if (isDubbingActive) {
      const vid = getActiveVideo();
      if (vid) attachVideoListeners(vid);
    }
    
    // Push initial status placeholder
    subtitleHistory.push({
      text_raw: targetLang === 'none' ? '語音系統已連線，準備辨識中...' : '',
      text_zh: '語音系統已連線，準備辨識中...'
    });
    
    renderHistorySubtitles(targetLang, showBilingual);
    
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(clearSubtitle, 4000);
  }
  
  if (message.type === 'hide-subtitles') {
    clearSubtitle();
  }
  
  if (message.type === 'render-subtitle') {
    console.log("LiveCaption: Received subtitle to render:", message.data);
    initSubtitleOverlay();
    
    const data = message.data;
    const targetLang = message.targetLang || 'none';
    const showBilingual = message.showBilingual !== false;
    
    // Clear initial status placeholders if any
    subtitleHistory = subtitleHistory.filter(item => 
      item.text_zh !== '語音系統已連線，準備辨識中...'
    );
    
    const duplicateIndex = subtitleHistory.findIndex(item => item.start === data.start);
    if (duplicateIndex !== -1) {
      subtitleHistory[duplicateIndex] = {
        text_raw: data.text_raw,
        text_zh: data.text_zh,
        duration: data.duration,
        start: data.start
      };
    } else {
      subtitleHistory.push({
        text_raw: data.text_raw,
        text_zh: data.text_zh,
        duration: data.duration,
        start: data.start
      });
    }
    
    // Slice queue to match history lines length + 1 (current latest line)
    if (subtitleHistory.length > maxHistoryLines + 1) {
      subtitleHistory = subtitleHistory.slice(subtitleHistory.length - (maxHistoryLines + 1));
    }
    
    renderHistorySubtitles(targetLang, showBilingual);
    
    // Set auto-fade timer
    if (clearTimer) clearTimeout(clearTimer);
    const duration = Math.max(3000, (data.duration || 3) * 1000 + 1500);
    clearTimer = setTimeout(clearSubtitle, duration);
  }
  
  if (message.type === 'dubbing-ready') {
    // 配音已就緒
  }

  if (message.type === 'toggle-bilingual' || message.type === 'update-subtitle-mode') {
    initSubtitleOverlay();
    const targetLang = message.targetLang || 'none';
    const showBilingual = message.showBilingual !== false;
    isDubbingActive = !!message.dubbingEnabled;
    renderHistorySubtitles(targetLang, showBilingual);
  }
  
  if (message.type === 'update-styles') {
    initSubtitleOverlay();
    applySubtitleStyles(null, message.textColor, message.fontSize);
  }
  
  if (message.type === 'update-history-lines') {
    maxHistoryLines = message.historyLines !== undefined ? parseInt(message.historyLines) : 0;
    // Prune queue immediately if new limit is smaller
    if (subtitleHistory.length > maxHistoryLines + 1) {
      subtitleHistory = subtitleHistory.slice(subtitleHistory.length - (maxHistoryLines + 1));
    }
    chrome.storage.local.get(['targetLang', 'showBilingual'], (result) => {
      const targetLang = result.targetLang || 'none';
      const showBilingual = result.showBilingual !== false;
      renderHistorySubtitles(targetLang, showBilingual);
    });
  }
});

function applySubtitleStyles(bg, text, fontSize) {
  if (!subtitleContainer) return;
  
  // Enforce 100% pure transparent background - NO white box, NO frosted glass, NO borders, NO shadow
  subtitleContainer.style.removeProperty('--subtitle-bg');
  subtitleContainer.style.setProperty('background', 'transparent', 'important');
  subtitleContainer.style.setProperty('background-color', 'transparent', 'important');
  subtitleContainer.style.setProperty('background-image', 'none', 'important');
  subtitleContainer.style.setProperty('backdrop-filter', 'none', 'important');
  subtitleContainer.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
  subtitleContainer.style.setProperty('border', 'none', 'important');
  subtitleContainer.style.setProperty('border-radius', '0', 'important');
  subtitleContainer.style.setProperty('box-shadow', 'none', 'important');
  subtitleContainer.style.setProperty('outline', 'none', 'important');
  subtitleContainer.style.setProperty('width', 'max-content', 'important');
  subtitleContainer.style.setProperty('min-width', '0', 'important');
  subtitleContainer.style.setProperty('max-width', '90vw', 'important');
  subtitleContainer.style.setProperty('padding', '0', 'important');
  subtitleContainer.style.setProperty('margin', '0', 'important');

  const textColor = text || '#ffffff';
  subtitleContainer.style.setProperty('--subtitle-color', textColor);
  subtitleContainer.style.setProperty('--subtitle-color-fade', textColor); 
  
  // Map selectors to specific font size scales
  let rawSize = '14px';
  let zhSize = '20px';
  
  if (fontSize === 'small') {
    rawSize = '12px';
    zhSize = '16px';
  } else if (fontSize === 'medium') {
    rawSize = '14px';
    zhSize = '20px';
  } else if (fontSize === 'large') {
    rawSize = '18px';
    zhSize = '25px';
  } else if (fontSize === 'xlarge') {
    rawSize = '22px';
    zhSize = '30px';
  }
  
  subtitleContainer.style.setProperty('--subtitle-font-size-raw', rawSize);
  subtitleContainer.style.setProperty('--subtitle-font-size-zh', zhSize);
}

function clearSubtitle() {
  subtitleHistory = [];
  if (subtitleContainer) {
    subtitleContainer.classList.remove('visible');
    setTimeout(() => {
      // Check if another segment hasn't triggered visibility before hiding
      if (!subtitleContainer.classList.contains('visible')) {
        subtitleContainer.style.display = 'none';
        subtitleContainer.innerHTML = '';
      }
    }, 250);
  }
}

// Automatically clean up old styles and initialize transparent overlay on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitleOverlay);
} else {
  initSubtitleOverlay();
}
