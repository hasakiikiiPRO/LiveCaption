// Elements
const toggleBtn = document.getElementById('toggle-btn');
const reloadBtn = document.getElementById('reload-btn');
const connectionStatus = document.getElementById('connection-status');
const captureStatus = document.getElementById('capture-status');
const ollamaUrlInput = document.getElementById('ollama-url');
const modelNameInput = document.getElementById('model-name');
const deepseekKeyInput = document.getElementById('deepseek-key');
const minSilenceInput = document.getElementById('min-silence');
const maxSpeechInput = document.getElementById('max-speech');
const uiLangInput = document.getElementById('ui-lang');
const sourceLangInput = document.getElementById('source-lang');
const targetLangInput = document.getElementById('target-lang');
const promptPresetInput = document.getElementById('prompt-preset');
const showBilingualInput = document.getElementById('show-bilingual');
const bgTransparentInput = document.getElementById('bg-transparent');
const bgColorInput = document.getElementById('bg-color');
const bgColorContainer = document.getElementById('bg-color-container');
const textColorInput = document.getElementById('text-color');
const fontSizeInput = document.getElementById('font-size');
const historyLinesInput = document.getElementById('history-lines');
const dubbingEnabledInput = document.getElementById('dubbing-enabled');
const dubbingSettingsPanel = document.getElementById('dubbing-settings-panel');
const ttsVoiceInput = document.getElementById('tts-voice');
const duckingVolumeInput = document.getElementById('ducking-volume');
const duckingVolumeVal = document.getElementById('ducking-volume-val');

let isCapturing = false;

// UI Localization dictionary
const i18n = {
  'zh-TW': {
    subtitleDesc: '即時影片語音翻譯字幕',
    langNotice: '⚠️ 語音辨識僅支援：中文（含粵語）、英語、日語、韓語',
    labelConnection: '連線狀態:',
    labelCapture: '擷取狀態:',
    statusDisconnected: '未連線',
    statusConnected: '已連線',
    statusConnecting: '連線中...',
    statusInactive: '未啟動',
    statusCapturing: '擷取中',
    labelUiLang: '介面語言 (UI Language)',
    titleControlPanel: '控制面板',
    btnStart: '啟動即時字幕',
    btnStop: '停止即時字幕',
    labelSourceLang: '影片來源語言',
    optSourceAuto: '自動偵測 (Auto)',
    labelTargetLang: '字幕翻譯語言',
    optTargetNone: '僅顯示原文',
    labelPromptPreset: '翻譯語境場景',
    optPresetGeneral: '通用生活 / 日常對話',
    optPresetLecture: '學術演講 / 線上課程',
    optPresetDrama: '影視戲劇 / 情感口語',
    optPresetNews: '新聞廣播 / 紀實訪談',
    labelShowBilingual: '雙語對照模式 (Bilingual Mode)',
    titleOllama: '本機翻譯設定 (Ollama)',
    noticeOllama: '⚠️ Ollama 需另行安裝，並自行下載 qwen2.5:3b-instruct 模型（約 2GB）。未安裝時系統會自動改用免費的 Google 翻譯，字幕仍可正常運作。',
    linkOllamaGuide: '安裝教學 →',
    labelOllamaUrl: 'Ollama 伺服器網址',
    labelModelName: '翻譯模型名稱',
    titleDeepseek: '雲端翻譯備用 (選填)',
    noticeDeepseek: '需自行至 DeepSeek 開放平台申請金鑰並儲值，屬使用者付費服務（用量計費，日常看片一般每月不到 1 美元）。留空即不啟用。',
    linkDeepseekGuide: '申請教學 →',
    labelDeepseekKey: 'DeepSeek API 金鑰',
    titleAppearance: '字幕外觀設定',
    labelBgTransparent: '全透明底框 (電影字幕風格)',
    labelBgColor: '底框顏色',
    labelTextColor: '文字顏色',
    labelFontSize: '字幕文字大小',
    optSizeSmall: '小 (Small)',
    optSizeMedium: '中 (Medium)',
    optSizeLarge: '大 (Large)',
    optSizeXlarge: '特大 (X-Large)',
    labelHistoryLines: '歷史字幕保留行數',
    optHistory0: '僅顯示最新單行 (0 行歷史)',
    optHistory1: '顯示最新 + 前 1 句 (1 行歷史)',
    optHistory2: '顯示最新 + 前 2 句 (2 行歷史)',
    titleDubbing: 'AI 同傳配音 (Audio Dubbing)',
    labelDubbingEnabled: '啟用即時同傳配音 (聽取代讀)',
    labelTtsVoice: '配音音色',
    optVoiceYunxi: '雲希 (男聲 • 自然解說·紀錄片)',
    optVoiceXiaoxiao: '曉曉 (女聲 • 溫柔知性·清晰)',
    optVoiceYunjian: '雲健 (男聲 • 激情解說·影視)',
    optVoiceYunyang: '雲揚 (男聲 • 專業播報·新聞)',
    labelDuckingVolume: '背景原聲音量 (Ducking):',
    noticeDubbing: '配音播放時自動壓低原聲音量保留背景音；實時聽寫模式下配音約比原聲晚 3-5 秒。',
    titleVad: '進階語音切分設定 (VAD)',
    labelMinSilence: '斷句靜音時間:',
    labelMaxSpeech: '單句最長上限:',
    footerText: '100% 離線隱私保護 • Studio0808',
    second: '秒',
    alertPermission: '無法取得音訊擷取權限，請確認頁面為可播放媒體的網頁。\n錯誤資訊: '
  },
  'zh-CN': {
    subtitleDesc: '实时影片语音翻译字幕',
    langNotice: '⚠️ 语音识别仅支持：中文（含粤语）、英语、日语、韩语',
    labelConnection: '连接状态:',
    labelCapture: '捕获状态:',
    statusDisconnected: '未连接',
    statusConnected: '已连接',
    statusConnecting: '连接中...',
    statusInactive: '未启动',
    statusCapturing: '捕获中',
    labelUiLang: '界面语言 (UI Language)',
    titleControlPanel: '控制面板',
    btnStart: '启动实时字幕',
    btnStop: '停止实时字幕',
    labelSourceLang: '视频来源语言',
    optSourceAuto: '自动侦测 (Auto)',
    labelTargetLang: '字幕翻译语言',
    optTargetNone: '仅显示原文',
    labelPromptPreset: '翻译语境场景',
    optPresetGeneral: '通用生活 / 日常对话',
    optPresetLecture: '学术演讲 / 在线课程',
    optPresetDrama: '影视戏剧 / 情感口语',
    optPresetNews: '新闻广播 / 纪实访谈',
    labelShowBilingual: '双语对照模式 (Bilingual Mode)',
    titleOllama: '本地翻译设置 (Ollama)',
    noticeOllama: '⚠️ Ollama 需另行安装，并自行下载 qwen2.5:3b-instruct 模型（约 2GB）。未安装时系统会自动改用免费的 Google 翻译，字幕仍可正常运作。',
    linkOllamaGuide: '安装教程 →',
    labelOllamaUrl: 'Ollama 服务器网址',
    labelModelName: '翻译模型名称',
    titleDeepseek: '云端翻译备用 (选填)',
    noticeDeepseek: '需自行至 DeepSeek 开放平台申请密钥并充值，属用户付费服务（按用量计费，日常看片一般每月不到 1 美元）。留空即不启用。',
    linkDeepseekGuide: '申请教程 →',
    labelDeepseekKey: 'DeepSeek API 密钥',
    titleAppearance: '字幕外观设置',
    labelBgTransparent: '全透明底框 (电影字幕风格)',
    labelBgColor: '底框颜色',
    labelTextColor: '文字颜色',
    labelFontSize: '字幕文字大小',
    optSizeSmall: '小 (Small)',
    optSizeMedium: '中 (Medium)',
    optSizeLarge: '大 (Large)',
    optSizeXlarge: '特大 (X-Large)',
    labelHistoryLines: '历史字幕保留行数',
    optHistory0: '仅显示最新单行 (0 行历史)',
    optHistory1: '显示最新 + 前 1 句 (1 行历史)',
    optHistory2: '显示最新 + 前 2 句 (2 行历史)',
    titleDubbing: 'AI 同传配音 (Audio Dubbing)',
    labelDubbingEnabled: '启用实时同传配音 (听取代读)',
    labelTtsVoice: '配音音色',
    optVoiceYunxi: '云希 (男声 • 自然解说·纪录片)',
    optVoiceXiaoxiao: '晓晓 (女声 • 温柔知性·清晰)',
    optVoiceYunjian: '云健 (男声 • 激情解说·影视)',
    optVoiceYunyang: '云扬 (男声 • 专业播报·新闻)',
    labelDuckingVolume: '背景原声音量 (Ducking):',
    noticeDubbing: '配音播放时自动压低原声音量保留背景音；实时听写模式下配音约比原声晚 3-5 秒。',
    titleVad: '高级语音切分设置 (VAD)',
    labelMinSilence: '断句静音时间:',
    labelMaxSpeech: '单句最长上限:',
    footerText: '100% 离线隐私保护 • Studio0808',
    second: '秒',
    alertPermission: '无法获取音频捕获权限，请确认页面为可播放媒体的网页。\n错误信息: '
  },
  'en': {
    subtitleDesc: 'Real-time Video Speech Translation Subtitles',
    langNotice: '⚠️ Speech recognition supports: Chinese (incl. Cantonese), English, Japanese, Korean only',
    labelConnection: 'Connection:',
    labelCapture: 'Capture:',
    statusDisconnected: 'Disconnected',
    statusConnected: 'Connected',
    statusConnecting: 'Connecting...',
    statusInactive: 'Inactive',
    statusCapturing: 'Capturing',
    labelUiLang: 'UI Language',
    titleControlPanel: 'Control Panel',
    btnStart: 'Start Live Caption',
    btnStop: 'Stop Live Caption',
    labelSourceLang: 'Video Source Language',
    optSourceAuto: 'Auto Detect (Auto)',
    labelTargetLang: 'Subtitle Translation Language',
    optTargetNone: 'Original Only',
    labelPromptPreset: 'Translation Context / Preset',
    optPresetGeneral: 'General / Daily Conversation',
    optPresetLecture: 'Academic / Online Lectures',
    optPresetDrama: 'Movies & Dramas / Colloquial',
    optPresetNews: 'News & Interviews / Formal',
    labelShowBilingual: 'Bilingual Mode',
    titleOllama: 'Local Translation (Ollama)',
    noticeOllama: '⚠️ Ollama must be installed separately, along with the qwen2.5:3b-instruct model (~2GB). Without it, the system automatically falls back to free Google Translate and captions still work.',
    linkOllamaGuide: 'Setup guide →',
    labelOllamaUrl: 'Ollama Server URL',
    labelModelName: 'Translation Model Name',
    titleDeepseek: 'Cloud Translation Backup (Optional)',
    noticeDeepseek: 'Requires your own key and prepaid balance from the DeepSeek Open Platform — a paid, pay-per-use service (typically under US$1/month for casual viewing). Leave blank to disable.',
    linkDeepseekGuide: 'How to apply →',
    labelDeepseekKey: 'DeepSeek API Key',
    titleAppearance: 'Subtitle Appearance',
    labelBgTransparent: 'Transparent Background (Movie Style)',
    labelBgColor: 'Background Color',
    labelTextColor: 'Text Color',
    labelFontSize: 'Subtitle Font Size',
    optSizeSmall: 'Small',
    optSizeMedium: 'Medium',
    optSizeLarge: 'Large',
    optSizeXlarge: 'X-Large',
    labelHistoryLines: 'Subtitle History Lines',
    optHistory0: 'Show latest only (0 history lines)',
    optHistory1: 'Show latest + 1 line (1 history line)',
    optHistory2: 'Show latest + 2 lines (2 history lines)',
    titleDubbing: 'AI Audio Dubbing',
    labelDubbingEnabled: 'Enable Real-time AI Dubbing',
    labelTtsVoice: 'Dubbing Voice',
    optVoiceYunxi: 'Yunxi (Male • Documentary / Natural)',
    optVoiceXiaoxiao: 'Xiaoxiao (Female • Warm & Clear)',
    optVoiceYunjian: 'Yunjian (Male • Passionate)',
    optVoiceYunyang: 'Yunyang (Male • News Anchor)',
    labelDuckingVolume: 'Background Audio Volume (Ducking):',
    noticeDubbing: 'Automatically lowers background audio during speech. Live ASR mode has ~3-5s natural delay.',
    titleVad: 'Advanced Speech Segmentation (VAD)',
    labelMinSilence: 'Silence Threshold:',
    labelMaxSpeech: 'Max Speech Duration:',
    footerText: '100% Offline Privacy Protection • Studio0808',
    second: 's',
    alertPermission: 'Failed to acquire audio capture permission. Please ensure the page contains playable media.\nError: '
  },
  'ja': {
    subtitleDesc: 'リアルタイムのビデオ音声翻訳字幕',
    langNotice: '⚠️ 音声認識対応言語：中国語（広東語含む）、英語、日本語、韓国語のみ',
    labelConnection: '接続状態:',
    labelCapture: 'キャプチャ状態:',
    statusDisconnected: '未接続',
    statusConnected: '接続済み',
    statusConnecting: '接続中...',
    statusInactive: '未起動',
    statusCapturing: 'キャプチャ中',
    labelUiLang: '画面言語 (UI Language)',
    titleControlPanel: 'コントロールパネル',
    btnStart: 'リアルタイム字幕を開始',
    btnStop: 'リアルタイム字幕を停止',
    labelSourceLang: 'ビデオのソース言語',
    optSourceAuto: '自動検出 (Auto)',
    labelTargetLang: '字幕翻訳言語',
    optTargetNone: '原文のみ表示',
    labelPromptPreset: '翻訳シナリオ (プリセット)',
    optPresetGeneral: '日常会話・一般的な動画',
    optPresetLecture: '学術講義・オンライン講座',
    optPresetDrama: '映画・ドラマ・感情表現',
    optPresetNews: 'ニュース・対談・公式報道',
    labelShowBilingual: '二言語表示モード',
    titleOllama: 'ローカル翻訳設定 (Ollama)',
    noticeOllama: '⚠️ Ollama は別途インストールが必要で、qwen2.5:3b-instruct モデル（約 2GB）もご自身でダウンロードしてください。未導入の場合は自動的に無料の Google 翻訳に切り替わり、字幕は正常に動作します。',
    linkOllamaGuide: 'インストール手順 →',
    labelOllamaUrl: 'Ollama サーバー URL',
    labelModelName: '翻訳モデル名',
    titleDeepseek: 'クラウド翻訳バックアップ (任意)',
    noticeDeepseek: 'DeepSeek オープンプラットフォームでキーの取得とチャージが必要な有料サービスです（従量課金。通常の視聴なら月 1 米ドル未満）。空欄なら無効です。',
    linkDeepseekGuide: '申請手順 →',
    labelDeepseekKey: 'DeepSeek API キー',
    titleAppearance: '字幕外観設定',
    labelBgTransparent: '背景を完全に透明にする (映画風)',
    labelBgColor: '背景色',
    labelTextColor: '文字色',
    labelFontSize: '字幕文字サイズ',
    optSizeSmall: '小 (Small)',
    optSizeMedium: '中 (Medium)',
    optSizeLarge: '大 (Large)',
    optSizeXlarge: '特大 (X-Large)',
    labelHistoryLines: '履歴字幕表示行수',
    optHistory0: '最新の1行のみ (履歴なし)',
    optHistory1: '最新 + 前の1行 (履歴1行)',
    optHistory2: '最新 + 前의2行 (履歴2行)',
    titleDubbing: 'AIリアルタイム吹き替え (Dubbing)',
    labelDubbingEnabled: 'AI同時吹き替えを有効にする',
    labelTtsVoice: '吹き替え音声',
    optVoiceYunxi: 'Yunxi (男性 • 解説・ドキュメンタリー)',
    optVoiceXiaoxiao: 'Xiaoxiao (女性 • 穏やか・クリア)',
    optVoiceYunjian: 'Yunjian (男性 • 情熱的)',
    optVoiceYunyang: 'Yunyang (男性 • ニュース)',
    labelDuckingVolume: '背景音量 (Ducking):',
    noticeDubbing: '吹き替え再生時に元音声を自動で抑えます。リアルタイム書き起こしでは3〜5秒の遅延が生じます。',
    titleVad: '高度な音声セグメンテーション (VAD)',
    labelMinSilence: '無音判定時間:',
    labelMaxSpeech: '単句最大時間:',
    footerText: '100% オフラインプライバシー保護 • Studio0808',
    second: '秒',
    alertPermission: '音声キャプチャ権限を取得できませんでした。メディア再生可能なページであることを確認してください。\nエラー情報: '
  },
  'ko': {
    subtitleDesc: '실시간 비디오 음성 번역 자막',
    langNotice: '⚠️ 음성 인식 지원: 중국어(광동어 포함), 영어, 일본어, 한국어만 지원',
    labelConnection: '연결 상태:',
    labelCapture: '캡처 상태:',
    statusDisconnected: '미연결',
    statusConnected: '연결됨',
    statusConnecting: '연결 중...',
    statusInactive: '미실행',
    statusCapturing: '캡처 중',
    labelUiLang: '인터페이스 언어 (UI Language)',
    titleControlPanel: '제어판',
    btnStart: '실시간 자막 시작',
    btnStop: '실시간 자막 중지',
    labelSourceLang: '비디오 원본 언어',
    optSourceAuto: '자동 감지 (Auto)',
    labelTargetLang: '자막 번역 언어',
    optTargetNone: '원본만 표시',
    labelPromptPreset: '번역 상황 프리셋',
    optPresetGeneral: '일상 대화 / 일반 영상',
    optPresetLecture: '학술 강의 / 온라인 강좌',
    optPresetDrama: '영화·드라마 / 구어체',
    optPresetNews: '뉴스·인터뷰 / 공식 보도',
    labelShowBilingual: '이중 언어 대조 모드',
    titleOllama: '로컬 번역 설정 (Ollama)',
    noticeOllama: '⚠️ Ollama는 별도로 설치해야 하며, qwen2.5:3b-instruct 모델(약 2GB)도 직접 내려받아야 합니다. 설치하지 않으면 무료 Google 번역으로 자동 전환되어 자막은 정상 작동합니다.',
    linkOllamaGuide: '설치 가이드 →',
    labelOllamaUrl: 'Ollama 서버 주소',
    labelModelName: '번역 모델 이름',
    titleDeepseek: '클라우드 번역 백업 (선택)',
    noticeDeepseek: 'DeepSeek 오픈 플랫폼에서 직접 키를 발급받고 충전해야 하는 유료 서비스입니다(사용량 과금, 일반적인 시청은 월 1달러 미만). 비워 두면 사용하지 않습니다.',
    linkDeepseekGuide: '신청 가이드 →',
    labelDeepseekKey: 'DeepSeek API 키',
    titleAppearance: '자막 모양 설정',
    labelBgTransparent: '투명 배경 (영화 자막 스타일)',
    labelBgColor: '배경 색상',
    labelTextColor: '텍스트 색상',
    labelFontSize: '자막 텍스트 크기',
    optSizeSmall: '작게 (Small)',
    optSizeMedium: '중간 (Medium)',
    optSizeLarge: '크게 (Large)',
    optSizeXlarge: '아주 크게 (X-Large)',
    labelHistoryLines: '이전 자막 표시 줄 수',
    optHistory0: '최신 한 줄만 표시 (0개 기록)',
    optHistory1: '최신 + 이전 1줄 표시 (1개 기록)',
    optHistory2: '최신 + 이전 2줄 표시 (2개 기록)',
    titleDubbing: 'AI 실시간 더빙 (Audio Dubbing)',
    labelDubbingEnabled: '실시간 AI 더빙 활성화',
    labelTtsVoice: '더빙 목소리',
    optVoiceYunxi: 'Yunxi (남성 • 다큐멘터리/자연스러운 해설)',
    optVoiceXiaoxiao: 'Xiaoxiao (여성 • 다정하고 명확한 음성)',
    optVoiceYunjian: 'Yunjian (남성 • 열정적인 해설)',
    optVoiceYunyang: 'Yunyang (남성 • 뉴스 앵커)',
    labelDuckingVolume: '배경 원음 볼륨 (Ducking):',
    noticeDubbing: '더빙 재생 시 원음 볼륨을 자동으로 낮춥니다. 실시간 받아쓰기 모드에서는 3-5초의 지연이 발생합니다.',
    titleVad: '고급 음성 분할 설정 (VAD)',
    labelMinSilence: '음절 무음 시간:',
    labelMaxSpeech: '한 줄 최대 시간:',
    footerText: '100% 오프라인 개인 정보 보호 • Studio0808',
    second: '초',
    alertPermission: '오디오 캡처 권한을 가져오지 못했습니다. 미디어가 재생 가능한 페이지인지 확인하십시오.\n오류 정보: '
  }
};

function getTranslation(lang, key) {
  const dict = i18n[lang] || i18n['en'];
  return dict[key] || i18n['en'][key] || '';
}

function updateDubbingLangInfo() {
  const infoEl = document.getElementById('dubbing-lang-info');
  if (!infoEl) return;
  const target = targetLangInput ? targetLangInput.value : 'none';
  const isZhTw = uiLangInput && uiLangInput.value === 'zh-TW';
  
  const targetMap = isZhTw ? {
    'zh-CN': '簡體中文',
    'zh-TW': '繁體中文',
    'en': '英文 (English)',
    'ja': '日文 (Japanese)',
    'ko': '韓文 (Korean)',
    'es': '西班牙文',
    'fr': '法文',
    'de': '德文',
    'ru': '俄文'
  } : {
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    'en': '英文 (English)',
    'ja': '日文 (Japanese)',
    'ko': '韩文 (Korean)',
    'es': '西班牙文',
    'fr': '法文',
    'de': '德文',
    'ru': '俄文'
  };

  if (target === 'none') {
    infoEl.innerHTML = isZhTw
      ? `⚠️ <strong>目前為「僅顯示原文」</strong>：配音將朗讀原聲語言。若需中文同傳，請在上方選擇中文翻譯。`
      : `⚠️ <strong>当前为“仅显示原文”</strong>：配音将朗读原声语言。若需中文同传，请在上方选择中文翻译。`;
    infoEl.parentElement.style.borderLeftColor = '#f59e0b';
    infoEl.parentElement.style.background = 'rgba(245, 158, 11, 0.1)';
  } else {
    const langName = targetMap[target] || target;
    infoEl.innerHTML = isZhTw
      ? `🔊 配音朗讀語種：<strong>${langName}</strong>（自動跟隨字幕翻譯）`
      : `🔊 配音朗读语种：<strong>${langName}</strong>（自动跟随字幕翻译）`;
    infoEl.parentElement.style.borderLeftColor = '#0284c7';
    infoEl.parentElement.style.background = 'rgba(2, 132, 199, 0.08)';
  }
}

function updateVadLabels(lang) {
  const minVal = minSilenceInput.value;
  const maxVal = maxSpeechInput.value;
  const minLabel = getTranslation(lang, 'labelMinSilence');
  const maxLabel = getTranslation(lang, 'labelMaxSpeech');
  const secUnit = getTranslation(lang, 'second');
  
  const minSilenceLabel = document.querySelector('label[for="min-silence"]');
  minSilenceLabel.innerHTML = `${minLabel} <span id="min-silence-val">${minVal}</span> ${secUnit}`;
  
  const maxSpeechLabel = document.querySelector('label[for="max-speech"]');
  maxSpeechLabel.innerHTML = `${maxLabel} <span id="max-speech-val">${maxVal}</span> ${secUnit}`;
}

function applyLanguage(lang) {
  document.getElementById('subtitle-desc').textContent = getTranslation(lang, 'subtitleDesc');
  document.getElementById('lang-notice').textContent = getTranslation(lang, 'langNotice');
  
  const labels = document.querySelectorAll('.status-item .label');
  if (labels.length >= 2) {
    labels[0].textContent = getTranslation(lang, 'labelConnection');
    labels[1].textContent = getTranslation(lang, 'labelCapture');
  }
  
  document.getElementById('label-ui-lang').textContent = getTranslation(lang, 'labelUiLang');
  document.getElementById('title-control-panel').textContent = getTranslation(lang, 'titleControlPanel');
  
  document.getElementById('label-source-lang').textContent = getTranslation(lang, 'labelSourceLang');
  document.getElementById('opt-source-auto').textContent = getTranslation(lang, 'optSourceAuto');
  document.getElementById('label-target-lang').textContent = getTranslation(lang, 'labelTargetLang');
  document.getElementById('opt-target-none').textContent = getTranslation(lang, 'optTargetNone');
  if (document.getElementById('label-prompt-preset')) {
    document.getElementById('label-prompt-preset').textContent = getTranslation(lang, 'labelPromptPreset');
    document.getElementById('opt-preset-general').textContent = getTranslation(lang, 'optPresetGeneral');
    document.getElementById('opt-preset-lecture').textContent = getTranslation(lang, 'optPresetLecture');
    document.getElementById('opt-preset-drama').textContent = getTranslation(lang, 'optPresetDrama');
    document.getElementById('opt-preset-news').textContent = getTranslation(lang, 'optPresetNews');
  }
  document.getElementById('label-show-bilingual').textContent = getTranslation(lang, 'labelShowBilingual');
  
  document.getElementById('title-ollama').textContent = getTranslation(lang, 'titleOllama');
  document.getElementById('notice-ollama').textContent = getTranslation(lang, 'noticeOllama');
  document.getElementById('link-ollama-guide').textContent = getTranslation(lang, 'linkOllamaGuide');
  document.querySelector('label[for="ollama-url"]').textContent = getTranslation(lang, 'labelOllamaUrl');
  document.querySelector('label[for="model-name"]').textContent = getTranslation(lang, 'labelModelName');

  document.getElementById('title-deepseek').textContent = getTranslation(lang, 'titleDeepseek');
  document.getElementById('notice-deepseek').textContent = getTranslation(lang, 'noticeDeepseek');
  document.getElementById('link-deepseek-guide').textContent = getTranslation(lang, 'linkDeepseekGuide');
  document.querySelector('label[for="deepseek-key"]').textContent = getTranslation(lang, 'labelDeepseekKey');
  
  document.getElementById('title-appearance').textContent = getTranslation(lang, 'titleAppearance');
  const labelBgTransparent = document.getElementById('label-bg-transparent');
  if (labelBgTransparent) {
    labelBgTransparent.textContent = getTranslation(lang, 'labelBgTransparent');
  }
  const labelBgColor = document.querySelector('label[for="bg-color"]');
  if (labelBgColor) {
    labelBgColor.textContent = getTranslation(lang, 'labelBgColor');
  }
  document.querySelector('label[for="text-color"]').textContent = getTranslation(lang, 'labelTextColor');
  document.querySelector('label[for="font-size"]').textContent = getTranslation(lang, 'labelFontSize');
  
  const fontOptions = document.getElementById('font-size').options;
  fontOptions[0].textContent = getTranslation(lang, 'optSizeSmall');
  fontOptions[1].textContent = getTranslation(lang, 'optSizeMedium');
  fontOptions[2].textContent = getTranslation(lang, 'optSizeLarge');
  fontOptions[3].textContent = getTranslation(lang, 'optSizeXlarge');
  
  document.querySelector('label[for="history-lines"]').textContent = getTranslation(lang, 'labelHistoryLines');
  const historyOptions = document.getElementById('history-lines').options;
  historyOptions[0].textContent = getTranslation(lang, 'optHistory0');
  historyOptions[1].textContent = getTranslation(lang, 'optHistory1');
  historyOptions[2].textContent = getTranslation(lang, 'optHistory2');
  
  if (document.getElementById('title-dubbing')) {
    document.getElementById('title-dubbing').textContent = getTranslation(lang, 'titleDubbing');
    document.getElementById('label-dubbing-enabled').textContent = getTranslation(lang, 'labelDubbingEnabled');
    document.getElementById('label-tts-voice').textContent = getTranslation(lang, 'labelTtsVoice');
    document.getElementById('opt-voice-yunxi').textContent = getTranslation(lang, 'optVoiceYunxi');
    document.getElementById('opt-voice-xiaoxiao').textContent = getTranslation(lang, 'optVoiceXiaoxiao');
    document.getElementById('opt-voice-yunjian').textContent = getTranslation(lang, 'optVoiceYunjian');
    document.getElementById('opt-voice-yunyang').textContent = getTranslation(lang, 'optVoiceYunyang');
    document.getElementById('notice-dubbing').textContent = getTranslation(lang, 'noticeDubbing');
  }

  document.getElementById('title-vad').textContent = getTranslation(lang, 'titleVad');
  updateVadLabels(lang);
  
  document.getElementById('footer-text').textContent = getTranslation(lang, 'footerText');
}

chrome.storage.local.get([
  'ollamaUrl', 'modelName', 'deepseekKey', 'minSilence', 'maxSpeech',
  'uiLang', 'sourceLang', 'targetLang', 'promptPreset', 'showBilingual',
  'bgColor', 'textColor', 'fontSize', 'historyLines', 'bgTransparent',
  'dubbingEnabled', 'ttsVoice', 'duckingVolume'
], (result) => {
  if (result.ollamaUrl) ollamaUrlInput.value = result.ollamaUrl;
  if (result.modelName) modelNameInput.value = result.modelName;
  if (result.deepseekKey) deepseekKeyInput.value = result.deepseekKey;
  if (result.minSilence !== undefined) {
    minSilenceInput.value = result.minSilence;
  }
  if (result.maxSpeech !== undefined) {
    maxSpeechInput.value = result.maxSpeech;
  }
  if (result.uiLang) {
    uiLangInput.value = result.uiLang;
  } else {
    uiLangInput.value = 'zh-TW';
  }
  if (result.sourceLang) sourceLangInput.value = result.sourceLang;
  if (result.targetLang) targetLangInput.value = result.targetLang;
  if (promptPresetInput) {
    promptPresetInput.value = result.promptPreset || 'general';
  }
  if (result.showBilingual !== undefined) {
    showBilingualInput.checked = result.showBilingual;
  } else {
    showBilingualInput.checked = true;
  }
  if (bgTransparentInput) {
    bgTransparentInput.checked = true;
  }
  if (bgColorContainer) {
    bgColorContainer.style.display = 'none';
  }
  if (bgColorInput && result.bgColor) bgColorInput.value = result.bgColor;
  if (result.textColor) textColorInput.value = result.textColor;
  if (result.fontSize) fontSizeInput.value = result.fontSize;
  if (result.historyLines !== undefined) historyLinesInput.value = result.historyLines;

  if (dubbingEnabledInput) {
    dubbingEnabledInput.checked = !!result.dubbingEnabled;
    dubbingSettingsPanel.style.display = dubbingEnabledInput.checked ? 'block' : 'none';
  }
  if (ttsVoiceInput && result.ttsVoice) {
    ttsVoiceInput.value = result.ttsVoice;
  }
  if (duckingVolumeInput && result.duckingVolume !== undefined) {
    duckingVolumeInput.value = result.duckingVolume;
    if (duckingVolumeVal) {
      duckingVolumeVal.textContent = Math.round(Number(result.duckingVolume) * 100) + '%';
    }
  }

  // Apply localization initially
  applyLanguage(uiLangInput.value);
  updateDubbingLangInfo();
  updateStatus();
});
// Update settings in storage on input
const saveSettings = () => {
  const settings = {
    ollamaUrl: ollamaUrlInput.value,
    modelName: modelNameInput.value,
    deepseekKey: deepseekKeyInput.value,
    minSilence: parseFloat(minSilenceInput.value),
    maxSpeech: parseFloat(maxSpeechInput.value),
    uiLang: uiLangInput.value,
    sourceLang: sourceLangInput.value,
    targetLang: targetLangInput.value,
    promptPreset: promptPresetInput ? promptPresetInput.value : 'general',
    preset: promptPresetInput ? promptPresetInput.value : 'general',
    dubbingEnabled: dubbingEnabledInput ? dubbingEnabledInput.checked : false,
    ttsVoice: ttsVoiceInput ? ttsVoiceInput.value : 'yunxi',
    duckingVolume: duckingVolumeInput ? parseFloat(duckingVolumeInput.value) : 0.10,
    showBilingual: showBilingualInput.checked,
    bgTransparent: true,
    bgColor: bgColorInput ? bgColorInput.value : 'transparent',
    textColor: textColorInput.value,
    fontSize: fontSizeInput.value,
    historyLines: parseInt(historyLinesInput.value)
  };
  chrome.storage.local.set(settings);
  
  // Also propagate config to backend if currently active
  chrome.runtime.sendMessage({
    type: 'update-config',
    config: settings
  });

  // Notify content script in the active tab to update styles, lines, and mode in real-time
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'update-styles',
        textColor: settings.textColor,
        fontSize: settings.fontSize,
        bgTransparent: true
      }).catch(() => {});

      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'update-history-lines',
        historyLines: settings.historyLines
      }).catch(() => {});

      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'update-subtitle-mode',
        targetLang: settings.targetLang,
        showBilingual: settings.showBilingual
      }).catch(() => {});
    }
  });
};

ollamaUrlInput.addEventListener('input', saveSettings);
modelNameInput.addEventListener('input', saveSettings);
deepseekKeyInput.addEventListener('input', saveSettings);

uiLangInput.addEventListener('change', () => {
  applyLanguage(uiLangInput.value);
  saveSettings();
  updateStatus();
});
sourceLangInput.addEventListener('change', saveSettings);
targetLangInput.addEventListener('change', () => {
  updateDubbingLangInfo();
  saveSettings();
});
if (promptPresetInput) promptPresetInput.addEventListener('change', saveSettings);
showBilingualInput.addEventListener('change', saveSettings);

if (bgColorInput) bgColorInput.addEventListener('input', saveSettings);
textColorInput.addEventListener('input', saveSettings);
fontSizeInput.addEventListener('change', saveSettings);
historyLinesInput.addEventListener('change', saveSettings);
if (bgTransparentInput) {
  bgTransparentInput.addEventListener('change', () => {
    saveSettings();
  });
}

if (dubbingEnabledInput) {
  dubbingEnabledInput.addEventListener('change', () => {
    if (dubbingEnabledInput.checked && targetLangInput && targetLangInput.value === 'none') {
      // 智能聯動：啟用同傳配音時，若翻譯語言仍為「僅顯示原文」，自動切換至中文
      targetLangInput.value = (uiLangInput.value === 'zh-CN') ? 'zh-CN' : 'zh-TW';
    }
    dubbingSettingsPanel.style.display = dubbingEnabledInput.checked ? 'block' : 'none';
    updateDubbingLangInfo();
    saveSettings();
  });
}
if (ttsVoiceInput) {
  ttsVoiceInput.addEventListener('change', saveSettings);
}
if (duckingVolumeInput) {
  duckingVolumeInput.addEventListener('input', () => {
    if (duckingVolumeVal) {
      duckingVolumeVal.textContent = Math.round(Number(duckingVolumeInput.value) * 100) + '%';
    }
    saveSettings();
  });
}

minSilenceInput.addEventListener('input', () => {
  updateVadLabels(uiLangInput.value);
  saveSettings();
});

maxSpeechInput.addEventListener('input', () => {
  updateVadLabels(uiLangInput.value);
  saveSettings();
});

// Query status on popup open
const updateStatus = () => {
  const lang = uiLangInput.value;
  chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Could not communicate with background script:", chrome.runtime.lastError.message);
      return;
    }
    if (response) {
      isCapturing = response.isCapturing;
      
      // Update toggle button
      if (isCapturing) {
        toggleBtn.textContent = getTranslation(lang, 'btnStop');
        toggleBtn.className = 'btn btn-stop';
        captureStatus.textContent = getTranslation(lang, 'statusCapturing');
        captureStatus.className = 'status active';
      } else {
        toggleBtn.textContent = getTranslation(lang, 'btnStart');
        toggleBtn.className = 'btn btn-start';
        captureStatus.textContent = getTranslation(lang, 'statusInactive');
        captureStatus.className = 'status inactive';
      }
      
      // Update connection status
      if (response.isConnected) {
        connectionStatus.textContent = getTranslation(lang, 'statusConnected');
        connectionStatus.className = 'status online';
      } else {
        connectionStatus.textContent = isCapturing ? getTranslation(lang, 'statusConnecting') : getTranslation(lang, 'statusDisconnected');
        connectionStatus.className = 'status offline';
      }
    }
  });
};

// Initial update and periodic polling while popup is open
updateStatus();
const intervalId = setInterval(updateStatus, 1000);
window.addEventListener('unload', () => clearInterval(intervalId));

// Button toggle
toggleBtn.addEventListener('click', async () => {
  if (isCapturing) {
    chrome.runtime.sendMessage({ type: 'stop-capture' }, () => {
      setTimeout(updateStatus, 200);
    });
  } else {
    saveSettings();
    try {
      // 1. Get active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) return;
      const tab = tabs[0];
      
      // 2. Request stream ID under user gesture
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
        if (chrome.runtime.lastError) {
          console.error("無法取得音訊擷取 ID:", chrome.runtime.lastError.message);
          const alertText = getTranslation(uiLangInput.value, 'alertPermission');
          alert(alertText + chrome.runtime.lastError.message);
          return;
        }
        
        // 3. Send message to background
        chrome.runtime.sendMessage({
          type: 'start-capture',
          streamId: streamId,
          tabId: tab.id
        }, () => {
          setTimeout(updateStatus, 200);
        });
      });
    } catch (err) {
      console.error("啟動擷取失敗:", err);
    }
  }
});

if (reloadBtn) {
  reloadBtn.addEventListener('click', () => {
    reloadBtn.textContent = '🔄 重新載入中...';
    reloadBtn.disabled = true;
    setTimeout(() => {
      chrome.runtime.reload();
    }, 150);
  });
}
