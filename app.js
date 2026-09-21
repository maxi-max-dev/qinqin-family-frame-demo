(() => {
  'use strict';

  const STORAGE_KEY = 'qinqin-family-frame:v1';
  const CHANNEL_NAME = 'qinqin-family-frame';
  const photoDefaults = [
    { id: 'living', src: 'assets/family-living.jpg', caption: '今天在海边散步，想你啦！', sender: 'grandson', senderName: '孙子 · 小宇', time: '今天 · 09:32' },
    { id: 'garden', src: 'assets/child-garden.jpg', caption: '今天在窗边晒太阳，想跟你聊聊天。', sender: 'granddaughter', senderName: '外孙女 · 安安', time: '昨天 · 16:18' },
    { id: 'table', src: 'assets/family-table.jpg', caption: '小宝宝又长大了一点，给你看看小手。', sender: 'daughter', senderName: '女儿 · 丽丽', time: '周六 · 18:40' },
    { id: 'flowers', src: 'assets/flowers.jpg', caption: '今天看到一片盛开的花，拍给你看看。', sender: 'grandson', senderName: '孙子 · 小宇', time: '周五 · 10:06' }
  ];
  const people = [
    { id: 'grandson', name: '孙子', detail: '小宇 · 常联系', initial: '孙', avatar: 'sun' },
    { id: 'daughter', name: '女儿', detail: '丽丽 · 昨天在线', initial: '丽', avatar: 'coral' },
    { id: 'granddaughter', name: '外孙女', detail: '安安 · 读书中', initial: '安', avatar: 'mint' }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let state = loadState();
  let currentMode = 'elder';
  let selectedFile = null;
  let pendingRecording = null;
  let mediaRecorder = null;
  let recordingChunks = [];
  let recordingRequestId = 0;
  let recordingDialogOpen = false;
  let recordingCancelled = false;
  let activeRecognition = null;
  let recognitionTimer = null;
  let recognitionHadResult = false;
  let toastTimer;
  let demoTimers = [];
  let channel = null;

  function initialState() {
    return {
      photos: photoDefaults.map(photo => ({ ...photo })),
      currentPhoto: 0,
      messages: [
        { id: 'welcome-1', text: '看到了，花真好看。', from: '奶奶', time: '今天 · 09:38' },
        { id: 'welcome-2', text: '吃饭了吗？记得别忙太晚。', from: '奶奶', time: '昨天 · 20:11' }
      ],
      lastSender: 'grandson'
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.photos) && Array.isArray(saved.messages)) {
        return { ...initialState(), ...saved, currentPhoto: Number(saved.currentPhoto) || 0 };
      }
    } catch (error) {
      console.info('读取本机演示数据失败，将使用示例内容。', error);
    }
    return initialState();
  }

  function persist(reason = '更新了演示数据') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (channel) channel.postMessage({ type: 'state', state });
      return true;
    } catch (error) {
      showToast('本机存储空间不足，这次内容未保存。可以先清除演示数据再试。');
      console.warn(reason, error);
      return false;
    }
  }

  function initSync() {
    try {
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.addEventListener('message', event => {
          if (event.data?.type === 'state' && event.data.state) {
            state = event.data.state;
            renderAll();
            showToast('另一个演示窗口刚刚更新了内容。');
          }
        });
      }
      window.addEventListener('storage', event => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try { state = JSON.parse(event.newValue); renderAll(); } catch (_) { /* ignore malformed external data */ }
      });
    } catch (error) { console.info('跨标签页同步不可用。', error); }
  }

  function renderAll() {
    renderPeople();
    renderActivities();
    renderPhotos();
    renderInbox();
    $('#messageCount').textContent = `${state.messages.length} 条`;
    $('#photoCount').textContent = `${state.photos.length} 张`;
    if (selectedFile) renderUploadPreview();
  }

  function renderPeople() {
    $('#peopleList').innerHTML = people.map(person => `
      <button class="person-row" type="button" data-call="${person.id}" aria-label="呼叫${person.name} ${person.detail}">
        <span class="person-avatar ${person.avatar}">${person.initial}</span>
        <span class="person-copy"><strong>${person.name}</strong><small>${person.detail}</small></span>
        <span class="call-symbol" aria-hidden="true">☎</span>
      </button>`).join('');
  }

  function renderActivities() {
    $('#activityList').innerHTML = state.photos.slice(0, 4).map(photo => `
      <button class="activity-item" type="button" data-photo-id="${escapeAttribute(photo.id)}">
        <span class="activity-thumb" style="background-image:url('${escapeAttribute(photo.src)}')"></span>
        <span class="activity-copy"><strong>${escapeHtml(photo.caption)}</strong><small>${escapeHtml(photo.senderName)} · ${escapeHtml(photo.time)}</small></span>
      </button>`).join('');
  }

  function renderPhotos() {
    if (!state.photos.length) return;
    state.currentPhoto = Math.max(0, Math.min(state.currentPhoto, state.photos.length - 1));
    const photo = state.photos[state.currentPhoto];
    const img = $('#elderPhoto');
    img.src = photo.src;
    img.alt = photo.caption;
    $('#photoCaption').textContent = photo.caption;
    $('#photoTag').textContent = `来自${photo.senderName.split(' · ')[0]}`;
    $('#photoPosition').textContent = `${state.currentPhoto + 1} / ${state.photos.length}`;
    $('#photoTime').textContent = photo.time;
    $('#audioLabel').textContent = photo.audio ? `收到一段来自${photo.senderName.split(' · ')[0]}的语音留言` : '听这张照片的介绍 / 朗读文字';
  }

  function renderInbox() {
    $('#inbox').innerHTML = state.messages.slice(0, 4).map(message => `
      <article class="inbox-item"><p>${escapeHtml(message.text)}</p><small>${escapeHtml(message.from)} · ${escapeHtml(message.time)}${message.audio ? ' · 有录音' : ''}</small>${message.audio ? `<button class="text-button play-message" type="button" data-message-id="${escapeAttribute(message.id)}">▶ 播放录音</button>` : ''}</article>`).join('');
  }

  function setMode(mode) {
    currentMode = mode;
    $$('.mode-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.mode === mode));
    const elderVisible = mode === 'elder' || mode === 'split';
    const familyVisible = mode === 'family' || mode === 'split';
    $('#elderPreview').hidden = !elderVisible;
    $('#familyPreview').hidden = !familyVisible;
    $('#stageLabel').textContent = mode === 'split' ? '双端同屏' : mode === 'family' ? '家人的手机' : '奶奶的相框';
    $('#devices').classList.toggle('is-split', mode === 'split');
  }

  function movePhoto(delta) {
    if (!state.photos.length) return;
    state.currentPhoto = (state.currentPhoto + delta + state.photos.length) % state.photos.length;
    persist('切换照片');
    renderPhotos();
    showToast(delta > 0 ? '下一张照片' : '上一张照片');
  }

  function speakText(text) {
    if (!('speechSynthesis' in window)) {
      showToast('这个浏览器没有朗读功能，可以直接看文字。');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = .9;
    window.speechSynthesis.speak(utterance);
    showToast('正在为你朗读');
  }

  function listenCurrent() {
    const photo = state.photos[state.currentPhoto];
    const wave = $('.sound-wave');
    wave.classList.add('is-playing');
    window.setTimeout(() => wave.classList.remove('is-playing'), 2300);
    speakText(`${photo.senderName}说：${photo.caption}`);
  }

  function showToast(text) {
    const toast = $('#toast');
    toast.textContent = text;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
  }

  function openCall(personId = 'grandson') {
    const person = people.find(item => item.id === personId) || people[0];
    $('#callAvatar').textContent = person.initial;
    $('#callTitle').textContent = `${person.name} · ${person.detail.split(' · ')[0]}`;
    $('#callStatus').textContent = '等待选择';
    $('#callModal').dataset.person = person.id;
    if (typeof $('#callModal').showModal === 'function') $('#callModal').showModal();
    else $('#callModal').setAttribute('open', '');
  }

  function closeDialog(id) {
    if (id === '#messageModal') cancelRecordingFlow();
    const dialog = $(id);
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
  }

  function callStatus(text) {
    $('#callStatus').textContent = text;
    showToast(text);
  }

  function openMessage(text = '') {
    recordingDialogOpen = true;
    recordingCancelled = false;
    $('#messageInput').value = text;
    $('#messageFeedback').textContent = '';
    if (typeof $('#messageModal').showModal === 'function') $('#messageModal').showModal();
    else $('#messageModal').setAttribute('open', '');
    window.setTimeout(() => $('#messageInput').focus(), 40);
  }

  async function compressImage(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('请选择 JPG、PNG 等图片文件。');
    if (file.size > 12 * 1024 * 1024) throw new Error('这张图片超过 12MB，请换一张小一点的。');
    const bitmap = await createImageBitmap(file).catch(() => null);
    const image = bitmap || await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = reader.result; };
      reader.onerror = reject; reader.readAsDataURL(file);
    });
    const maxEdge = 1280;
    const ratio = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    if (bitmap) bitmap.close();
    return canvas.toDataURL('image/jpeg', .78);
  }

  function renderUploadPreview() {
    if (!selectedFile) return;
    $('#uploadPreview').src = selectedFile.dataUrl;
    $('#uploadPreview').hidden = false;
    $('#uploadPlaceholder').hidden = true;
  }

  async function handleFile(file) {
    selectedFile = null;
    $('#uploadPreview').hidden = true;
    $('#uploadPlaceholder').hidden = false;
    $('#uploadFeedback').textContent = '';
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      selectedFile = { dataUrl, name: file.name };
      renderUploadPreview();
      $('#uploadFeedback').textContent = '照片准备好了，还可以写一句话。';
      $('#uploadFeedback').classList.add('is-good');
    } catch (error) {
      $('#uploadFeedback').textContent = error.message || '图片读取失败，请换一张再试。';
      $('#uploadFeedback').classList.remove('is-good');
    }
  }

  function sendPhoto(event) {
    event.preventDefault();
    if (!selectedFile) { $('#uploadFeedback').textContent = '请先选一张照片。'; $('#uploadFeedback').classList.remove('is-good'); return; }
    const sender = people.find(person => person.id === $('#senderSelect').value) || people[0];
    const caption = $('#photoDescription').value.trim() || '今天也想和你分享一点日常。';
    const photo = { id: `local-${Date.now()}`, src: selectedFile.dataUrl, caption, sender: sender.id, senderName: `${sender.name} · ${sender.detail.split(' · ')[0]}`, time: '刚刚' };
    state.photos.unshift(photo);
    state.currentPhoto = 0;
    state.lastSender = sender.id;
    if (!persist('发送照片')) { state.photos.shift(); return; }
    selectedFile = null;
    $('#photoInput').value = '';
    $('#photoDescription').value = '';
    $('#uploadPreview').hidden = true;
    $('#uploadPlaceholder').hidden = false;
    $('#uploadFeedback').textContent = '已送到奶奶的相框，马上能看见。';
    $('#uploadFeedback').classList.add('is-good');
    renderAll();
    setMode('elder');
    showToast('照片已送到奶奶的相框');
  }

  function saveMessage() {
    const text = $('#messageInput').value.trim();
    if (!text && !pendingRecording) { $('#messageFeedback').textContent = '写一句话，或者先录一段声音。'; return; }
    const message = { id: `message-${Date.now()}`, text: text || '（一段来自奶奶的声音）', from: '奶奶', time: '刚刚' };
    if (pendingRecording) { message.audio = pendingRecording; }
    state.messages.unshift(message);
    if (!persist('保存留言')) { state.messages.shift(); return; }
    pendingRecording = null;
    $('#recordingPlayer').hidden = true;
    $('#messageInput').value = '';
    closeDialog('#messageModal');
    renderInbox();
    $('#messageCount').textContent = `${state.messages.length} 条`;
    showToast('留言已送到家人的手机');
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      $('#messageFeedback').textContent = '当前浏览器不支持录音，请直接写字。';
      return;
    }
    const requestId = ++recordingRequestId;
    recordingCancelled = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recordingDialogOpen || recordingCancelled || requestId !== recordingRequestId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) recordingChunks.push(event.data); });
      mediaRecorder.addEventListener('stop', async () => {
        stream.getTracks().forEach(track => track.stop());
        if (!recordingDialogOpen || recordingCancelled || requestId !== recordingRequestId) {
          pendingRecording = null;
          return;
        }
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        pendingRecording = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(URL.createObjectURL(blob));
          reader.readAsDataURL(blob);
        });
        $('#recordingPlayer').src = pendingRecording;
        $('#recordingPlayer').hidden = false;
        $('#recordBtnText').textContent = '开始录音';
        $('#messageFeedback').textContent = '录音准备好了，点“送出去”保存。';
        $('#messageFeedback').classList.add('is-good');
      });
      mediaRecorder.start();
      $('#recordBtnText').textContent = '停止录音';
      $('#messageFeedback').textContent = '正在录音，想说什么都可以。';
      $('#messageFeedback').classList.remove('is-good');
    } catch (error) {
      if (!recordingDialogOpen || recordingCancelled || requestId !== recordingRequestId) return;
      $('#messageFeedback').textContent = '没有打开麦克风，可以直接写字留言。';
      $('#recordBtnText').textContent = '开始录音';
    }
  }

  function toggleRecording() {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    else startRecording();
  }

  function cancelRecordingFlow() {
    recordingDialogOpen = false;
    recordingCancelled = true;
    recordingRequestId += 1;
    if (mediaRecorder?.state === 'recording') {
      try { mediaRecorder.stop(); } catch (_) { /* recorder may already be stopping */ }
    }
    mediaRecorder = null;
    pendingRecording = null;
    $('#recordBtnText').textContent = '开始录音';
  }

  function runVoiceCommand(command) {
    const normalized = command.replace(/[，。！!？?]/g, '');
    if (normalized.includes('下一') || normalized.includes('下一个')) { movePhoto(1); return; }
    if (normalized.includes('上一') || normalized.includes('上一个')) { movePhoto(-1); return; }
    if (normalized.includes('再听') || normalized.includes('朗读')) { listenCurrent(); return; }
    const person = people.find(item => normalized.includes(item.name));
    if (normalized.includes('电话') || normalized.includes('打给') || normalized.includes('呼叫')) { openCall(person?.id || 'grandson'); return; }
    showToast(`听到了：“${command}”，可以试试下一张或给孙子打电话。`);
  }

  function finishVoiceRecognition({ showExamples = false, message = '' } = {}) {
    const recognition = activeRecognition;
    activeRecognition = null;
    if (recognitionTimer) window.clearTimeout(recognitionTimer);
    recognitionTimer = null;
    if (recognition) {
      try { recognition.abort(); } catch (_) { /* recognition may have ended */ }
    }
    $('#voiceBtn').classList.remove('is-listening');
    $('#voiceBtn').removeAttribute('aria-label');
    $('#voiceBtnText').textContent = '点一下说话';
    if (showExamples) $('#voiceExamples').hidden = false;
    if (message) showToast(message);
  }

  function voiceCommand() {
    if (activeRecognition) {
      finishVoiceRecognition({ showExamples: true, message: '已取消识别，可以点一个示例语句继续。' });
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      $('#voiceExamples').hidden = false;
      $('#voiceSupport').textContent = '此浏览器暂不支持识别，请点击示例语句继续。';
      showToast('语音识别不可用，可以点一个示例语句');
      return;
    }
    const recognition = new Recognition();
    activeRecognition = recognition;
    recognitionHadResult = false;
    recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
    $('#voiceBtn').classList.add('is-listening');
    $('#voiceBtn').setAttribute('aria-label', '取消语音识别');
    $('#voiceBtnText').textContent = '取消识别 · 正在听';
    recognition.addEventListener('result', event => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      recognitionHadResult = true;
      runVoiceCommand(transcript);
      finishVoiceRecognition();
    });
    recognition.addEventListener('nomatch', () => finishVoiceRecognition({ showExamples: true, message: '没有听清，可以点示例语句继续。' }));
    recognition.addEventListener('error', event => {
      const message = event.error === 'not-allowed' ? '没有打开麦克风，可以点示例语句继续。' : '没有听清，可以点示例语句继续。';
      finishVoiceRecognition({ showExamples: true, message });
    });
    recognition.addEventListener('end', () => {
      if (activeRecognition && !recognitionHadResult) finishVoiceRecognition({ showExamples: true, message: '没有听到内容，可以点示例语句继续。' });
      else if (activeRecognition) finishVoiceRecognition();
    });
    recognitionTimer = window.setTimeout(() => finishVoiceRecognition({ showExamples: true, message: '识别已超时，可以点示例语句继续。' }), 12000);
    try { recognition.start(); } catch (error) { finishVoiceRecognition({ showExamples: true, message: '语音识别暂时不可用，可以点示例语句继续。' }); }
  }

  function runDemo() {
    demoTimers.forEach(window.clearTimeout); demoTimers = [];
    setMode('split');
    state.currentPhoto = 0; renderPhotos();
    showToast('第 1 步 · 小宇正在发一张照片');
    demoTimers.push(window.setTimeout(() => { setMode('elder'); showToast('第 2 步 · 奶奶看到了，也听到了'); listenCurrent(); }, 1500));
    demoTimers.push(window.setTimeout(() => { openMessage('看到了，花真好看。'); showToast('第 3 步 · 奶奶准备回一句话'); }, 4000));
    demoTimers.push(window.setTimeout(() => { closeDialog('#messageModal'); showToast('第 4 步 · 留言已回到小宇的手机'); }, 7200));
    demoTimers.push(window.setTimeout(() => { setMode('family'); openCall('grandson'); $('#callStatus').textContent = '可以接听、挂断或转留言'; }, 8500));
  }

  function resetData() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    state = initialState(); selectedFile = null; pendingRecording = null;
    persist('重置演示数据');
    renderAll(); setMode('elder'); showToast('已清除这个演示的数据，示例内容回来了。');
  }

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#prevBtn').addEventListener('click', () => movePhoto(-1));
  $('#nextBtn').addEventListener('click', () => movePhoto(1));
  $('#speakBtn').addEventListener('click', () => openMessage());
  $('#listenBtn').addEventListener('click', listenCurrent);
  $('#voiceBtn').addEventListener('click', voiceCommand);
  $('#demoBtn').addEventListener('click', runDemo);
  $('#resetBtn').addEventListener('click', resetData);
  $('#photoInput').addEventListener('change', event => handleFile(event.target.files?.[0]));
  $('#uploadForm').addEventListener('submit', sendPhoto);
  $('#peopleList').addEventListener('click', event => { const button = event.target.closest('[data-call]'); if (button) openCall(button.dataset.call); });
  $('#activityList').addEventListener('click', event => { const button = event.target.closest('[data-photo-id]'); const index = state.photos.findIndex(photo => photo.id === button?.dataset.photoId); if (index >= 0) { state.currentPhoto = index; persist('选择照片'); renderPhotos(); } });
  $('#voiceExamples').addEventListener('click', event => { const button = event.target.closest('[data-command]'); if (button) runVoiceCommand(button.dataset.command); });
  $('#closeCallBtn').addEventListener('click', () => closeDialog('#callModal'));
  $('#answerCallBtn').addEventListener('click', () => callStatus('已接听 · 这是演示通话'));
  $('#hangupCallBtn').addEventListener('click', () => callStatus('已挂断 · 没有拨出真实电话'));
  $('#leaveMessageBtn').addEventListener('click', () => { closeDialog('#callModal'); openMessage('刚才没接到你的电话，给你留句话。'); });
  $('#closeMessageBtn').addEventListener('click', () => closeDialog('#messageModal'));
  $('#saveMessageBtn').addEventListener('click', saveMessage);
  $('#recordBtn').addEventListener('click', toggleRecording);
  $('#inbox').addEventListener('click', event => { const button = event.target.closest('.play-message'); const message = state.messages.find(item => item.id === button?.dataset.messageId); if (message?.audio) { const audio = new Audio(message.audio); audio.play().catch(() => showToast('录音播放失败，可以阅读文字内容。')); } });
  $('#callModal').addEventListener('click', event => { if (event.target === $('#callModal')) closeDialog('#callModal'); });
  $('#messageModal').addEventListener('click', event => { if (event.target === $('#messageModal')) closeDialog('#messageModal'); });

  const clock = () => { const now = new Date(); $('#clockText').textContent = `今天 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; };
  clock(); window.setInterval(clock, 60000);
  initSync(); renderAll(); setMode('elder');
})();
