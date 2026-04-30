const FLASK      = 'http://localhost:5000';
const MAX_MB     = 30;
let pinIdCounter = 0;
let activeFilter = null;

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
const arcBtn       = document.getElementById('arc-btn');
const fitBtn       = document.getElementById('fit-btn');
const tourBtn      = document.getElementById('tour-btn');
const tourOverlay  = document.getElementById('tour-overlay');
const lightbox     = document.getElementById('lightbox');
const lightboxImg  = document.getElementById('lightbox-img');

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initGlobe('globe');
  setupUpload();
  setupPopup();
  setupLightbox();
  setupToolbar();
  setupExport();
  setupTour();

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
    updateStats();
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
    if (i < arr.length - 1) await sleep(1100);
  }
}

async function processFile(file, current, total) {
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`${file.name}: 파일이 너무 큽니다 (${(file.size/1024/1024).toFixed(1)}MB). ${MAX_MB}MB 이하만 지원합니다`, 'error');
    return;
  }

  const id        = ++pinIdCounter;
  const objectUrl = URL.createObjectURL(file);
  const label     = total > 1 ? ` (${current}/${total})` : '';

  const exif = await extractExif(file);
  if (!exif) {
    toast(`${file.name}: GPS 정보가 없습니다${label}`, 'error');
    addSidebarItem({ id, filename: file.name, url: objectUrl, place: 'GPS 없음', date: null, tags: [], status: 'noexif' }, false);
    return;
  }

  addSidebarItem({ id, filename: file.name, url: objectUrl, place: '지명 확인 중…', date: exif.date, tags: [], status: 'loading' }, false);

  const place = await reverseGeocode(exif.lat, exif.lng);

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

  const pinData = { id, lat: exif.lat, lng: exif.lng, place, date: exif.date, filename: serverFilename, url: objectUrl, tags: [] };
  addPin(pinData);
  updateSidebarItem(id, { place, status: 'loading' });
  flyTo(exif.lat, exif.lng);
  updatePinCount();
  updateStats();
  toast(`${place}에 핀을 꽂았습니다${label}`, 'success', 2000);

  persistPin({ ...pinData, url: undefined });

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
    updateStats();

    const pin = getPinById(pinId);
    if (pin) persistPin({ ...pin, url: undefined });
    if (parseInt(popup.dataset.pinId) === pinId) updatePopupTags(tags);
  } catch {
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
  } catch { }
}

async function deleteFromServer(pinId) {
  try { await fetch(`${FLASK}/pins/${pinId}`, { method: 'DELETE' }); } catch { }
}

// ── Reverse geocode ───────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'Pindrop/1.0' } });
    const data = await res.json();
    const addr = data.address ?? {};
    return addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.state ?? addr.country ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
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
    <img class="thumb" src="${escapeHtml(pin.url || '')}" alt="">
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

  item.querySelector('.delete-btn').addEventListener('click', e => { e.stopPropagation(); removePin(pin.id); });
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
    item.querySelector('.tags-row').innerHTML = updates.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
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
  replaceAllPins(getAllPins().filter(p => p.id !== id));
  removeSidebarItem(id);
  deleteFromServer(id);
  updatePinCount();
  updateFilterBar();
  updateStats();
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
  pinList.querySelectorAll('.pin-item').forEach(item => {
    const pin  = getPinById(parseInt(item.dataset.id));
    item.style.display = (!tag || pin?.tags?.includes(tag)) ? '' : 'none';
  });
  updateFilterBar();
}

// ── Stats ─────────────────────────────────────────────────
function updateStats() {
  const all     = getAllPins();
  const total   = all.length;
  const places  = new Set(all.map(p => p.place).filter(Boolean)).size;
  const tagMap  = {};
  all.forEach(p => (p.tags ?? []).forEach(t => { tagMap[t] = (tagMap[t] ?? 0) + 1; }));
  const topTags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const section = document.getElementById('stats-section');
  if (!total) { section.style.display = 'none'; return; }
  section.style.display = '';

  document.getElementById('stat-pins').textContent   = total;
  document.getElementById('stat-places').textContent = places;

  const tagList = document.getElementById('stat-tags');
  tagList.innerHTML = topTags.length
    ? topTags.map(([t, n]) => `
        <div class="stat-tag-row">
          <span class="tag">${escapeHtml(t)}</span>
          <div class="stat-bar-wrap">
            <div class="stat-bar" style="width:${Math.round(n/total*100)}%"></div>
          </div>
          <span class="stat-num">${n}</span>
        </div>`).join('')
    : '<span class="text-muted" style="font-size:.75rem">태그 분석 완료 후 표시됩니다</span>';
}

// ── Toolbar (Arc + FitAll) ────────────────────────────────
function setupToolbar() {
  arcBtn.addEventListener('click', () => {
    const on = toggleArcs();
    arcBtn.classList.toggle('active', on);
    arcBtn.title = on ? '여행 경로 숨기기' : '여행 경로 보기';
    toast(on ? '여행 경로를 표시합니다' : '여행 경로를 숨겼습니다', 'info', 1500);
  });

  fitBtn.addEventListener('click', () => {
    if (!getAllPins().length) { toast('핀이 없습니다', 'error'); return; }
    flyToAll();
  });
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

// ── Lightbox ──────────────────────────────────────────────
function setupLightbox() {
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) closeLightbox();
  });
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
}

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt ?? '';
  lightbox.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('visible');
  document.body.style.overflow = '';
}

// ── Popup ─────────────────────────────────────────────────
function setupPopup() {
  document.getElementById('popup-close').addEventListener('click', hidePopup);
  document.getElementById('popup-delete').addEventListener('click', () => {
    const id = parseInt(popup.dataset.pinId);
    if (id) removePin(id);
  });
  // 팝업 이미지 클릭 → 라이트박스
  popup.querySelector('.popup-img').addEventListener('click', () => {
    const src = popup.querySelector('.popup-img').src;
    const place = popup.querySelector('.place-name').textContent;
    if (src) openLightbox(src, place);
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
  const rect = document.querySelector('.globe-container').getBoundingClientRect();
  const W = 240, H = 340, M = 12;
  if (clientX == null || clientY == null) {
    popup.style.top = `${M}px`; popup.style.left = `${rect.width - W - M}px`; return;
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
  el.innerHTML = (!tags?.length)
    ? '<span class="loading-tags">태그 분석 중…</span>'
    : tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
}

function hidePopup() {
  popup.classList.remove('visible');
  popup.dataset.pinId = '';
  document.querySelectorAll('.pin-item').forEach(el => el.classList.remove('active'));
}

// ── Tour (비행기 애니메이션) ──────────────────────────────
function setupTour() {
  tourBtn.addEventListener('click', () => {
    if (isTourRunning()) {
      stopTour();
      setTourUI(false);
      toast('여행 재생을 중단했습니다', 'info', 1500);
    } else {
      const pins = getAllPins().filter(p => p.lat != null);
      if (pins.length < 2) {
        toast('GPS 핀이 2개 이상 필요합니다', 'error');
        return;
      }
      setTourUI(true);
      startTour({
        speed: 1,
        onArrive(pin, idx, total) {
          showPopup(pin);
          highlightSidebarItem(pin.id);
          setTourProgress(pin.place, idx + 1, total);
        },
        onComplete() {
          setTourUI(false);
          toast('여행 재생이 완료됐습니다 ✈', 'success');
        },
      });
    }
  });
}

function setTourUI(running) {
  tourBtn.classList.toggle('active', running);
  tourBtn.textContent = running ? '⏹ 재생 중지' : '✈ 여행 재생';
  tourOverlay.style.display = running ? 'flex' : 'none';
  if (!running) hidePopup();
}

function setTourProgress(place, current, total) {
  document.getElementById('tour-place').textContent = place ?? '';
  document.getElementById('tour-progress').textContent = `${current} / ${total}`;
  const pct = Math.round((current / total) * 100);
  document.getElementById('tour-bar').style.width = `${pct}%`;
}

function highlightSidebarItem(id) {
  document.querySelectorAll('.pin-item').forEach(el => el.classList.remove('active'));
  const item = pinList.querySelector(`[data-id="${id}"]`);
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
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
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
