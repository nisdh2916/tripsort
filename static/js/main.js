const FLASK = 'http://localhost:5000';
let pinIdCounter = 0;

// ── DOM refs ──────────────────────────────────────────────
const uploadZone  = document.getElementById('upload-zone');
const fileInput   = document.getElementById('file-input');
const pinList     = document.getElementById('pin-list');
const emptyState  = document.getElementById('empty-state');
const popup       = document.getElementById('popup');
const toastCont   = document.getElementById('toast-container');

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initGlobe('globe');
  setupUpload();
  setupPopup();
  window.addEventListener('pindrop:pinclick', e => showPopup(e.detail));
});

// ── Upload ────────────────────────────────────────────────
function setupUpload() {
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
}

async function handleFiles(files) {
  for (const file of files) {
    await processFile(file);
    // Nominatim rate limit 대응
    await sleep(1100);
  }
}

async function processFile(file) {
  const id = ++pinIdCounter;
  const objectUrl = URL.createObjectURL(file);

  // 1. EXIF 파싱
  const exif = await extractExif(file);
  if (!exif) {
    toast(`${file.name}: GPS 정보가 없습니다. EXIF 데이터가 있는 사진을 사용하세요.`, 'error');
    addSidebarItem({ id, filename: file.name, url: objectUrl, place: 'GPS 없음', date: null, tags: [], status: 'noexif' });
    return;
  }

  // 2. 사이드바에 로딩 중 항목 추가
  addSidebarItem({ id, filename: file.name, url: objectUrl, place: '지명 확인 중…', date: exif.date, tags: [], status: 'loading' });

  // 3. 역지오코딩
  const place = await reverseGeocode(exif.lat, exif.lng);

  // 4. Flask에 파일 업로드
  let serverFilename = null;
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${FLASK}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    serverFilename = data.filename;
  } catch (e) {
    console.warn('업로드 실패:', e);
  }

  // 5. 지구본에 핀 추가
  const pinData = { id, lat: exif.lat, lng: exif.lng, place, date: exif.date, filename: serverFilename, url: objectUrl, tags: [] };
  addPin(pinData);
  updateSidebarItem(id, { place, status: 'loading' });
  flyTo(exif.lat, exif.lng);

  // 6. Vision AI 태그 (백그라운드)
  if (serverFilename) {
    fetchTags(id, serverFilename);
  } else {
    updateSidebarItem(id, { status: 'done' });
  }
}

async function fetchTags(pinId, filename) {
  try {
    const res = await fetch(`${FLASK}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    const tags = data.tags ?? [];
    updatePin(pinId, { tags });
    updateSidebarItem(pinId, { tags, status: 'done' });
    // 팝업이 열려 있으면 태그 업데이트
    const currentId = popup.dataset.pinId;
    if (currentId && parseInt(currentId) === pinId) {
      const pin = getPinById(pinId);
      if (pin) updatePopupTags(tags);
    }
  } catch (e) {
    console.warn('태그 요청 실패:', e);
    updateSidebarItem(pinId, { status: 'error' });
  }
}

// ── Reverse geocode ───────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Pindrop/1.0' } });
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
function addSidebarItem(pin) {
  emptyState.style.display = 'none';

  const item = document.createElement('div');
  item.className = 'pin-item';
  item.dataset.id = pin.id;
  item.innerHTML = `
    <img class="thumb" src="${pin.url}" alt="">
    <div class="info">
      <div class="place">${pin.place}</div>
      <div class="date">${pin.date ?? '날짜 없음'}</div>
      <div class="tags-row"></div>
    </div>
    <span class="status ${statusClass(pin.status)}">${statusLabel(pin.status)}</span>
  `;
  item.addEventListener('click', () => {
    const p = getPinById(pin.id);
    if (p) { flyTo(p.lat, p.lng); showPopup(p); }
    document.querySelectorAll('.pin-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
  });
  pinList.prepend(item);
}

function updateSidebarItem(id, updates) {
  const item = pinList.querySelector(`[data-id="${id}"]`);
  if (!item) return;
  if (updates.place) item.querySelector('.place').textContent = updates.place;
  if (updates.tags !== undefined) {
    const row = item.querySelector('.tags-row');
    row.innerHTML = updates.tags.map(t => `<span class="tag">${t}</span>`).join('');
  }
  if (updates.status) {
    const s = item.querySelector('.status');
    s.className = `status ${statusClass(updates.status)}`;
    s.textContent = statusLabel(updates.status);
  }
}

function statusClass(s) {
  return { loading: 'status-loading', done: 'status-done', error: 'status-error', noexif: 'status-noexif' }[s] ?? '';
}

function statusLabel(s) {
  return { loading: '분석 중', done: '완료', error: '오류', noexif: 'GPS 없음' }[s] ?? '';
}

// ── Popup ─────────────────────────────────────────────────
function setupPopup() {
  document.getElementById('globe').addEventListener('click', e => {
    if (e.target.id === 'globe') hidePopup();
  });
}

function showPopup(pin) {
  popup.dataset.pinId = pin.id;
  popup.querySelector('.popup-img').src = pin.url;
  popup.querySelector('.place-name').textContent = pin.place ?? '알 수 없는 위치';
  popup.querySelector('.coords').textContent = `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`;
  popup.querySelector('.popup-date').textContent = pin.date ?? '날짜 정보 없음';
  updatePopupTags(pin.tags);
  popup.classList.add('visible');
}

function updatePopupTags(tags) {
  const container = popup.querySelector('.popup-tags');
  if (!tags || tags.length === 0) {
    container.innerHTML = '<span class="loading-tags">태그 분석 중…</span>';
  } else {
    container.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');
  }
}

function hidePopup() {
  popup.classList.remove('visible');
  popup.dataset.pinId = '';
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
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
