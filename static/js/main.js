const FLASK      = 'http://localhost:5000';
const MAX_MB     = 30;
let pinIdCounter = 0;
let activeFilter = null; // 현재 활성 태그 필터

// ── DOM refs ──────────────────────────────────────────────
const uploadZone   = document.getElementById('upload-zone');
const fileInput    = document.getElementById('file-input');
const pinList      = document.getElementById('pin-list');
const emptyState   = document.getElementById('empty-state');
const popup        = document.getElementById('popup');
const toastCont    = document.getElementById('toast-container');
const pinCount     = document.getElementById('pin-count');
const filterBar    = document.getElementById('filter-bar');
const exportBtn    = document.getElementById('export-btn');

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initGlobe('globe');
  setupUpload();
  setupPopup();
  setupExport();

  window.addEventListener('pindrop:pinclick', e => {
    const { pin, clientX, clientY } = e.detail;
    showPopup(pin, clientX, clientY);
  });

  await restoreSession();
});

// ── Session restore ───────────────────────────────────────
async function restoreSession() {
  try {
    const res  = await fetch(`${FLASK}/pins`);
    const pins = await res.json();
    if (!pins.length) return;

    for (const pin of pins) {
      if (pin.id >= pinIdCounter) pinIdCounter = pin.id;
      pin.url = pin.filename ? `/uploads/${pin.filename}` : '';
      addPin(pin);
      addSidebarItem(pin, true);
    }
    updatePinCount();
    updateFilterBar();
    toast(`${pins.length}개의 핀을 불러왔습니다`, 'info', 2500);
  } catch {
    // 서버 꺼져 있으면 조용히 무시
  }
}

// ── Upload ────────────────────────────────────────────────
function setupUpload() {
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', e => {
    if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('dragover');
  });
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
}

async function handleFiles(files) {
  const arr = Array.from(files);
  for (let i = 0; i < arr.length; i++) {
    await processFile(arr[i], i + 1, arr.length);
    if (i < arr.length - 1) await sleep(1100); // Nominatim rate limit
  }
}

async function processFile(file, current, total) {
  // 파일 크기 검증
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`${file.name}: 파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). ${MAX_MB}MB 이하만 지원합니다`, 'error');
    return;
  }

  const id        = ++pinIdCounter;
  const objectUrl = URL.createObjectURL(file);
  const label     = total > 1 ? ` (${current}/${total})` : '';

  // 1. EXIF 파싱
  const exif = await extractExif(file);
  if (!exif) {
    toast(`${file.name}: GPS 정보가 없습니다${label}`, 'error');
    addSidebarItem({ id, filename: file.name, url: objectUrl, place: 'GPS 없음', date: null, tags: [], status: 'noexif' }, false);
    return;
  }

  // 2. 사이드바 로딩 항목 추가
  addSidebarItem({ id, filename: file.name, url: objectUrl, place: '지명 확인 중…', date: exif.date, tags: [], status: 'loading' }, false);

  // 3. 역지오코딩
  const place = await reverseGeocode(exif.lat, exif.lng);

  // 4. Flask에 파일 업로드
  let serverFilename = null;
  try {
    const form = new FormData();
    form.append('file', file);
    const res  = await fetch(`${FLASK}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }
    serverFilename = data.filename;
  } catch (e) {
    console.warn('업로드 실패:', e);
  }

  // 5. 지구본에 핀 추가
  const pinData = {
    id, lat: exif.lat, lng: exif.lng,
    place, date: exif.date,
    filename: serverFilename,
    url: objectUrl,
    tags: [],
  };
  addPin(pinData);
  updateSidebarItem(id, { place, status: 'loading' });
  flyTo(exif.lat, exif.lng);
  updatePinCount();
  toast(`${place}에 핀을 꽂았습니다${label}`, 'success', 2000);

  // 6. 서버에 핀 메타데이터 저장 (url 제외 — blob URL은 영속 불가)
  persistPin({ ...pinData, url: undefined });

  // 7. Vision AI 태그 (백그라운드)
  if (serverFilename) fetchTags(id, serverFilename);
  else updateSidebarItem(id, { status: 'done' });
}

// ── Vision AI 태그 ────────────────────────────────────────
async function fetchTags(pinId, filename) {
  try {
    const res  = await fetch(`${FLASK}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    const tags = data.tags ?? [];

    updatePin(pinId, { tags });
    updateSidebarItem(pinId, { tags, status: 'done' });
    updateFilterBar();

    const pin = getPinById(pinId);
    if (pin) persistPin({ ...pin, url: undefined });

    if (parseInt(popup.dataset.pinId) === pinId) updatePopupTags(tags);
  } catch (e) {
    console.warn('태그 요청 실패:', e);
    updateSidebarItem(pinId, { status: 'error' });
  }
}

// ── Persist ───────────────────────────────────────────────
async function persistPin(pin) {
  try {
    await fetch(`${FLASK}/pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pin),
    });
  } catch { /* 서버 꺼져 있으면 무시 */ }
}

async function deleteFromServer(pinId) {
  try {
    await fetch(`${FLASK}/pins/${pinId}`, { method: 'DELETE' });
  } catch { /* 무시 */ }
}

// ── Reverse geocode ───────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'Pindrop/1.0' } });
    const data = await res.json();
    const addr = data.address ?? {};
    return (
      addr.city ?? addr.town ?? addr.village ?? addr.county ??
      addr.state ?? addr.country ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`
    );
  } catch {
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
}

// ── Sidebar ───────────────────────────────────────────────
function addSidebarItem(pin, restored = false) {
  emptyState.style.display = 'none';

  const item = document.createElement('div');
  item.className = 'pin-item';
  item.dataset.id = pin.id;
  if (activeFilter && !pin.tags?.includes(activeFilter)) item.style.display = 'none';

  item.innerHTML = `
    <img class="thumb" src="${pin.url || ''}" alt="">
    <div class="info">
      <div class="place">${escapeHtml(pin.place)}</div>
      <div class="date">${pin.date ?? '날짜 없음'}</div>
      <div class="tags-row">${(pin.tags ?? []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>
    <div class="item-right">
      <span class="status ${statusClass(restored ? 'done' : pin.status)}">${statusLabel(restored ? 'done' : pin.status)}</span>
      <button class="delete-btn" title="핀 삭제">✕</button>
    </div>
  `;

  item.querySelector('.delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    removePin(pin.id);
  });

  item.addEventListener('click', () => {
    const p = getPinById(pin.id);
    if (p?.lat != null) { flyTo(p.lat, p.lng); showPopup(p); }
    document.querySelectorAll('.pin-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
  });

  pinList.prepend(item);
}

function updateSidebarItem(id, updates) {
  const item = pinList.querySelector(`[data-id="${id}"]`);
  if (!item) return;
  if (updates.place !== undefined) item.querySelector('.place').textContent = updates.place;
  if (updates.tags !== undefined) {
    item.querySelector('.tags-row').innerHTML =
      updates.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    // 필터 적용
    if (activeFilter) item.style.display = updates.tags.includes(activeFilter) ? '' : 'none';
  }
  if (updates.status) {
    const s = item.querySelector('.status');
    s.className = `status ${statusClass(updates.status)}`;
    s.textContent = statusLabel(updates.status);
  }
}

function removeSidebarItem(id) {
  pinList.querySelector(`[data-id="${id}"]`)?.remove();
  if (!pinList.querySelector('.pin-item')) emptyState.style.display = '';
}

function removePin(id) {
  // globe에서 제거
  const pins = getAllPins().filter(p => p.id !== id);
  // globe.js의 pins 배열을 직접 교체
  replaceAllPins(pins);
  removeSidebarItem(id);
  deleteFromServer(id);
  updatePinCount();
  updateFilterBar();
  if (parseInt(popup.dataset.pinId) === id) hidePopup();
  toast('핀을 삭제했습니다', 'info', 1800);
}

function updatePinCount() {
  const n = getAllPins().length;
  if (pinCount) pinCount.textContent = n > 0 ? `${n}개의 핀` : '';
}

function statusClass(s) {
  return { loading: 'status-loading', done: 'status-done', error: 'status-error', noexif: 'status-noexif' }[s] ?? '';
}
function statusLabel(s) {
  return { loading: '분석 중', done: '완료', error: '오류', noexif: 'GPS 없음' }[s] ?? '';
}

// ── Tag filter ────────────────────────────────────────────
function updateFilterBar() {
  const allTags = [...new Set(getAllPins().flatMap(p => p.tags ?? []))];
  filterBar.innerHTML = '';
  const section = document.getElementById('filter-section');
  if (!allTags.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  filterBar.style.display = 'flex';

  const all = document.createElement('button');
  all.className = 'filter-chip' + (!activeFilter ? ' active' : '');
  all.textContent = '전체';
  all.addEventListener('click', () => setFilter(null));
  filterBar.appendChild(all);

  for (const tag of allTags) {
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (activeFilter === tag ? ' active' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => setFilter(tag));
    filterBar.appendChild(btn);
  }
}

function setFilter(tag) {
  activeFilter = tag;
  // 사이드바 항목 필터
  pinList.querySelectorAll('.pin-item').forEach(item => {
    const id   = parseInt(item.dataset.id);
    const pin  = getPinById(id);
    const show = !tag || pin?.tags?.includes(tag);
    item.style.display = show ? '' : 'none';
  });
  updateFilterBar();
}

// ── Export ────────────────────────────────────────────────
function setupExport() {
  exportBtn.addEventListener('click', () => {
    const data = getAllPins().map(({ id, lat, lng, place, date, filename, tags }) =>
      ({ id, lat, lng, place, date, filename, tags })
    );
    if (!data.length) { toast('내보낼 핀이 없습니다', 'error'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `pindrop-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`${data.length}개의 핀을 내보냈습니다`, 'success');
  });
}

// ── Popup ─────────────────────────────────────────────────
function setupPopup() {
  document.getElementById('popup-close').addEventListener('click', hidePopup);
  document.getElementById('popup-delete').addEventListener('click', () => {
    const id = parseInt(popup.dataset.pinId);
    if (id) removePin(id);
  });
  document.getElementById('globe').addEventListener('click', e => {
    if (e.target.tagName === 'CANVAS') hidePopup();
  });
}

function showPopup(pin, clientX, clientY) {
  popup.dataset.pinId = pin.id;
  popup.querySelector('.popup-img').src = pin.url || '';
  popup.querySelector('.place-name').textContent = pin.place ?? '알 수 없는 위치';
  popup.querySelector('.coords').textContent = `${pin.lat.toFixed(4)}°, ${pin.lng.toFixed(4)}°`;
  popup.querySelector('.popup-date').textContent = pin.date ?? '날짜 정보 없음';
  updatePopupTags(pin.tags);
  positionPopup(clientX, clientY);
  popup.classList.add('visible');
}

function positionPopup(clientX, clientY) {
  const rect    = document.querySelector('.globe-container').getBoundingClientRect();
  const W = 240, H = 340, M = 12;

  if (clientX == null || clientY == null) {
    popup.style.top  = `${M}px`;
    popup.style.left = `${rect.width - W - M}px`;
    return;
  }

  let x = clientX - rect.left + 16;
  let y = clientY - rect.top - H / 2;
  if (x + W > rect.width  - M) x = clientX - rect.left - W - 16;
  y = Math.max(M, Math.min(y, rect.height - H - M));
  popup.style.left = `${x}px`;
  popup.style.top  = `${y}px`;
}

function updatePopupTags(tags) {
  const el = popup.querySelector('.popup-tags');
  if (!tags?.length) {
    el.innerHTML = '<span class="loading-tags">태그 분석 중…</span>';
  } else {
    el.innerHTML = tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  }
}

function hidePopup() {
  popup.classList.remove('visible');
  popup.dataset.pinId = '';
  document.querySelectorAll('.pin-item').forEach(el => el.classList.remove('active'));
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  el.addEventListener('click', () => el.remove());
  toastCont.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Util ──────────────────────────────────────────────────
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function escapeHtml(s)  {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
