const $ = (selector, root = document) => root.querySelector(selector);
const enc = value => encodeURIComponent(String(value));
const id = () => crypto.randomUUID();

const state = {
  epoch: 0, controller: null, account: null, spaces: [], space: null,
  photos: [], stories: [], selected: 0, mode: 'elder', poll: null,
  uploadContext: null, recording: null, pendingAudio: null,
  auth: { username: '', password: '' }
};

function beginEpoch() {
  state.epoch += 1;
  state.controller?.abort();
  clearInterval(state.poll);
  state.poll = null;
  state.controller = new AbortController();
  return state.epoch;
}

function assertLive(epoch) {
  if (epoch !== state.epoch || state.controller?.signal.aborted) throw new DOMException('页面已变化', 'AbortError');
}

function apiError(code, status, data) { return Object.assign(new Error(code), { code, status, data }); }

async function request(path, { method = 'GET', body, idempotencyKey, version, headers = {}, account = true, epoch = state.epoch, signal } = {}) {
  if (!/^\/v1\//.test(path) || path.includes('..') || path.includes('://')) throw apiError('canonical_path_invalid', 400);
  assertLive(epoch);
  const requestSignal = signal ? AbortSignal.any([state.controller.signal, signal]) : state.controller.signal;
  const mutation = method !== 'GET';
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (mutation) {
    requestHeaders['Content-Type'] = 'application/json';
    requestHeaders['Idempotency-Key'] = idempotencyKey || id();
  }
  if (version !== undefined) requestHeaders['If-Match'] = String(version);
  if (account && state.account?.id) requestHeaders['X-Unseen-Expected-Account-Id'] = state.account.id;
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal: requestSignal, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assertLive(epoch);
  const data = await response.json().catch(() => null);
  assertLive(epoch);
  if (!response.ok) throw apiError(data?.error?.code || data?.error || data?.code || 'network_error', response.status, data);
  const responseAccount = data?.accountId || data?.user?.id;
  if (account && state.account?.id && responseAccount && responseAccount !== state.account.id) throw apiError('account_changed', 409);
  return data;
}

function messageFor(error) {
  return ({
    authentication_failed: '用户名或密码不正确，请检查后重试。', invalid_credentials: '用户名或密码不正确，请重新输入。',
    session_unavailable: '登录已失效，请重新登录。',
    account_changed: '账号已变化，已关闭当前家庭内容。', resource_unavailable: '这个家庭空间暂时无法打开。',
    upload_unavailable: '当前账号没有上传权限，或照片收集已经暂停。', upload_photo_policy: '照片格式或大小不符合空间要求。',
    upload_original_file_required: '请重新选择原照片。', upload_original_file_mismatch: '原照片已变化，请重新选择同一张文件。',
    upload_items_not_finished: '照片还没有完整上传，请更新状态后重试。', receipt_unavailable: '上传回执暂时无法读取。',
    story_target_unavailable: '这张照片暂时不能留言，请刷新后重试。', version_conflict: '空间刚刚更新，请刷新后重试。'
  })[error?.code] || '暂时没有完成，请检查连接后重试。';
}

function setStatus(selector, text) { const node = $(selector); if (node) node.textContent = text || ''; }
function show(view) { ['authView', 'spaceView', 'frameView'].forEach(idName => { const node = document.getElementById(idName); if (node) node.hidden = idName !== view; }); }
function accountLabel() { return state.account?.displayName || state.account?.username || state.account?.emailMask || '已登录'; }
function validSpace(space) { return space && /^[A-Za-z0-9_-]{1,160}$/.test(String(space.spaceId || space.id || '')) && space.spaceLifecycle !== 'archived'; }
function spaceId() { return state.space?.spaceId || state.space?.id || ''; }
function canUpload() { return (state.space?.tasks || []).includes('upload') || state.space?.effectiveCanUpload === true; }
function canView() { return (state.space?.tasks || []).includes('view') || state.space?.effectiveCanView === true || state.space?.owner === true; }
function canReply() { return canUpload() && state.space?.collectionState === 'open'; }
function recentSpaceKey() { return `unseen-frame-family-recent:${state.account?.id || 'account'}`; }
function readRecentSpace() { try { const value = JSON.parse(localStorage.getItem(recentSpaceKey()) || 'null'); return value && /^[A-Za-z0-9_-]{1,160}$/.test(String(value.spaceId || '')) ? { spaceId: String(value.spaceId), mode: value.mode === 'family' ? 'family' : 'elder' } : null; } catch { return null; } }
function writeRecentSpace(sid, mode = state.mode) { try { localStorage.setItem(recentSpaceKey(), JSON.stringify({ spaceId: String(sid), mode: mode === 'family' ? 'family' : 'elder' })); } catch {} }
function clearRecentSpace() { try { localStorage.removeItem(recentSpaceKey()); } catch {} }

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

async function login(event) {
  event.preventDefault();
  const form = event.target;
  const button = $('#loginBtn');
  const username = String(new FormData(form).get('username') || '').trim();
  const password = String(new FormData(form).get('password') || '');
  if (!username || !password || button.disabled) return;
  const epoch = beginEpoch();
  button.disabled = true;
  state.auth = { username, password: '' };
  setStatus('#loginStatus', '正在登录家庭空间…');
  try {
    const result = await request('/v1/auth/password-login', {
      method: 'POST', account: false, epoch,
      body: { username, password }
    });
    if (!result?.accountId && !result?.user?.id) throw apiError('session_unavailable', 401);
    await establishSession(epoch, result.user);
  } catch (error) {
    if (error.name !== 'AbortError') setStatus('#loginStatus', messageFor(error));
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function establishSession(epoch, loggedInUser = null) {
  assertLive(epoch);
  const profile = await request('/v1/profile', { account: false, epoch });
  const user = profile?.user || loggedInUser;
  if (!user?.id) throw apiError('session_unavailable', 401);
  state.account = user;
  state.controller?.abort();
  state.controller = new AbortController();
  state.epoch += 1;
  epoch = state.epoch;
  $('#accountBar').hidden = false;
  $('#accountName').textContent = accountLabel();
  $('#loginForm').reset();
  setStatus('#loginStatus', '');
  await loadSpaces(epoch);
}

async function loadSpaces(epoch = state.epoch, { autoSelect = true } = {}) {
  const result = await request('/v1/me/spaces', { epoch });
  state.spaces = (result.spaces || []).filter(validSpace).filter(space => canSpaceView(space));
  state.space = null;
  const recent = autoSelect ? readRecentSpace() : null;
  if (recent && state.spaces.some(space => String(space.spaceId || space.id) === recent.spaceId)) {
    await selectSpace(recent.spaceId, { remember: false, mode: recent.mode });
    return;
  }
  if (recent) clearRecentSpace();
  renderSpaces();
}

function canSpaceView(space) { const tasks = space.tasks || []; return Boolean(space.owner || space.effectiveCanView || space.effectiveCanUpload || tasks.includes('view') || tasks.includes('upload')); }

function renderSpaces() {
  show('spaceView'); const list = $('#spaceList');
  list.innerHTML = state.spaces.length ? state.spaces.map(space => { const sid = space.spaceId || space.id; const permission = (space.tasks || []).includes('upload') || space.effectiveCanUpload ? '可以上传照片和留言' : '可以查看照片与留言'; return `<button class="space-choice" type="button" data-space-id="${escapeAttribute(sid)}"><span><strong>${escapeHtml(space.name || '回忆空间')}</strong><small>${permission} · ${space.sharingState === 'private' ? '私有' : '按授权分享'}</small></span><b aria-hidden="true">→</b></button>`; }).join('') : '<div class="empty-copy"><p>当前账号还没有可查看的家庭空间。</p><p>请先在 UNSEEN 创建私有空间，或让空间主人把这个账号加入家庭成员。</p><a class="quiet-action" href="https://unseen.maxxam.xyz/app-v2#spaces" target="_blank" rel="noopener">打开 UNSEEN 空间</a></div>';
  list.querySelectorAll('[data-space-id]').forEach(button => button.addEventListener('click', () => selectSpace(button.dataset.spaceId)));
}

function clearFrameDom() {
  $('#spaceName').textContent = '家庭空间'; $('#accountHint').textContent = ''; $('#photoTitle').textContent = '还没有照片'; $('#photoCredit').textContent = '';
  $('#photoPosition').textContent = '0 / 0'; $('#storyCount').textContent = '0 条'; $('#statusCopy').textContent = '空间里还没有照片'; $('#frameStatus').textContent = '';
  $('#uploadPermission').textContent = ''; $('#realPhoto').hidden = true; $('#realPhoto').removeAttribute('src'); $('#realPhoto').alt = '';
  $('#statusRing').className = 'status-ring'; $('#frameView').dataset.status = 'quiet'; $('#storyList').innerHTML = '<p class="empty-copy">还没有留言。</p>';
  $('#uploadStatus').textContent = ''; $('#storyStatus').textContent = ''; $('#recordStatus').textContent = '也可以只写文字'; $('#familyPanel').hidden = true;
}

function resetPrivateView({ showSpaces = true } = {}) {
  clearRecentSpace();
  beginEpoch();
  stopRecording();
  globalThis.speechSynthesis?.cancel?.();
  state.space = null; state.photos = []; state.stories = []; state.selected = 0; state.uploadContext = null; state.pendingAudio = null;
  $('#uploadForm')?.reset(); $('#storyForm')?.reset(); clearFrameDom(); setMode('elder');
  if (showSpaces) renderSpaces();
}

async function selectSpace(sid, { remember = true, mode = state.mode } = {}) {
  const selected = state.spaces.find(space => String(space.spaceId || space.id) === String(sid)); if (!selected) return;
  beginEpoch();
  clearFrameDom();
  state.space = selected; state.photos = []; state.stories = []; state.selected = 0; state.uploadContext = null; state.pendingAudio = null;
  setMode(mode === 'family' ? 'family' : 'elder');
  if (remember) writeRecentSpace(sid, state.mode);
  const epoch = state.epoch; show('frameView'); setStatus('#frameStatus', '正在打开照片…');
  try { await loadFrame(epoch); state.poll = setInterval(() => { if (!document.hidden && state.space && state.epoch === epoch) loadFrame(epoch, { quiet: true }).catch(handleError); }, 25000); } catch (error) { handleError(error); }
}

function mediaUrl(photo) {
  const value = photo?.photoMedia?.url || photo?.assetUrl || `/v1/viewer/spaces/${enc(spaceId())}/photos/${enc(photo?.id || photo?.photoId || '')}/album-media`;
  if (typeof value !== 'string' || !value.startsWith('/v1/viewer/spaces/') || value.includes('..')) return '';
  const url = new URL(value, location.origin); url.searchParams.set('access', 'account'); return url.pathname + url.search;
}
function storyMediaUrl(value) { if (typeof value !== 'string' || !value.startsWith('/v1/')) return ''; const url = new URL(value, location.origin); url.searchParams.set('access', 'account'); return url.pathname + url.search; }
function uploadTicketUrl(value, exact) { const url = new URL(value, location.origin); if ( /^\/__(?:local\/media|local-operable\/private-media)\//.test(url.pathname)) { url.protocol = location.protocol; url.host = location.host; } if (!decodeURIComponent(url.pathname).endsWith('/' + exact)) throw apiError('upload_ticket_invalid', 502); return url; }
function currentPhoto() { return state.photos[state.selected] || null; }
function storiesFor(photoId) { return state.stories.filter(story => story.photoId === photoId && !['withdrawn', 'hidden'].includes(story.visibility)); }
function seenKey() { return `unseen-frame-family-seen:${state.account?.id || 'account'}:${spaceId()}`; }
function readSeen() { try { const value = JSON.parse(sessionStorage.getItem(seenKey()) || '{}'); return { photos: new Set(value.photos || []), stories: new Set(value.stories || []) }; } catch { return { photos: new Set(), stories: new Set() }; } }
function writeSeen(seen) { try { sessionStorage.setItem(seenKey(), JSON.stringify({ photos: [...seen.photos].slice(-200), stories: [...seen.stories].slice(-300) })); } catch {} }
function markSeen(photo, includeStories = false) { const seen = readSeen(), pid = photo?.id || photo?.photoId; if (pid) seen.photos.add(pid); if (includeStories) storiesFor(pid).forEach(story => story.storyId && seen.stories.add(story.storyId)); writeSeen(seen); }
function currentStatus() { const seen = readSeen(); if (state.stories.some(story => story.storyId && !seen.stories.has(story.storyId))) return 'blue'; if (state.photos.some(photo => photo.id && !seen.photos.has(photo.id))) return 'yellow'; return 'quiet'; }

async function loadFrame(epoch = state.epoch, { quiet = false } = {}) {
  if (!state.space) return; const sid = spaceId(); const previousId = currentPhoto()?.id; const viewer = await request(`/v1/viewer/spaces/${enc(sid)}`, { epoch }); const storyResult = await request(`/v1/viewer/spaces/${enc(sid)}/stories`, { epoch });
  const photos = Array.isArray(viewer.photos) ? viewer.photos.filter(photo => photo.id || photo.photoId).map(photo => ({ ...photo, id: photo.id || photo.photoId })) : [];
  state.photos = photos; state.stories = Array.isArray(storyResult.stories) ? storyResult.stories : []; const next = photos.findIndex(photo => photo.id === previousId); state.selected = next >= 0 ? next : Math.min(state.selected, Math.max(0, photos.length - 1));
  if (!quiet || !editing()) renderFrame(); else updateReminder();
}
function editing() { const active = document.activeElement?.closest('#uploadForm,#storyForm'); const file = $('#uploadForm input[type="file"]'); return Boolean(active || file?.files?.length); }

function renderFrame() {
  const photo = currentPhoto(), stories = storiesFor(photo?.id), status = currentStatus(); const card = $('#frameView'); card.dataset.status = status; $('#spaceName').textContent = state.space?.name || '家庭空间'; $('#accountHint').textContent = `${accountLabel()} · ${canReply() ? '可以上传和留言' : '当前为只读查看'}`; $('#statusRing').className = `status-ring${status === 'quiet' ? '' : ` is-${status}`}`; $('#statusCopy').textContent = status === 'blue' ? '有新留言' : status === 'yellow' ? '有新照片' : photo ? '可以给这张照片留言' : '空间里还没有照片'; $('#photoPosition').textContent = `${photosPosition()} / ${state.photos.length}`; $('#realPhoto').hidden = !photo; $('#realPhoto').src = photo ? mediaUrl(photo) : ''; $('#realPhoto').alt = photo ? (photo.title || photo.caption || '家庭照片') : ''; $('#photoTitle').textContent = photo ? (photo.title || photo.caption || '这一刻') : '还没有照片'; $('#photoCredit').textContent = photo ? (photo.uploader ? `${typeof photo.uploader === 'string' ? photo.uploader : photo.uploader.displayName || photo.uploader.name || '家人'}留下的照片` : '空间里的照片') : '家人可以从手机上传第一张照片。'; $('#storyCount').textContent = `${stories.length} 条`; $('#replyBtn').textContent = canReply() ? '留言' : '查看留言'; $('#replyBtn').disabled = !photo; $('#previousBtn').disabled = state.photos.length < 2; $('#nextBtn').disabled = state.photos.length < 2; $('#uploadPermission').textContent = canUpload() ? '可上传' : '当前账号只读'; renderStories(photo); if (!photo) setStatus('#frameStatus', canUpload() ? '可以从家属手机上传第一张照片。' : '请让空间主人开启照片收集。'); }
function photosPosition() { return state.photos.length ? state.selected + 1 : 0; }
function updateReminder() { const status = currentStatus(); $('#frameView').dataset.status = status; $('#statusRing').className = `status-ring${status === 'quiet' ? '' : ` is-${status}`}`; $('#statusCopy').textContent = status === 'blue' ? '有新留言' : status === 'yellow' ? '有新照片' : currentPhoto() ? '可以给这张照片留言' : '空间里还没有照片'; }
function renderStories(photo) { const list = $('#storyList'); const stories = storiesFor(photo?.id); list.innerHTML = stories.length ? stories.slice(-5).map(story => `<article class="story"><strong>${escapeHtml(story.authorCredit || '家人')}</strong>${(story.pieces || []).map(piece => `${piece.text ? `<p>${escapeHtml(piece.text)}</p>` : ''}${piece.audio && storyMediaUrl(piece.audio.url) ? `<small>原声${piece.audio.duration ? ` · ${Math.ceil(piece.audio.duration)} 秒` : ''}</small><audio controls preload="none" src="${escapeAttribute(storyMediaUrl(piece.audio.url))}"></audio>` : ''}`).join('')}</article>`).join('') : '<p class="empty-copy">还没有留言。家人可以从手机给这张照片留一句话。</p>'; }

function selectPhoto(delta) { if (!state.photos.length) return; state.selected = (state.selected + delta + state.photos.length) % state.photos.length; markSeen(currentPhoto()); renderFrame(); }
function replyCurrent() { const photo = currentPhoto(); if (!photo) return; markSeen(photo, true); renderFrame(); $('#familyPanel').hidden = false; setMode('family'); $('#storyForm textarea')?.focus(); }
function readCurrent() { const photo = currentPhoto(); if (!photo || !('speechSynthesis' in window)) { setStatus('#frameStatus', '这台设备暂时不支持朗读。'); return; } const text = [photo.title, photo.caption, ...storiesFor(photo.id).flatMap(story => (story.pieces || []).map(piece => piece.text).filter(Boolean))].filter(Boolean).join('。'); speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text || '这张照片还没有文字。'); utterance.lang = 'zh-CN'; utterance.onstart = () => setStatus('#frameStatus', '正在用这台设备朗读'); utterance.onend = () => { markSeen(photo, true); updateReminder(); setStatus('#frameStatus', '朗读结束'); }; speechSynthesis.speak(utterance); }

async function digest(value) { const bytes = value instanceof Blob ? await value.arrayBuffer() : new TextEncoder().encode(value); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function stableJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; }
async function batchDigest(items) { return digest(stableJson(items.map(entry => ({ itemId: entry.itemId || entry.id, status: entry.status, version: entry.itemVersion ?? entry.version, failureCode: entry.failureCode ?? null })))); }
async function uploadPhoto(file, caption, epoch) {
  const sid = spaceId(); const context = state.uploadContext || await request(`/v1/spaces/${enc(sid)}/upload-context`, { epoch }); state.uploadContext = context; const sha256 = await digest(file), clientBatchId = id(), consentKey = id();
  const consent = await request('/v1/consent-events', { method: 'POST', body: { purpose: 'photo_upload', noticeVersion: context.mediaNotice.version, noticeHash: context.mediaNotice.hash }, idempotencyKey: consentKey, epoch });
  const batch = await request(`/v1/spaces/${enc(sid)}/contribution-batches`, { method: 'POST', body: { clientBatchId, consentEventId: consent.consentEventId, declaredItemCount: 1 }, idempotencyKey: id(), epoch });
  const batchId = batch.batchId, resultPath = `/v1/contribution-batches/${enc(batchId)}/result`; let result = await request(resultPath, { epoch });
  const itemKey = id(), clientItemId = id(); const item = await request(`/v1/contribution-batches/${enc(batchId)}/items`, { method: 'POST', body: { clientItemId, declaredMime: file.type, declaredBytes: file.size, fileNameHash: await digest(file.name) }, version: result.version ?? result.ifMatch, headers: { 'X-Space-Version': String(context.spaceVersion ?? context.version ?? '') }, idempotencyKey: itemKey, epoch });
  result = await request(resultPath, { epoch }); const row = result.items?.find(entry => (entry.itemId || entry.id) === item.itemId) || item; const uploadKey = id(), clientUploadId = id();
  const auth = await request(`/v1/contribution-batches/${enc(batchId)}/items/${enc(item.itemId)}/upload-sessions`, { method: 'POST', body: { declaredMime: file.type, declaredBytes: file.size, clientUploadId }, version: row.itemVersion ?? row.version, idempotencyKey: uploadKey, epoch });
  const ticket = auth.oneTimeUploadTicket || auth.exactPrivateUploadTicketOnce, exact = auth.exactPrivateObjectKey || ticket?.exactPrivateObjectKey; if (!ticket?.url || !exact) throw apiError('upload_ticket_invalid', 502);
  const uploadUrl = uploadTicketUrl(ticket.url, exact);
  const put = await fetch(uploadUrl.href, { method: 'PUT', headers: ticket.headers, body: file, credentials: 'omit', signal: state.controller.signal }); if (!put.ok) throw apiError('upload_object_failed', put.status);
  const putResult = await put.json().catch(() => null); const commitVersion = putResult?.uploadSessionVersion ? `upload:${putResult.uploadSessionVersion};item:${auth.itemVersion ?? row.itemVersion ?? row.version}` : (auth.commitIfMatch || auth.ifMatch);
  const commitKey = id(); await request(`/v1/upload-sessions/${enc(auth.uploadSessionId)}/commits`, { method: 'POST', body: { clientCommitId: id() }, version: commitVersion, idempotencyKey: commitKey, epoch }); result = await request(resultPath, { epoch });
  const itemDigest = result.itemsDigest || await batchDigest(result.items || []); const finalization = await request(`/v1/contribution-batches/${enc(batchId)}/finalizations`, { method: 'POST', body: { itemsDigest: itemDigest, clientRequestId: id() }, version: result.version ?? result.ifMatch, idempotencyKey: id(), epoch });
  if (!finalization.receiptSessionReady) { const secret = finalization.oneTimeSecret || new URL(finalization.receiptBootstrapUrlOnce || '/', location.origin).hash.match(/^#receipt=([A-Za-z0-9_-]+)$/)?.[1]; if (!secret) throw apiError('receipt_recovery_required', 502); await request('/v1/batch-receipt-exchanges', { method: 'POST', body: { receiptSecretFromClearedBootstrap: secret, clientNonce: id() }, idempotencyKey: id(), epoch }); }
  const receipt = await request('/v1/batch-receipt', { epoch }); if (receipt.batchId && receipt.batchId !== batchId) throw apiError('receipt_unavailable', 502); const receiptItem = receipt.items?.find(entry => entry.photoId) || receipt.contributions?.find(entry => entry.photoId); const photoId = receipt.photoIds?.[0] || receiptItem?.photoId; if (!photoId) throw apiError('receipt_unavailable', 502); if (caption.trim()) await saveStory(photoId, { text: caption.trim(), authorCredit: accountLabel() }, epoch); return photoId;
}

async function saveStory(photoId, { text = '', authorCredit = '', audio }, epoch = state.epoch) { if (!text.trim() && !audio) return; const sid = spaceId(); const encodedAudio = audio ? { mimeType: audio.type || 'audio/webm', dataBase64: (await toDataUrl(audio)).split(',')[1], duration: audio.duration || 0 } : undefined; const body = { text: text.trim(), authorCredit: authorCredit.trim(), consent: true, ...(encodedAudio ? { audio: encodedAudio } : {}) }; await request(`/v1/spaces/${enc(sid)}/photos/${enc(photoId)}/notes`, { method: 'POST', body, idempotencyKey: id(), epoch }); }
function toDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); }

async function submitUpload(event) { event.preventDefault(); const form = event.target, file = form.elements.photos.files[0], button = $('#uploadBtn'), epoch = state.epoch; if (!file || button.disabled) return; button.disabled = true; setStatus('#uploadStatus', '正在上传照片并核对回执…'); try { const photoId = await uploadPhoto(file, form.elements.caption.value, epoch); form.reset(); setStatus('#uploadStatus', '照片已保存到空间。'); await loadFrame(epoch); const index = state.photos.findIndex(photo => photo.id === photoId); if (index >= 0) state.selected = index; renderFrame(); } catch (error) { if (error.name !== 'AbortError') setStatus('#uploadStatus', messageFor(error)); } finally { if (button.isConnected) button.disabled = false; } }
async function submitStory(event) { event.preventDefault(); const form = event.target, button = $('#storyBtn'), photo = currentPhoto(), epoch = state.epoch; if (!photo || button.disabled || (!form.elements.text.value.trim() && !state.pendingAudio)) return; button.disabled = true; setStatus('#storyStatus', '正在保存这句留言…'); try { await saveStory(photo.id, { text: form.elements.text.value, authorCredit: form.elements.authorCredit.value, audio: state.pendingAudio }, epoch); state.pendingAudio = null; form.reset(); setStatus('#storyStatus', '留言已保存，另一台设备刷新后可看到。'); await loadFrame(epoch); } catch (error) { if (error.name !== 'AbortError') setStatus('#storyStatus', messageFor(error)); } finally { if (button.isConnected) button.disabled = false; } }

function stopRecording() { const entry = state.recording; if (!entry) return; state.recording = null; try { if (entry.recorder.state !== 'inactive') entry.recorder.stop(); } catch {} entry.stream?.getTracks().forEach(track => track.stop()); }
async function toggleRecording() { const button = $('#recordBtn'); if (state.recording) { stopRecording(); return; } if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setStatus('#recordStatus', '当前浏览器不支持录音，请直接写字。'); return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = [], recorder = new MediaRecorder(stream), recordEpoch = state.epoch, recordSpace = spaceId(); state.recording = { recorder, stream, epoch: recordEpoch, spaceId: recordSpace }; recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); }); recorder.addEventListener('stop', () => { if (state.epoch !== recordEpoch || spaceId() !== recordSpace || state.recording) return; state.pendingAudio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); setStatus('#recordStatus', '原声已准备好，提交后会留在这张照片上。'); button.textContent = '重新录音'; }); recorder.start(); button.textContent = '结束录音'; setStatus('#recordStatus', '正在录音…'); } catch { setStatus('#recordStatus', '没有打开麦克风，可以直接写字留言。'); } }

function setMode(mode) { state.mode = mode === 'family' ? 'family' : 'elder'; document.querySelectorAll('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', active); }); $('#elderPanel').hidden = state.mode !== 'elder'; $('#familyPanel').hidden = state.mode !== 'family'; if (state.account && state.space) writeRecentSpace(spaceId(), state.mode); }
function handleError(error) { if (error?.name === 'AbortError') return; if (['session_unavailable', 'account_changed'].includes(error?.code)) { clearSession(); setStatus('#loginStatus', messageFor(error)); return; } setStatus('#frameStatus', messageFor(error)); }
function clearSession() { beginEpoch(); stopRecording(); globalThis.speechSynthesis?.cancel?.(); state.account = null; state.spaces = []; state.space = null; state.photos = []; state.stories = []; state.selected = 0; state.uploadContext = null; state.pendingAudio = null; state.auth = { username: '', password: '' }; $('#accountBar').hidden = true; $('#loginForm')?.reset(); $('#storyForm')?.reset(); $('#uploadForm')?.reset(); clearFrameDom(); setMode('elder'); show('authView'); }
async function logout() { const epoch = state.epoch; let failed = false; try { await request('/v1/auth/logout', { method: 'POST', body: {}, epoch }); } catch { failed = true; } clearSession(); if (failed) setStatus('#loginStatus', '本机已清除当前家庭内容，但服务器退出未确认，请稍后重试。'); }

async function restoreSession() { const epoch = state.epoch; try { const profile = await request('/v1/profile', { account: false, epoch }); if (!profile?.user?.id) return; state.account = profile.user; $('#accountBar').hidden = false; $('#accountName').textContent = accountLabel(); await loadSpaces(epoch); } catch (error) { if (error.name !== 'AbortError') setStatus('#loginStatus', ''); } }

$('#loginForm').addEventListener('submit', login); $('#logoutBtn').addEventListener('click', logout); $('#changeSpaceBtn').addEventListener('click', () => resetPrivateView()); $('#backToSpacesBtn').addEventListener('click', () => resetPrivateView()); $('#refreshBtn').addEventListener('click', () => loadFrame(state.epoch).catch(handleError)); document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode))); $('#previousBtn').addEventListener('click', () => selectPhoto(-1)); $('#nextBtn').addEventListener('click', () => selectPhoto(1)); $('#replyBtn').addEventListener('click', replyCurrent); $('#readBtn').addEventListener('click', readCurrent); $('#uploadForm').addEventListener('submit', submitUpload); $('#storyForm').addEventListener('submit', submitStory); $('#recordBtn').addEventListener('click', toggleRecording);
beginEpoch();
show('authView');
restoreSession();
