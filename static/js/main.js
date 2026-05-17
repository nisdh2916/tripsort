const FLASK      = window.location.origin;
const MAX_MB     = 30;
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp']);
const UNKNOWN_SCOPE = 'unknown';
const UNKNOWN_TRANSPORT = 'unknown';
const KNOWN_CAPTURE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRIP_SPLIT_GAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIP_SPLIT_SCORE_THRESHOLD = 4;
const DATE_GAP_SPLIT_SCORE = 4;
const COUNTRY_CHANGE_SPLIT_SCORE = 5;
const CITY_CHANGE_SPLIT_SCORE = 3;
const SAME_LOCATION_KEEP_SCORE = 4;
const TRIP_SIGNAL_CONFIDENCE_VALUES = new Set(['high', 'medium']);
const IMPORT_UI_YIELD_INTERVAL = 5;
const REVERSE_GEOCODE_GAP_MS = 1000;
const VISION_TASK_GAP_MS = 150;
const ORGANIZATION_COMPACT_PREVIEW_THRESHOLD = 120;
const ORGANIZATION_COMPACT_EXAMPLE_LIMIT = 4;
const DATE_REVIEW_SUGGEST_DAYS = 2;
const TRANSPORT_OPTIONS = [
  { value: 'unknown', label: '알 수 없음' },
  { value: 'bus', label: '버스' },
  { value: 'ktx', label: 'KTX' },
  { value: 'srt', label: 'SRT' },
  { value: 'rail', label: '일반열차' },
  { value: 'subway', label: '지하철' },
  { value: 'car', label: '자동차' },
  { value: 'ferry', label: '배' },
  { value: 'airplane', label: '비행기' },
];
const TRANSPORT_VALUES = new Set(TRANSPORT_OPTIONS.map(option => option.value));
const TRANSPORT_SUMMARIES = {
  unknown: '이동수단 미정',
  bus: '버스 이동',
  ktx: 'KTX 이동',
  srt: 'SRT 이동',
  rail: '열차 이동',
  subway: '지하철 이동',
  car: '자동차 이동',
  ferry: '배 이동',
  airplane: '비행기 이동',
};
let pinIdCounter = 0;
let activeFilter = null;
let activeScope = 'all';
let activeDateFrom = null;
let activeDateTo   = null;
let highlightedIds = new Set();
let aiStatus = { ollama: false, vision: false, rerank: false, missing: [] };
let reverseGeocodeQueue = Promise.resolve();
let lastReverseGeocodeAt = 0;
let visionTaskQueue = Promise.resolve();
let aiEnrichmentRunning = false;
let aiEnrichmentProgress = { completed: 0, total: 0 };
let aiEnrichmentProgressTimer = null;
let aiEnrichmentRunId = 0;
const reverseGeocodeCache = new Map();

// ── DOM refs ──────────────────────────────────────────────
const uploadZone   = document.getElementById('upload-zone');
const fileInput    = document.getElementById('file-input');
const folderInput  = document.getElementById('folder-input');
const folderUploadBtn = document.getElementById('folder-upload-btn');
const uploadProgress = document.getElementById('upload-progress');
const pinList      = document.getElementById('pin-list');
const emptyState   = document.getElementById('empty-state');
const organizationSection = document.getElementById('organization-section');
const organizationPreview = document.getElementById('organization-preview');
const organizationResultStatus = document.getElementById('organization-result-status');
const dateReviewPanel = document.getElementById('date-review-panel');
const dateReviewTitle = document.getElementById('date-review-title');
const dateReviewCopy = document.getElementById('date-review-copy');
const dateReviewApplyBtn = document.getElementById('date-review-apply-btn');
const aiEnrichProgress = document.getElementById('ai-enrich-progress');
const aiEnrichProgressText = document.getElementById('ai-enrich-progress-text');
const aiEnrichProgressPercent = document.getElementById('ai-enrich-progress-percent');
const aiEnrichProgressFill = document.getElementById('ai-enrich-progress-fill');
const overseasList = document.getElementById('overseas-list');
const overseasEmptyState = document.getElementById('overseas-empty-state');
const overseasCount = document.getElementById('overseas-count');
const popup        = document.getElementById('popup');
const toastCont    = document.getElementById('toast-container');
const pinCount     = document.getElementById('pin-count');
const filterBar    = document.getElementById('filter-bar');
const scopeFilter  = document.getElementById('scope-filter');
const exportBtn    = document.getElementById('export-btn');
const zipExportBtn = document.getElementById('zip-export-btn');
const clearAllBtn  = document.getElementById('clear-all-btn');
const aiEnrichBtn  = document.getElementById('ai-enrich-btn');
const arcBtn       = document.getElementById('arc-btn');
const fitBtn       = document.getElementById('fit-btn');
const mapModeBtn   = document.getElementById('map-mode-btn');
const tourBtn      = document.getElementById('tour-btn');
const organizerViewBtn = document.getElementById('organizer-view-btn');
const mapViewBtn = document.getElementById('map-view-btn');
const organizerWorkspace = document.getElementById('organizer-workspace');
const mapWorkspace = document.getElementById('map-workspace');
const tourOverlay  = document.getElementById('tour-overlay');
const searchInput  = document.getElementById('search-input');
const searchBtn    = document.getElementById('search-btn');
const searchClear  = document.getElementById('search-clear');
const lightbox     = document.getElementById('lightbox');
const lightboxImg  = document.getElementById('lightbox-img');
const transportField = document.getElementById('transport-field');
const transportModeSelect = document.getElementById('transport-mode');
const transportSummary = document.getElementById('transport-summary');

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initGlobe('globe');
  setupWorkspaceView();
  setupUpload();
  setupPopup();
  setupLightbox();
  setupToolbar();
  setupExport();
  setupClearAllPhotos();
  setupAiEnrichment();
  setupTour();
  setupSearch();
  setupScopeFilter();
  setupDateFilter();
  setupOrganizationPreview();
  setupDateReview();
  await setupHealth();

  window.addEventListener('tripsort:pinclick', e => {
    const { pin, clientX, clientY } = e.detail;
    showPopup(pin, clientX, clientY);
  });

  await restoreSession();
});

// ── Session restore ───────────────────────────────────────
async function restoreSession() {
  try {
    const res  = await fetch(`${FLASK}/pins`);
    const pins = latestPinsById(await res.json());
    if (!pins.length) return;

    for (const pin of pins) {
      if (pin.id >= pinIdCounter) pinIdCounter = pin.id;
      pin.url = pin.filename ? `/uploads/${pin.filename}` : '';
      addPin(pin);
      addSidebarItem(pin, true);
    }
    updatePinCount();
    updateFilterBar();
    updateDateFilterSection();
    updateStats();
    renderOrganizationPreview();
    toast(`${pins.length}개의 사진을 불러왔습니다`, 'info', 2500);

    // ChromaDB가 비어 있으면 백그라운드 재인덱싱
    try {
      const hRes  = await fetch(`${FLASK}/health`);
      const hData = await hRes.json();
      if (hData.indexed < pins.filter(p => p.filename).length) {
        toast('벡터 인덱스 재구성 중…', 'info', 3000);
        const rRes  = await fetch(`${FLASK}/reindex`, { method: 'POST' });
        const rData = await rRes.json();
        if (rData.reindexed > 0) {
          toast(`${rData.reindexed}개의 사진을 재인덱싱했습니다`, 'success', 3000);
        }
      }
    } catch { /* 서버 상태 확인 실패는 조용히 무시 */ }
  } catch {
    // 서버 꺼져 있으면 조용히 무시
  }
}

// ── Upload ────────────────────────────────────────────────
function setupUpload() {
  uploadZone.addEventListener('click', e => {
    if (e.target === fileInput) return;
    e.preventDefault();
    fileInput.click();
  });
  uploadZone.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });
  folderUploadBtn?.addEventListener('click', e => {
    e.preventDefault();
    folderInput?.click();
  });
  folderInput?.addEventListener('change', () => {
    handleFiles(folderInput.files);
    folderInput.value = '';
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
  if (!arr.length) return;
  const tripId = `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const deferPerFileRefresh = arr.length > 1;
  setUploadProgress(`${arr.length}개 사진 가져오는 중...`);
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && i % IMPORT_UI_YIELD_INTERVAL === 0) {
      setUploadProgress(`${i}/${arr.length}개 처리됨`);
      await yieldToBrowser();
    }
    await processFile(arr[i], i + 1, arr.length, tripId, deferPerFileRefresh);
  }
  refreshDateReviewSuggestions(tripId);
  refreshImportSummary();
  setUploadProgress(`${arr.length}개 사진 가져오기 완료`);
  await revealOrganizationResult(arr.length);
  window.setTimeout(() => clearUploadProgress(), 2500);
}

function refreshImportSummary() {
  updatePinCount();
  updateDateFilterSection();
  updateStats();
  renderOrganizationPreview();
}

function setUploadProgress(message) {
  if (!uploadProgress) return;
  uploadProgress.textContent = message;
  uploadProgress.hidden = false;
}

function clearUploadProgress() {
  if (!uploadProgress) return;
  uploadProgress.textContent = '';
  uploadProgress.hidden = true;
}

function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

async function revealOrganizationResult(importedCount) {
  await showWorkspaceView('organizer');
  renderOrganizationPreview();
  organizationSection?.classList.add('result-ready');
  organizationSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    organizationSection?.classList.remove('result-ready');
  }, 2400);
  toast(`${importedCount}개 사진의 정리 결과가 준비됐습니다`, 'success', 3000);
}

function queueVisionTask(task) {
  const queued = visionTaskQueue.then(async () => {
    const result = await task();
    if (VISION_TASK_GAP_MS > 0) await sleep(VISION_TASK_GAP_MS);
    return result;
  });
  visionTaskQueue = queued.catch(() => {});
  return queued;
}

async function uploadSourceFile(file) {
  try {
    const form = new FormData();
    form.append('file', file);
    const res  = await fetch(`${FLASK}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return {}; }
    return data;
  } catch (e) {
    console.warn('업로드 실패:', e);
    return {};
  }
}

function latestPinsById(pins) {
  const latest = new Map();
  (Array.isArray(pins) ? pins : []).forEach(pin => {
    if (pin?.id == null) return;
    latest.set(pin.id, pin);
  });
  return Array.from(latest.values());
}

function sourcePhotoFromUpload(file, uploadMetadata, importedAt) {
  return {
    originalFilename: uploadMetadata.originalFilename || file.name,
    storedFilename: uploadMetadata.storedFilename || uploadMetadata.filename || '',
    mimeType: uploadMetadata.mimeType || file.type || '',
    fileSize: Number.isFinite(uploadMetadata.fileSize) ? uploadMetadata.fileSize : file.size,
    importedAt: uploadMetadata.uploadedAt || importedAt,
    sourceFolder: sourceFolderFromFile(file),
  };
}

function sourceFolderFromFile(file) {
  const path = file.webkitRelativePath || '';
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

async function processFile(file, current, total, tripId, deferPreview = false) {
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`${file.name}: 파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). ${MAX_MB}MB 이하만 지원합니다`, 'error');
    return;
  }
  if (!isSupportedImageFile(file)) {
    toast(`${file.name}: 지원하지 않는 파일 형식입니다. JPG, PNG, HEIC, WEBP만 지원합니다`, 'error');
    return;
  }

  const id = ++pinIdCounter;
  const objectUrl = URL.createObjectURL(file);
  const label = total > 1 ? ` (${current}/${total})` : '';
  const importedAt = new Date().toISOString();

  const metadata = await extractPhotoMetadata(file);
  const exif = metadata?.hasGps ? metadata : null;
  if (!exif) {
    toast(`${file.name}: GPS 정보가 없습니다${label}`, 'error');
    const uploadMetadata = await uploadSourceFile(file);
    const pinData = {
      id,
      filename: uploadMetadata.filename || '',
      url: objectUrl,
      place: 'GPS 없음',
      date: metadata?.date ?? null,
      tags: [],
      regionScope: UNKNOWN_SCOPE,
      transportMode: UNKNOWN_TRANSPORT,
      sourcePhoto: sourcePhotoFromUpload(file, uploadMetadata, importedAt),
      organization: {
        tripId,
        candidateCaptureDate: metadata?.captureDate || 'Unknown Date',
        captureDateSource: metadata?.dateSource || 'unknown',
        candidatePlace: '',
        confidence: 'unknown',
        reason: metadata?.dateSource === 'unknown'
          ? 'GPS metadata and reliable capture date are missing; place inference is pending.'
          : 'GPS metadata is missing; place inference is pending.',
        status: 'needs_inference',
      },
      status: 'noexif',
    };
    addPin(pinData);
    addSidebarItem(pinData, false);
    if (!deferPreview) refreshImportSummary();
    persistPin({ ...pinData, url: undefined });
    return;
  }

  const regionScope = window.classifyRegionScope
    ? window.classifyRegionScope(exif.lat, exif.lng)
    : UNKNOWN_SCOPE;
  const initialPlace = `${exif.lat.toFixed(3)}, ${exif.lng.toFixed(3)}`;

  addSidebarItem({
    id,
    filename: file.name,
    url: objectUrl,
    lat: exif.lat,
    lng: exif.lng,
    place: '지명 확인 중',
    date: exif.date,
    tags: [],
    regionScope,
    transportMode: UNKNOWN_TRANSPORT,
    sourcePhoto: {
      originalFilename: file.name,
      storedFilename: '',
      mimeType: file.type || '',
      fileSize: file.size,
      importedAt,
    },
    organization: {
      tripId,
      candidateCaptureDate: exif.captureDate || 'Unknown Date',
      captureDateSource: exif.dateSource || 'unknown',
      candidatePlace: initialPlace,
      confidence: 'unknown',
      reason: 'Waiting for reverse geocoding.',
      status: 'pending',
    },
    status: 'loading',
  }, false);

  const uploadMetadata = await uploadSourceFile(file);
  const serverFilename = uploadMetadata.filename || null;
  const pinData = {
    id,
    lat: exif.lat,
    lng: exif.lng,
    place: initialPlace,
    date: exif.date,
    filename: serverFilename,
    url: objectUrl,
    tags: [],
    regionScope,
    transportMode: UNKNOWN_TRANSPORT,
    sourcePhoto: sourcePhotoFromUpload(file, uploadMetadata, importedAt),
    organization: {
      tripId,
      candidateCaptureDate: exif.captureDate || 'Unknown Date',
      captureDateSource: exif.dateSource || 'unknown',
      candidatePlace: initialPlace,
      confidence: 'unknown',
      reason: 'Waiting for reverse geocoding.',
      status: 'pending',
    },
  };
  addPin(pinData);
  updateSidebarItem(id, { place: initialPlace, status: 'loading' });
  flyTo(exif.lat, exif.lng);
  if (!deferPreview) refreshImportSummary();
  toast(`${file.name} 가져오기 완료${label}`, 'success', 1600);

  persistPin({ ...pinData, url: undefined });

  updateSidebarItem(id, { status: 'done' });

  resolveGpsPlace(id, exif.lat, exif.lng);
}
// ── Vision AI 태그 ────────────────────────────────────────
function fetchTags(pinId, filename) {
  return queueVisionTask(() => fetchTagsNow(pinId, filename));
}

async function fetchTagsNow(pinId, filename) {
  if (!aiStatus.vision) {
    updateSidebarItem(pinId, { status: 'done' });
    toast('사진 AI 모델이 없어 태그·캡션을 건너뜁니다', 'info', 3500);
    return;
  }
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
    updateAiEnrichState();

    const pin = getPinById(pinId);
    if (pin) {
      persistPin({ ...pin, url: undefined });
      indexPin({ ...pin, url: undefined }); // 태그 포함해 재인덱싱
    }
    if (parseInt(popup.dataset.pinId) === pinId) updatePopupTags(tags);

    // 태그와 캡션을 한 큐 작업으로 묶어 AI 보강 진행률이 실제 완료 시점과 맞게 한다.
    await fetchCaptionNow(pinId, filename);
  } catch {
    updateSidebarItem(pinId, { status: 'error' });
  }
}

// ── AI 캡션 ───────────────────────────────────────────────
function fetchCaption(pinId, filename) {
  return queueVisionTask(() => fetchCaptionNow(pinId, filename));
}

async function fetchCaptionNow(pinId, filename) {
  try {
    const pin = getPinById(pinId);
    const res = await fetch(`${FLASK}/caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        place: pin?.place ?? '',
        date:  pin?.date  ?? '',
      }),
    });
    const data = await res.json();
    const caption = data.caption ?? '';
    if (!caption) return;

    updatePin(pinId, { caption });
    updateAiEnrichState();
    const updated = getPinById(pinId);
    if (updated) {
      const stored = { ...updated, url: undefined };
      persistPin(stored);
      indexPin(stored);
    }

    // 팝업이 해당 핀을 보여주고 있다면 즉시 갱신
    if (parseInt(popup.dataset.pinId) === pinId) updatePopupCaption(caption);
  } catch { /* 캡션 생성 실패는 조용히 무시 */ }
}

function acceptedPlaceInference(data) {
  const confidence = String(data?.confidence || '').toLowerCase();
  return Boolean(data?.available && data?.place && ['high', 'medium'].includes(confidence));
}

function compactTripSignals(value) {
  if (!value || typeof value !== 'object') return null;
  const signals = {};
  ['city', 'country', 'landmark', 'sceneType', 'confidence', 'reason', 'source'].forEach(key => {
    const text = String(value[key] ?? '').trim();
    if (text) signals[key] = text;
  });
  return Object.keys(signals).length ? signals : null;
}

function tripSignalsFromInference(data) {
  const nested = compactTripSignals(data?.tripSignals) || {};
  return compactTripSignals({
    city: data?.city || nested.city,
    country: data?.country || nested.country,
    landmark: data?.landmark || nested.landmark,
    sceneType: data?.sceneType || nested.sceneType,
    confidence: data?.confidence || nested.confidence || 'unknown',
    reason: data?.reason || nested.reason || '',
    source: nested.source || 'vlm',
  });
}

function inferMissingPlace(pinId, filename, originalFilename, sourceFolder) {
  return queueVisionTask(() => inferMissingPlaceNow(pinId, filename, originalFilename, sourceFolder));
}

async function inferMissingPlaceNow(pinId, filename, originalFilename, sourceFolder) {
  const pin = getPinById(pinId);
  if (!pin) return;

  let data = {
    available: false,
    confidence: 'unavailable',
    reason: filename
      ? 'Vision place inference unavailable.'
      : 'No stored upload is available for place inference.',
  };

  if (filename) {
    try {
      const res = await fetch(`${FLASK}/infer-place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, originalFilename, sourceFolder }),
      });
      data = await res.json();
    } catch {
      data = {
        available: false,
        confidence: 'unavailable',
        reason: 'Vision place inference request failed.',
      };
    }
  }

  const accepted = acceptedPlaceInference(data);
  const place = accepted ? data.place : 'Unknown Location';
  const organization = {
    ...(pin.organization || {}),
    candidatePlace: place,
    confidence: accepted ? data.confidence : (data.confidence || 'low'),
    reason: accepted
      ? (data.reason || 'Vision model inferred a place from image clues.')
      : (data.reason || 'Place inference unavailable; using Unknown Location fallback.'),
    status: accepted ? 'ready' : 'fallback',
  };
  const tripSignals = tripSignalsFromInference(data);
  if (tripSignals) organization.tripSignals = tripSignals;

  updatePin(pinId, { place, organization });
  updateSidebarItem(pinId, { place });
  updateStats();
  renderOrganizationPreview();
  updateAiEnrichState();

  const updated = getPinById(pinId);
  if (updated) persistPin({ ...updated, url: undefined });
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

async function deleteAllFromServer() {
  try {
    await fetch(`${FLASK}/pins`, { method: 'DELETE' });
  } catch { }
}

// CLIP 인덱싱 (Forward Pass)
async function indexPin(pin) {
  if (!pin.filename) return;
  try {
    await fetch(`${FLASK}/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pin),
    });
  } catch { /* 서버 꺼져 있으면 무시 */ }
}

// ── Search (RAG 2-pass) ───────────────────────────────────
function setupSearch() {
  searchBtn.addEventListener('click', runSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  searchClear.addEventListener('click', clearSearch);
}

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  searchBtn.disabled = true;
  searchBtn.textContent = '검색 중…';

  try {
    const res  = await fetch(`${FLASK}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();

    if (data.error) {
      toast(data.error, 'error');
      return;
    }

    const ids = data.pin_ids ?? [];
    applySearchHighlight(ids, query);

    if (ids.length === 0) {
      toast(`"${query}"에 해당하는 사진을 찾지 못했습니다`, 'info');
    } else {
      toast(`"${query}" — ${ids.length}개의 사진을 찾았습니다`, 'success', 3000);
      // 첫 번째 결과로 카메라 이동
      const first = getPinById(ids[0]);
      if (first) flyTo(first.lat, first.lng);
    }
  } catch {
    toast('검색 중 오류가 발생했습니다. 서버를 확인하세요.', 'error');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '검색';
  }
}

function applySearchHighlight(ids, query) {
  highlightedIds = new Set(ids);
  searchClear.style.display = ids.length ? 'flex' : 'none';

  // 사이드바: 매칭 핀만 보이도록
  sidebarItems().forEach(item => {
    const id = parseInt(item.dataset.id);
    if (highlightedIds.size === 0) {
      item.style.display = '';
      item.classList.remove('search-match');
    } else {
      const match = highlightedIds.has(id);
      item.style.display = match ? '' : 'none';
      item.classList.toggle('search-match', match);
    }
  });

  // 지구본: 매칭 핀 강조
  setSearchHighlight(ids);

  // 검색 상태 레이블
  const label = document.getElementById('search-label');
  if (label) {
    label.textContent = ids.length
      ? `"${query}" 검색 결과: ${ids.length}개`
      : '';
    label.style.display = ids.length ? '' : 'none';
  }
}

function clearSearch() {
  searchInput.value  = '';
  highlightedIds     = new Set();
  searchClear.style.display = 'none';

  // 사이드바 복원
  sidebarItems().forEach(item => {
    item.style.display = '';
    item.classList.remove('search-match');
  });

  // 지구본 복원
  setSearchHighlight([]);

  const label = document.getElementById('search-label');
  if (label) { label.textContent = ''; label.style.display = 'none'; }

  // 기존 activeFilter 재적용
  if (activeFilter) setFilter(activeFilter);
}

// ── Reverse geocode ───────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const params = new URLSearchParams({ lat, lng });
    const res  = await fetch(`${FLASK}/reverse-geocode?${params}`);
    const data = await res.json();
    return data.place ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  } catch {
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
}

function reverseGeocodeKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

async function queuedReverseGeocode(lat, lng) {
  const key = reverseGeocodeKey(lat, lng);
  if (reverseGeocodeCache.has(key)) return reverseGeocodeCache.get(key);

  const task = reverseGeocodeQueue.then(async () => {
    const elapsed = Date.now() - lastReverseGeocodeAt;
    if (lastReverseGeocodeAt && elapsed < REVERSE_GEOCODE_GAP_MS) {
      await sleep(REVERSE_GEOCODE_GAP_MS - elapsed);
    }
    const place = await reverseGeocode(lat, lng);
    lastReverseGeocodeAt = Date.now();
    reverseGeocodeCache.set(key, place);
    return place;
  });
  reverseGeocodeQueue = task.catch(() => {});
  return task;
}

async function resolveGpsPlace(pinId, lat, lng) {
  const place = await queuedReverseGeocode(lat, lng);
  const pin = getPinById(pinId);
  if (!pin) return;

  const organization = {
    ...(pin.organization || {}),
    candidatePlace: place || '',
    confidence: place ? 'high' : 'unknown',
    reason: place
      ? 'Place candidate came from EXIF GPS reverse geocoding.'
      : 'Place has not been resolved yet.',
    status: place ? 'ready' : 'pending',
  };

  updatePin(pinId, { place, organization });
  updateSidebarItem(pinId, { place, status: 'done' });
  updateStats();
  renderOrganizationPreview();

  const updated = getPinById(pinId);
  if (updated) {
    const stored = { ...updated, url: undefined };
    persistPin(stored);
    indexPin(stored);
  }
}

// ── Sidebar ───────────────────────────────────────────────
function isInternationalPin(pin) {
  if (pin?.regionScope === 'international') return true;
  if (pin?.regionScope === 'domestic') return false;
  if (pin?.lat == null || pin?.lng == null || !window.classifyRegionScope) return false;
  return window.classifyRegionScope(pin.lat, pin.lng) === 'international';
}

function pinRegionScope(pin) {
  if (!pin) return UNKNOWN_SCOPE;
  if (isInternationalPin(pin)) return 'international';
  if (pin.regionScope === 'domestic') return 'domestic';
  if (pin.lat != null && pin.lng != null && window.classifyRegionScope) {
    return window.classifyRegionScope(pin.lat, pin.lng);
  }
  return pin.regionScope || UNKNOWN_SCOPE;
}

function pinMatchesScopeFilter(pin) {
  return activeScope === 'all' || pinRegionScope(pin) === activeScope;
}

function pinHiddenByScopeFilter(pin) {
  return activeScope !== 'all' && pinRegionScope(pin) !== activeScope;
}

function sidebarItemMatchesScope(item, pin) {
  const scope = pin ? pinRegionScope(pin) : (item.dataset.regionScope || UNKNOWN_SCOPE);
  return activeScope === 'all' || scope === activeScope;
}

function sidebarListForPin(pin) {
  return isInternationalPin(pin) && overseasList ? overseasList : pinList;
}

function findSidebarItem(id) {
  return pinList.querySelector(`[data-id="${id}"]`)
    || overseasList?.querySelector(`[data-id="${id}"]`);
}

function sidebarItems() {
  return document.querySelectorAll('.pin-item');
}

function refreshListEmptyStates() {
  emptyState.style.display = pinList.querySelector('.pin-item') ? 'none' : '';
  if (overseasEmptyState) {
    overseasEmptyState.style.display = overseasList?.querySelector('.pin-item') ? 'none' : '';
  }
  if (overseasCount) {
    overseasCount.textContent = String(overseasList?.querySelectorAll('.pin-item').length ?? 0);
  }
}

function formatPinCoords(pin) {
  const lat = Number(pin?.lat);
  const lng = Number(pin?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function safePreviewSegment(value, fallback) {
  const text = String(value ?? '')
    .trim()
    .replaceAll('..', '_')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[ ._]+|[ ._]+$/g, '');
  return text || fallback;
}

function safePreviewFilename(value, fallback = 'photo') {
  const safeName = safePreviewSegment(value, fallback);
  const dot = safeName.lastIndexOf('.');
  if (dot <= 0) return safePreviewSegment(safeName, fallback);
  const stem = safePreviewSegment(safeName.slice(0, dot), fallback);
  const ext = safePreviewSegment(safeName.slice(dot + 1), '').toLowerCase();
  return ext ? `${stem}.${ext}` : stem;
}

function sourcePreviewFilename(pin) {
  return safePreviewFilename(
    pin.sourcePhoto?.originalFilename || pin.filename || `photo-${pin.id}`,
  );
}

function outputFilenameFromEdit(rawFilename, pin) {
  const sourceFilename = sourcePreviewFilename(pin);
  const sourceDot = sourceFilename.lastIndexOf('.');
  const sourceExt = sourceDot > 0 ? sourceFilename.slice(sourceDot) : '';
  const trimmed = String(rawFilename ?? '').trim();
  if (!trimmed) return sourceFilename;

  const safeEdited = safePreviewFilename(trimmed, sourceFilename);
  const editedDot = safeEdited.lastIndexOf('.');
  if (editedDot > 0) return safeEdited;
  return safePreviewFilename(`${safeEdited}${sourceExt}`, sourceFilename);
}

function organizationCaptureDate(pin) {
  return pin.organization?.candidateCaptureDate || pin.date || 'Unknown Date';
}

function organizationPlace(pin) {
  return pin.organization?.candidatePlace || pin.place || 'Unknown Location';
}

function organizationTripKey(pin) {
  return pin.organization?.tripId || pin.tripId || '__default_trip__';
}

function organizationTripGroupId(pin) {
  return pin.organization?.tripGroupId || pin.tripGroupId || '';
}

function organizationTripName(pin) {
  return pin.organization?.tripName || pin.tripName || '';
}

function organizationTripSignals(pin) {
  return compactTripSignals(pin.organization?.tripSignals || pin.tripSignals) || {};
}

function acceptedTripSignal(signals) {
  return TRIP_SIGNAL_CONFIDENCE_VALUES.has(String(signals.confidence || '').trim().toLowerCase());
}

function comparableSignal(value) {
  return String(value || '').trim().toLowerCase();
}

function knownCaptureDateTime(pin) {
  const captureDate = String(organizationCaptureDate(pin) || '');
  if (!KNOWN_CAPTURE_DATE_RE.test(captureDate)) return null;
  const time = Date.parse(`${captureDate}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
}

function captureDateSource(pin) {
  return pin.organization?.captureDateSource || pin.dateSource || '';
}

function isFileModifiedDate(pin) {
  return captureDateSource(pin) === 'fileModified'
    && KNOWN_CAPTURE_DATE_RE.test(String(organizationCaptureDate(pin) || ''));
}

function dateOnlyTime(date) {
  if (!KNOWN_CAPTURE_DATE_RE.test(String(date || ''))) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
}

function dateDiffDays(a, b) {
  const aTime = dateOnlyTime(a);
  const bTime = dateOnlyTime(b);
  if (aTime === null || bTime === null) return null;
  return Math.abs(aTime - bTime) / DAY_MS;
}

function trustedDateCandidates(pins) {
  return Array.from(new Set(
    pins
      .filter(pin => captureDateSource(pin) === 'exif')
      .map(pin => organizationCaptureDate(pin))
      .filter(date => KNOWN_CAPTURE_DATE_RE.test(String(date || ''))),
  ));
}

function nearestTrustedDate(candidateDate, trustedDates) {
  return trustedDates
    .map(date => ({ date, diff: dateDiffDays(candidateDate, date) }))
    .filter(item => item.diff !== null)
    .sort((a, b) => a.diff - b.diff)[0] || null;
}

function buildDateReview(pin, trustedDates) {
  if (!isFileModifiedDate(pin)) return null;
  const candidateDate = organizationCaptureDate(pin);
  const nearest = nearestTrustedDate(candidateDate, trustedDates);
  if (!nearest) {
    return {
      status: 'needs_review',
      source: 'fileModified',
      reason: '파일 수정일 기준 날짜라 실제 촬영일과 다를 수 있습니다.',
    };
  }
  if (nearest.diff > 0 && nearest.diff <= DATE_REVIEW_SUGGEST_DAYS) {
    return {
      status: 'suggested',
      source: 'fileModified',
      suggestedDate: nearest.date,
      reason: `파일 수정일이 촬영일보다 ${nearest.diff}일 차이날 수 있어 같은 가져오기 묶음의 EXIF 날짜를 제안합니다.`,
    };
  }
  return {
    status: 'needs_review',
    source: 'fileModified',
    reason: '파일 수정일 기준 날짜라 실제 촬영일과 다를 수 있습니다. 날짜 차이가 커서 자동 제안하지 않습니다.',
  };
}

function refreshDateReviewSuggestions(tripId) {
  const pins = getAllPins().filter(pin => organizationTripKey(pin) === tripId);
  const trustedDates = trustedDateCandidates(pins);
  pins.forEach(pin => {
    const review = buildDateReview(pin, trustedDates);
    if (!review && !pin.organization?.dateReview) return;
    const organization = { ...(pin.organization || {}) };
    if (review) organization.dateReview = review;
    else delete organization.dateReview;
    updatePin(pin.id, { organization });
  });
}

function tripDateRange(pins) {
  const dates = Array.from(new Set(
    pins
      .map(pin => organizationCaptureDate(pin))
      .filter(date => KNOWN_CAPTURE_DATE_RE.test(String(date || ''))),
  )).sort();
  if (!dates.length) return 'Unknown Date';
  if (dates[0] === dates[dates.length - 1]) return dates[0];
  return `${dates[0]}_to_${dates[dates.length - 1]}`;
}

function tripPlaceName(pins) {
  const counts = new Map();
  const firstSeen = new Map();
  pins.forEach((pin, index) => {
    const place = organizationPlace(pin);
    if (!place || place === 'Unknown Location' || place === 'GPS 없음') return;
    const safePlace = safePreviewSegment(place, 'Unknown Location');
    if (safePlace === 'Unknown Location') return;
    counts.set(safePlace, (counts.get(safePlace) || 0) + 1);
    if (!firstSeen.has(safePlace)) firstSeen.set(safePlace, index);
  });
  if (!counts.size) return 'Unknown Location';
  return Array.from(counts.keys()).sort((a, b) => {
    const byCount = counts.get(b) - counts.get(a);
    return byCount || firstSeen.get(a) - firstSeen.get(b);
  })[0];
}

function tripFolderName(pins) {
  const customName = pins
    .map(pin => safePreviewSegment(organizationTripName(pin), ''))
    .find(Boolean);
  if (customName) return customName;
  return safePreviewSegment(
    `Trip_${tripDateRange(pins)}_${tripPlaceName(pins)}`,
    'Trip_Unknown Date_Unknown Location',
  );
}

function splitTripPins(tripPins) {
  const indexedPins = tripPins.map((pin, index) => ({
    pin,
    index,
    captureTime: knownCaptureDateTime(pin),
  }));
  const knownPins = indexedPins.filter(item => item.captureTime !== null);
  if (!knownPins.length) return [tripPins];

  const segments = [];
  let currentSegment = [];
  knownPins
    .sort((a, b) => (a.captureTime - b.captureTime) || (a.index - b.index))
    .forEach(item => {
      if (currentSegment.length && shouldStartNewTripSegment(currentSegment[currentSegment.length - 1].pin, item.pin)) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      currentSegment.push(item);
    });
  if (currentSegment.length) segments.push(currentSegment);

  const unknownPins = indexedPins.filter(item => item.captureTime === null);
  if (unknownPins.length) segments[0].push(...unknownPins);

  return segments.map(segment => (
    segment
      .sort((a, b) => a.index - b.index)
      .map(item => item.pin)
  ));
}

function shouldStartNewTripSegment(previousPin, currentPin) {
  const previousTime = knownCaptureDateTime(previousPin);
  const currentTime = knownCaptureDateTime(currentPin);
  let score = 0;
  if (
    previousTime !== null
    && currentTime !== null
    && ((currentTime - previousTime) / DAY_MS) > TRIP_SPLIT_GAP_DAYS
  ) {
    score += DATE_GAP_SPLIT_SCORE;
  }

  const previousSignals = organizationTripSignals(previousPin);
  const currentSignals = organizationTripSignals(currentPin);
  if (acceptedTripSignal(previousSignals) && acceptedTripSignal(currentSignals)) {
    const previousCountry = comparableSignal(previousSignals.country);
    const currentCountry = comparableSignal(currentSignals.country);
    const previousCity = comparableSignal(previousSignals.city);
    const currentCity = comparableSignal(currentSignals.city);

    if (previousCountry && currentCountry && previousCountry !== currentCountry) {
      score += COUNTRY_CHANGE_SPLIT_SCORE;
    } else if (previousCity && currentCity && previousCity !== currentCity) {
      score += CITY_CHANGE_SPLIT_SCORE;
    }

    if (
      previousCountry
      && currentCountry
      && previousCountry === currentCountry
      && previousCity
      && currentCity
      && previousCity === currentCity
    ) {
      score -= SAME_LOCATION_KEEP_SCORE;
    }
  }

  return score >= TRIP_SPLIT_SCORE_THRESHOLD;
}

function previewPathEntries(pins) {
  const usedByFolder = new Map();
  const tripGroups = new Map();
  pins.forEach(pin => {
    const manualGroupId = organizationTripGroupId(pin);
    const key = manualGroupId ? `manual:${manualGroupId}` : `auto:${organizationTripKey(pin)}`;
    if (!tripGroups.has(key)) {
      tripGroups.set(key, {
        manual: Boolean(manualGroupId),
        pins: [],
      });
    }
    tripGroups.get(key).pins.push(pin);
  });
  return Array.from(tripGroups.entries()).flatMap(([tripKey, tripGroup]) => {
    const segments = tripGroup.manual ? [tripGroup.pins] : splitTripPins(tripGroup.pins);
    return segments.flatMap((segmentPins, segmentIndex) => {
      const segmentKey = tripGroup.manual ? tripKey : `${tripKey}::${segmentIndex}`;
      const tripFolder = tripFolderName(segmentPins);
      return segmentPins.map((pin, tripEntryIndex) => {
        const organization = pin.organization || {};
        const sourcePhoto = pin.sourcePhoto || {};
        const detailFolder = `${safePreviewSegment(
          organizationCaptureDate(pin),
          'Unknown Date',
        )}_${safePreviewSegment(
          organizationPlace(pin),
          'Unknown Location',
        )}`;
        const folder = `${tripFolder}/${detailFolder}`;
        const baseFilename = safePreviewFilename(
          organization.candidateFilename || sourcePhoto.originalFilename || pin.filename || `photo-${pin.id}`,
        );
        const folderKey = folder.toLowerCase();
        const used = usedByFolder.get(folderKey) || new Set();
        let filename = baseFilename;
        let suffix = 2;
        const dot = baseFilename.lastIndexOf('.');
        const stem = dot > 0 ? baseFilename.slice(0, dot) : baseFilename;
        const ext = dot > 0 ? baseFilename.slice(dot) : '';
        while (used.has(filename.toLowerCase())) {
          filename = `${stem}-${suffix}${ext}`;
          suffix += 1;
        }
        used.add(filename.toLowerCase());
        usedByFolder.set(folderKey, used);
        return {
          pin,
          folder,
          filename,
          outputPath: `${folder}/${filename}`,
          tripKey: segmentKey,
          tripFolder,
          tripEntryIndex,
        };
      });
    });
  });
}

function organizationPreviewGroups(pins) {
  const groups = [];
  const groupIndexByKey = new Map();
  previewPathEntries(pins).forEach(entry => {
    const key = `${entry.tripKey}\n${entry.folder}`;
    let groupIndex = groupIndexByKey.get(key);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexByKey.set(key, groupIndex);
      groups.push({
        tripKey: entry.tripKey,
        tripFolder: entry.tripFolder,
        folder: entry.folder,
        entries: [],
      });
    }
    groups[groupIndex].entries.push(entry);
  });
  return groups;
}

function organizationDateInputValue(pin) {
  const value = pin.organization?.candidateCaptureDate || pin.date || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function organizationFilenameInputValue(pin) {
  return pin.organization?.candidateFilename || sourcePreviewFilename(pin);
}

function dateReview(pin) {
  const review = pin.organization?.dateReview;
  if (review && typeof review === 'object') return review;
  if (isFileModifiedDate(pin)) {
    return {
      status: 'needs_review',
      source: 'fileModified',
      reason: '파일 수정일 기준 날짜라 실제 촬영일과 다를 수 있습니다.',
    };
  }
  return null;
}

function renderDateReview(pin) {
  const review = dateReview(pin);
  if (!review) return '';
  const suggestedDate = review.status === 'suggested' && KNOWN_CAPTURE_DATE_RE.test(review.suggestedDate || '')
    ? review.suggestedDate
    : '';
  return `
    <div class="organization-date-review">
      <span class="date-review-badge">날짜 확인 필요</span>
      <span>${escapeHtml(review.reason || '다운로드 날짜일 수 있습니다.')}</span>
      ${suggestedDate ? `
        <button
          class="organization-date-suggest-btn"
          type="button"
          data-id="${pin.id}"
          data-date="${escapeHtml(suggestedDate)}"
        >${escapeHtml(suggestedDate)}로 변경</button>
      ` : ''}
    </div>
  `;
}

function organizationDecision(pin) {
  const organization = pin.organization || {};
  const confidence = String(organization.confidence || 'unknown').toLowerCase();
  const reason = organization.reason || 'No organization reason has been recorded yet.';
  if (organization.status === 'fallback' || confidence === 'low' || organization.candidatePlace === 'Unknown Location') {
    return { source: 'fallback', confidence, reason, className: confidence === 'low' ? 'decision-low' : 'decision-fallback' };
  }
  if (organization.status === 'edited') {
    return { source: 'manual', confidence, reason, className: 'decision-manual' };
  }
  if (pin.lat != null && pin.lng != null) {
    return { source: 'GPS', confidence, reason, className: 'decision-gps' };
  }
  if (/filename|folder/i.test(reason)) {
    return { source: 'filename/folder', confidence, reason, className: 'decision-filename' };
  }
  if (organization.status === 'ready') {
    return { source: 'VLM 장소 추론', confidence, reason, className: 'decision-vlm' };
  }
  return { source: 'fallback', confidence, reason, className: 'decision-fallback' };
}

function renderOrganizationPreview() {
  if (!organizationPreview) return;
  updateExportState();
  const pins = getAllPins();
  organizationPreview.classList.remove('compact');
  if (!pins.length) {
    updateOrganizationResultStatus(pins);
    updateDateReviewPanel();
    organizationPreview.innerHTML = `
      <div class="empty-state" id="organization-empty-state">
        사진을 가져오면 정리될 폴더와 파일명이 여기에 표시됩니다.
      </div>
    `;
    return;
  }

  const groups = organizationPreviewGroups(pins);
  updateOrganizationResultStatus(pins, groups);
  updateDateReviewPanel();
  if (pins.length > ORGANIZATION_COMPACT_PREVIEW_THRESHOLD) {
    organizationPreview.classList.add('compact');
    organizationPreview.innerHTML = renderCompactOrganizationPreview(groups);
    return;
  }
  organizationPreview.innerHTML = groups.map((group, groupIndex) => `
    <div class="organization-group">
      <div class="organization-trip-controls">
        <form class="organization-trip-form" data-trip-key="${escapeHtml(group.tripKey)}">
          <input
            class="organization-trip-input"
            aria-label="Trip folder name"
            value="${escapeHtml(group.tripFolder)}"
          >
          <button type="submit">Save</button>
        </form>
        ${groupIndex > 0 ? `
          <button
            class="organization-merge-previous-btn"
            type="button"
            data-trip-key="${escapeHtml(group.tripKey)}"
            data-prev-trip-key="${escapeHtml(groups[groupIndex - 1].tripKey)}"
          >Merge previous</button>
        ` : ''}
      </div>
      <div class="organization-folder">${escapeHtml(group.folder)}</div>
      ${group.entries.map(({ pin, filename, tripEntryIndex }) => `
        <div class="organization-row" data-id="${pin.id}">
          <img class="organization-thumb" src="${escapeHtml(pin.url || '')}" alt="">
          <div>
            <div class="organization-original">${escapeHtml(pin.sourcePhoto?.originalFilename || pin.filename || `photo-${pin.id}`)}</div>
            <div class="organization-filename">${escapeHtml(filename)}</div>
            ${tripEntryIndex > 0 ? `
              <button
                class="organization-split-here-btn"
                type="button"
                data-trip-key="${escapeHtml(group.tripKey)}"
                data-id="${pin.id}"
              >Split here</button>
            ` : ''}
            <form class="organization-place-form" data-id="${pin.id}">
              <input
                class="organization-place-input"
                aria-label="제안 장소"
                value="${escapeHtml(pin.organization?.candidatePlace || pin.place || 'Unknown Location')}"
              >
              <button type="submit">저장</button>
            </form>
            <form class="organization-date-form" data-id="${pin.id}">
              <input
                class="organization-date-input"
                type="date"
                aria-label="제안 날짜"
                value="${escapeHtml(organizationDateInputValue(pin))}"
              >
              <button type="submit">저장</button>
            </form>
            ${renderDateReview(pin)}
            <form class="organization-filename-form" data-id="${pin.id}">
              <input
                class="organization-filename-input"
                aria-label="제안 파일명"
                value="${escapeHtml(organizationFilenameInputValue(pin))}"
              >
              <button type="submit">저장</button>
            </form>
            ${(() => {
              const decision = organizationDecision(pin);
              return `
                <div class="organization-meta ${decision.className}">
                  <span class="organization-source">${escapeHtml(decision.source)}</span>
                  <span>${escapeHtml(decision.confidence)}</span>
                </div>
                <div class="organization-reason">${escapeHtml(decision.reason)}</div>
              `;
            })()}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderCompactOrganizationPreview(groups) {
  return `
    <div class="organization-compact-note">
      대량 가져오기에서는 폴더 요약만 표시합니다. ZIP에는 모든 사진이 포함됩니다.
    </div>
    ${groups.map(group => {
      const examples = group.entries.slice(0, ORGANIZATION_COMPACT_EXAMPLE_LIMIT);
      const remaining = group.entries.length - examples.length;
      return `
        <div class="organization-folder-summary">
          <div>
            <div class="organization-folder-summary-path">${escapeHtml(group.folder)}</div>
            <div class="organization-folder-examples">
              ${examples.map(({ filename }) => `<span>${escapeHtml(filename)}</span>`).join('')}
              ${remaining > 0 ? `<span>외 ${remaining}개</span>` : ''}
            </div>
          </div>
          <span class="organization-folder-count">${group.entries.length}개 사진</span>
        </div>
      `;
    }).join('')}
  `;
}

function updateOrganizationResultStatus(pins = getAllPins(), groups = organizationPreviewGroups(pins)) {
  if (!organizationResultStatus) return;
  if (!pins.length) {
    organizationResultStatus.hidden = true;
    organizationResultStatus.textContent = '';
    organizationResultStatus.className = 'organization-result-status';
    return;
  }

  const pending = pins.filter(pin => {
    const status = pin.organization?.status || '';
    return status === 'pending' || status === 'loading';
  }).length;
  const groupCount = groups.length || 1;
  const exportable = hasExportableSourcePhotos();

  organizationResultStatus.hidden = false;
  organizationResultStatus.className = `organization-result-status${pending ? ' pending' : ' ready'}`;
  organizationResultStatus.textContent = pending
    ? `${pins.length}개 사진 정리 중 · ${pending}개 위치/AI 분석 대기`
    : `${pins.length}개 사진 정리 완료 · ${groupCount}개 여행 폴더${exportable ? ' · ZIP 다운로드 가능' : ''}`;
}

function dateReviewPins() {
  return getAllPins().filter(pin => Boolean(dateReview(pin)));
}

function dateReviewSuggestions() {
  return dateReviewPins().filter(pin => {
    const review = dateReview(pin);
    return review?.status === 'suggested' && KNOWN_CAPTURE_DATE_RE.test(review.suggestedDate || '');
  });
}

function updateDateReviewPanel() {
  if (!dateReviewPanel || !dateReviewTitle || !dateReviewCopy || !dateReviewApplyBtn) return;
  const reviewPins = dateReviewPins();
  if (!reviewPins.length) {
    dateReviewPanel.hidden = true;
    return;
  }

  const suggestions = dateReviewSuggestions();
  dateReviewPanel.hidden = false;
  dateReviewTitle.textContent = `${reviewPins.length}개 사진 날짜 확인 필요`;
  dateReviewCopy.textContent = suggestions.length
    ? `${suggestions.length}개 사진은 같은 가져오기 묶음의 EXIF 날짜로 보정할 수 있습니다.`
    : '파일 수정일 기준 날짜라 실제 촬영일과 다를 수 있습니다. 날짜 차이가 큰 사진은 직접 확인하세요.';
  dateReviewApplyBtn.hidden = suggestions.length === 0;
  dateReviewApplyBtn.textContent = `${suggestions.length}개 제안 날짜 적용`;
}

function setupDateReview() {
  dateReviewApplyBtn?.addEventListener('click', applyDateReviewSuggestions);
}

function applyDateSuggestion(pinId, suggestedDate) {
  const pin = getPinById(pinId);
  if (!pin || !KNOWN_CAPTURE_DATE_RE.test(suggestedDate || '')) return false;
  const organization = {
    ...(pin.organization || {}),
    candidateCaptureDate: suggestedDate,
    captureDateSource: 'manual',
    confidence: 'manual',
    reason: 'User accepted the suggested capture date.',
    status: 'edited',
  };
  delete organization.dateReview;
  updatePin(pinId, { date: suggestedDate, organization });
  updateSidebarItem(pinId, { date: suggestedDate });
  return true;
}

function applyDateReviewSuggestions() {
  const updatedIds = new Set();
  dateReviewSuggestions().forEach(pin => {
    const suggestedDate = pin.organization?.dateReview?.suggestedDate;
    if (applyDateSuggestion(pin.id, suggestedDate)) updatedIds.add(pin.id);
  });
  if (!updatedIds.size) {
    toast('적용할 날짜 제안이 없습니다', 'info', 1800);
    return;
  }
  updateDateFilterSection();
  updateStats();
  renderOrganizationPreview();
  persistUpdatedPinIds(updatedIds);
  toast(`${updatedIds.size}개 사진 날짜를 제안 날짜로 변경했습니다`, 'success', 2200);
}

function setupOrganizationPreview() {
  if (!organizationPreview) return;
  organizationPreview.addEventListener('submit', e => {
    const form = e.target.closest('.organization-trip-form');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('.organization-trip-input');
    saveOrganizationTripEdit(form.dataset.tripKey, input?.value);
  });
  organizationPreview.addEventListener('submit', e => {
    const form = e.target.closest('.organization-place-form');
    if (!form) return;
    e.preventDefault();
    const pinId = Number(form.dataset.id);
    const input = form.querySelector('.organization-place-input');
    saveOrganizationPlaceEdit(pinId, input?.value);
  });
  organizationPreview.addEventListener('submit', e => {
    const form = e.target.closest('.organization-date-form');
    if (!form) return;
    e.preventDefault();
    const pinId = Number(form.dataset.id);
    const input = form.querySelector('.organization-date-input');
    saveOrganizationDateEdit(pinId, input?.value);
  });
  organizationPreview.addEventListener('submit', e => {
    const form = e.target.closest('.organization-filename-form');
    if (!form) return;
    e.preventDefault();
    const pinId = Number(form.dataset.id);
    const input = form.querySelector('.organization-filename-input');
    saveOrganizationFilenameEdit(pinId, input?.value);
  });
  organizationPreview.addEventListener('click', e => {
    const dateSuggestButton = e.target.closest('.organization-date-suggest-btn');
    if (dateSuggestButton) {
      if (applyDateSuggestion(Number(dateSuggestButton.dataset.id), dateSuggestButton.dataset.date)) {
        const updated = getPinById(Number(dateSuggestButton.dataset.id));
        if (updated) persistPin({ ...updated, url: undefined });
        updateDateFilterSection();
        updateStats();
        renderOrganizationPreview();
        toast('제안 날짜를 적용했습니다', 'success', 1800);
      }
      return;
    }
    const mergeButton = e.target.closest('.organization-merge-previous-btn');
    if (mergeButton) {
      saveOrganizationTripMerge(mergeButton.dataset.prevTripKey, mergeButton.dataset.tripKey);
      return;
    }
    const splitButton = e.target.closest('.organization-split-here-btn');
    if (splitButton) {
      saveOrganizationTripSplit(splitButton.dataset.tripKey, Number(splitButton.dataset.id));
    }
  });
}

function manualTripGroupId() {
  return `manual-trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function entriesForTripKey(tripKey) {
  return previewPathEntries(getAllPins()).filter(entry => entry.tripKey === tripKey);
}

function persistUpdatedPinIds(pinIds) {
  pinIds.forEach(pinId => {
    const updated = getPinById(pinId);
    if (updated) persistPin({ ...updated, url: undefined });
  });
}

function saveOrganizationTripMerge(previousTripKey, tripKey) {
  const entries = [
    ...entriesForTripKey(previousTripKey),
    ...entriesForTripKey(tripKey),
  ];
  const existingGroupId = entries
    .map(({ pin }) => organizationTripGroupId(pin))
    .find(Boolean);
  const tripGroupId = existingGroupId || manualTripGroupId();
  const updatedIds = new Set();

  entries.forEach(({ pin }) => {
    if (updatedIds.has(pin.id)) return;
    updatedIds.add(pin.id);
    updatePin(pin.id, {
      organization: {
        ...(pin.organization || {}),
        tripGroupId,
      },
    });
  });

  renderOrganizationPreview();
  persistUpdatedPinIds(updatedIds);
  if (updatedIds.size) toast('Trip groups merged.', 'success', 1800);
}

function saveOrganizationTripSplit(tripKey, splitPinId) {
  const entries = entriesForTripKey(tripKey);
  const splitIndex = entries.findIndex(({ pin }) => pin.id === splitPinId);
  if (splitIndex <= 0) return;

  const beforeGroupId = manualTripGroupId();
  const afterGroupId = manualTripGroupId();
  const updatedIds = new Set();

  entries.forEach(({ pin }, index) => {
    updatedIds.add(pin.id);
    updatePin(pin.id, {
      organization: {
        ...(pin.organization || {}),
        tripGroupId: index < splitIndex ? beforeGroupId : afterGroupId,
      },
    });
  });

  renderOrganizationPreview();
  persistUpdatedPinIds(updatedIds);
  toast('Trip group split.', 'success', 1800);
}

function saveOrganizationTripEdit(tripKey, rawName) {
  const entries = entriesForTripKey(tripKey);
  const shouldClearTripName = !String(rawName ?? '').trim();
  const tripName = shouldClearTripName
    ? ''
    : safePreviewSegment(rawName, entries[0]?.tripFolder || 'Trip_Unknown Date_Unknown Location');
  const updatedIds = new Set();

  entries.forEach(({ pin }) => {
    if (updatedIds.has(pin.id)) return;
    updatedIds.add(pin.id);
    const organization = {
      ...(pin.organization || {}),
    };
    if (shouldClearTripName) delete organization.tripName;
    else organization.tripName = tripName;
    updatePin(pin.id, { organization });
  });

  renderOrganizationPreview();

  persistUpdatedPinIds(updatedIds);
  if (updatedIds.size) toast('Trip folder name saved.', 'success', 1800);
}

function saveOrganizationPlaceEdit(pinId, rawPlace) {
  const pin = getPinById(pinId);
  if (!pin) return;

  const place = safePreviewSegment(rawPlace, 'Unknown Location');
  const organization = {
    ...(pin.organization || {}),
    candidatePlace: place,
    confidence: 'manual',
    reason: 'User edited the proposed place.',
    status: 'edited',
  };

  updatePin(pinId, { place, organization });
  updateSidebarItem(pinId, { place });
  updateStats();
  renderOrganizationPreview();

  const updated = getPinById(pinId);
  if (updated) persistPin({ ...updated, url: undefined });
  toast('제안 장소를 저장했습니다', 'success', 1800);
}

function saveOrganizationDateEdit(pinId, rawDate) {
  const pin = getPinById(pinId);
  if (!pin) return;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate || '')
    ? rawDate
    : 'Unknown Date';
  const organization = {
    ...(pin.organization || {}),
    candidateCaptureDate: date,
    captureDateSource: 'manual',
    confidence: 'manual',
    reason: 'User edited the proposed date.',
    status: 'edited',
  };
  delete organization.dateReview;

  updatePin(pinId, { date, organization });
  updateSidebarItem(pinId, { date });
  updateDateFilterSection();
  updateStats();
  renderOrganizationPreview();

  const updated = getPinById(pinId);
  if (updated) persistPin({ ...updated, url: undefined });
  toast('제안 날짜를 저장했습니다', 'success', 1800);
}

function saveOrganizationFilenameEdit(pinId, rawFilename) {
  const pin = getPinById(pinId);
  if (!pin) return;

  const filename = outputFilenameFromEdit(rawFilename, pin);
  const organization = {
    ...(pin.organization || {}),
    candidateFilename: filename,
    confidence: 'manual',
    reason: 'User edited the proposed filename.',
    status: 'edited',
  };

  updatePin(pinId, { organization });
  renderOrganizationPreview();

  const updated = getPinById(pinId);
  if (updated) persistPin({ ...updated, url: undefined });
  toast('제안 파일명을 저장했습니다', 'success', 1800);
}

function addSidebarItem(pin, restored = false) {
  const international = isInternationalPin(pin);
  const targetList = sidebarListForPin(pin);
  const coords = international ? formatPinCoords(pin) : '';
  const displayStatus = restored && pin.status !== 'noexif' ? 'done' : pin.status;

  const item = document.createElement('div');
  item.className = 'pin-item';
  item.dataset.id = pin.id;
  item.dataset.regionScope = international ? 'international' : (pin.regionScope || UNKNOWN_SCOPE);
  if (international) item.classList.add('overseas-pin-item');
  if (activeFilter && !pin.tags?.includes(activeFilter)) item.style.display = 'none';

  item.innerHTML = `
    <img class="thumb" src="${escapeHtml(pin.url || '')}" alt="">
    <div class="info">
      <div class="place">${escapeHtml(pin.place)}</div>
      <div class="date">${pin.date ?? '날짜 없음'}</div>
      ${coords ? `<div class="pin-coords">${coords}</div>` : ''}
      <div class="tags-row">${(pin.tags ?? []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>
    <div class="item-right">
      <span class="status ${statusClass(displayStatus)}">${statusLabel(displayStatus)}</span>
      <button class="delete-btn" title="핀 삭제">✕</button>
    </div>
  `;

  item.querySelector('.delete-btn').addEventListener('click', e => { e.stopPropagation(); removePin(pin.id); });
  item.addEventListener('click', () => {
    const p = getPinById(pin.id);
    if (p?.lat != null) {
      const focusPin = () => {
        flyTo(p.lat, p.lng);
        showPopup(p);
      };
      if (mapWorkspace && !mapWorkspace.hidden) focusPin();
      else showMapWorkspace().then(focusPin);
    }
    document.querySelectorAll('.pin-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
  });
  targetList.prepend(item);
  refreshListEmptyStates();
}

function updateSidebarItem(id, updates) {
  const item = findSidebarItem(id);
  if (!item) return;
  if (updates.place !== undefined) item.querySelector('.place').textContent = updates.place;
  if (updates.date !== undefined) item.querySelector('.date').textContent = updates.date || 'Unknown Date';
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
  findSidebarItem(id)?.remove();
  refreshListEmptyStates();
}

function removePin(id) {
  replaceAllPins(getAllPins().filter(p => p.id !== id));
  removeSidebarItem(id);
  deleteFromServer(id);
  updatePinCount();
  updateFilterBar();
  updateDateFilterSection();
  updateStats();
  renderOrganizationPreview();
  if (parseInt(popup.dataset.pinId) === id) hidePopup();
  toast('핀을 삭제했습니다', 'info', 1800);
}

function setupClearAllPhotos() {
  clearAllBtn?.addEventListener('click', clearAllPhotos);
  updateClearAllState();
}

function updateClearAllState() {
  if (!clearAllBtn) return;
  const count = getAllPins().length;
  clearAllBtn.disabled = count === 0;
  clearAllBtn.title = count ? `${count}개 사진을 모두 삭제` : '삭제할 사진이 없습니다';
}

async function clearAllPhotos() {
  const count = getAllPins().length;
  if (!count) {
    toast('삭제할 사진이 없습니다', 'info', 1800);
    updateClearAllState();
    return;
  }

  const confirmed = window.confirm(
    `현재 가져온 ${count}개 사진을 모두 삭제할까요?\nTripSort 안의 가져온 사진과 정리 미리보기가 비워집니다.`,
  );
  if (!confirmed) return;

  aiEnrichmentRunId += 1;
  aiEnrichmentRunning = false;
  if (aiEnrichmentProgressTimer) {
    window.clearTimeout(aiEnrichmentProgressTimer);
    aiEnrichmentProgressTimer = null;
  }
  aiEnrichmentProgress = { completed: 0, total: 0 };
  if (aiEnrichProgress) aiEnrichProgress.hidden = true;

  replaceAllPins([]);
  document.querySelectorAll('.pin-item').forEach(el => el.remove());
  refreshListEmptyStates();
  activeFilter = null;
  activeScope = 'all';
  activeDateFrom = null;
  activeDateTo = null;
  clearSearch();
  updateScopeFilter();
  const dateFromEl = document.getElementById('date-from');
  const dateToEl = document.getElementById('date-to');
  if (dateFromEl) dateFromEl.value = '';
  if (dateToEl) dateToEl.value = '';
  pinIdCounter = 0;
  if (fileInput) fileInput.value = '';
  if (folderInput) folderInput.value = '';

  updatePinCount();
  updateFilterBar();
  updateDateFilterSection();
  updateStats();
  renderOrganizationPreview();
  updateClearAllState();
  if (popup?.dataset.pinId) hidePopup();

  await deleteAllFromServer();
  toast('사진을 모두 삭제했습니다. 새 폴더를 가져올 수 있습니다.', 'success', 2200);
}

function updatePinCount() {
  const n = getAllPins().length;
  if (pinCount) pinCount.textContent = n > 0 ? `${n}개의 사진` : '';
  updateExportState();
  updateClearAllState();
}

function statusClass(s) {
  return { loading: 'status-loading', done: 'status-done', error: 'status-error', noexif: 'status-noexif' }[s] ?? '';
}
function statusLabel(s) {
  return { loading: '분석 중', done: '완료', error: '오류', noexif: 'GPS 없음' }[s] ?? '';
}

// ── Scope filter ─────────────────────────────────────────
function setupScopeFilter() {
  scopeFilter?.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => setScopeFilter(btn.dataset.scope));
  });
}

function setScopeFilter(scope) {
  activeScope = ['all', 'domestic', 'international'].includes(scope) ? scope : 'all';
  updateScopeFilter();
  applyVisibility();
  refreshPoints();
}

function updateScopeFilter() {
  scopeFilter?.querySelectorAll('[data-scope]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scope === activeScope);
  });
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
  applyVisibility();
  refreshPoints();
  updateFilterBar();
}

// ── Workspace view ───────────────────────────────────────
function setupWorkspaceView() {
  organizerViewBtn?.addEventListener('click', () => {
    showWorkspaceView('organizer');
  });
  mapViewBtn?.addEventListener('click', () => {
    showMapWorkspace();
  });
}

function setWorkspaceTabState(view) {
  const mapOpen = view === 'map';
  organizerWorkspace.hidden = mapOpen;
  mapWorkspace.hidden = !mapOpen;
  organizerViewBtn?.classList.toggle('active', !mapOpen);
  mapViewBtn?.classList.toggle('active', mapOpen);
  organizerViewBtn?.setAttribute('aria-selected', String(!mapOpen));
  mapViewBtn?.setAttribute('aria-selected', String(mapOpen));
  document.body.classList.toggle('map-workspace-open', mapOpen);
}

async function showWorkspaceView(view) {
  if (!organizerWorkspace || !mapWorkspace) return false;

  if (view !== 'map') {
    setWorkspaceTabState('organizer');
    hidePopup();
    return true;
  }

  setWorkspaceTabState('map');
  await new Promise(resolve => requestAnimationFrame(resolve));
  const enabled = await toggleGlobalMapMode();
  if (enabled) {
    mapModeBtn?.classList.add('active');
  }
  return enabled;
}

function showMapWorkspace() {
  return showWorkspaceView('map');
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
    if (!getAllPins().some(pin => pin.lat != null && pin.lng != null)) { toast('표시할 사진 위치가 없습니다', 'error'); return; }
    flyToAll();
  });

  mapModeBtn?.addEventListener('click', async () => {
    const enabled = await toggleGlobalMapMode();
    mapModeBtn.classList.toggle('active', enabled);
    mapModeBtn.innerHTML = enabled ? '&#44060;&#50836; &#51648;&#46020;' : '&#49345;&#49464; &#51648;&#46020;';
  });
}

// ── Export ────────────────────────────────────────────────
function setupExport() {
  exportBtn?.addEventListener('click', downloadOrganizedZip);
  zipExportBtn?.addEventListener('click', downloadOrganizedZip);
  updateExportState();
}

function setupAiEnrichment() {
  aiEnrichBtn?.addEventListener('click', runAiEnrichment);
  updateAiEnrichState();
}

function hasExportableSourcePhotos() {
  return getAllPins().some(pin => pin.sourcePhoto?.storedFilename || pin.filename);
}

function updateExportState() {
  const disabled = !hasExportableSourcePhotos();
  [exportBtn, zipExportBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.title = disabled ? '내보낼 원본 사진이 없습니다' : '정리된 ZIP 다운로드';
  });
  updateAiEnrichState();
}

function sourceFilenameForAi(pin) {
  return pin?.filename || pin?.sourcePhoto?.storedFilename || '';
}

function needsPlaceInference(pin) {
  const organization = pin?.organization || {};
  const status = organization.status || '';
  return (
    pin?.lat == null
    && sourceFilenameForAi(pin)
    && (
      status === 'needs_inference'
      || status === 'fallback'
      || !organization.candidatePlace
      || organization.candidatePlace === 'Unknown Location'
    )
  );
}

function needsTags(pin) {
  return sourceFilenameForAi(pin) && !(pin?.tags || []).length;
}

function needsCaption(pin) {
  return sourceFilenameForAi(pin) && !pin?.caption;
}

function needsAiEnrichment(pin) {
  return needsPlaceInference(pin);
}

function aiEnrichmentJobCount() {
  return getAllPins().filter(needsAiEnrichment).length;
}

function updateAiEnrichState() {
  if (!aiEnrichBtn) return;
  const jobCount = aiEnrichmentJobCount();
  const disabled = aiEnrichmentRunning || !aiStatus.vision || jobCount === 0;
  aiEnrichBtn.disabled = disabled;
  aiEnrichBtn.textContent = aiEnrichmentRunning
    ? `AI 보강 중 ${aiEnrichmentProgress.completed}/${aiEnrichmentProgress.total}`
    : 'AI로 보강';
  aiEnrichBtn.title = !aiStatus.vision
    ? 'VLM 모델이 준비되면 GPS 없는 사진의 장소 후보를 보강할 수 있습니다'
    : jobCount
      ? `${jobCount}개 사진 장소 보강`
      : 'AI로 보강할 사진이 없습니다';
}

function setAiEnrichmentProgress(completed, total, done = false) {
  aiEnrichmentProgress = { completed, total };
  if (!aiEnrichProgress || !aiEnrichProgressText || !aiEnrichProgressPercent || !aiEnrichProgressFill) {
    updateAiEnrichState();
    return;
  }

  if (aiEnrichmentProgressTimer) {
    window.clearTimeout(aiEnrichmentProgressTimer);
    aiEnrichmentProgressTimer = null;
  }

  const safeTotal = Math.max(total, 1);
  const percent = Math.round((completed / safeTotal) * 100);
  aiEnrichProgress.hidden = false;
  aiEnrichProgressText.textContent = `${done ? 'AI 보강 완료' : 'AI 보강 중'} · ${completed}/${total} 사진`;
  aiEnrichProgressPercent.textContent = `${percent}%`;
  aiEnrichProgressFill.style.width = `${percent}%`;
  updateAiEnrichState();
}

function hideAiEnrichmentProgressLater() {
  if (!aiEnrichProgress) return;
  aiEnrichmentProgressTimer = window.setTimeout(() => {
    aiEnrichProgress.hidden = true;
    aiEnrichmentProgressTimer = null;
  }, 6000);
}

async function runAiEnrichment() {
  if (aiEnrichmentRunning) return;
  if (!aiStatus.vision) {
    toast('VLM 모델이 없어 AI 보강을 실행할 수 없습니다', 'error');
    return;
  }

  const candidates = getAllPins().filter(needsAiEnrichment);

  if (!candidates.length) {
    toast('AI로 보강할 사진이 없습니다', 'info', 1800);
    updateAiEnrichState();
    return;
  }

  aiEnrichmentRunning = true;
  const runId = ++aiEnrichmentRunId;
  let completed = 0;
  let failed = 0;
  const total = candidates.length;
  setAiEnrichmentProgress(0, total);
  toast(`${total}개 사진의 장소 보강을 시작했습니다`, 'info', 2200);

  for (const pin of candidates) {
    if (runId !== aiEnrichmentRunId) return;
    const filename = sourceFilenameForAi(pin);
    updateSidebarItem(pin.id, { status: 'loading' });
    try {
      await inferMissingPlace(
        pin.id,
        filename,
        pin.sourcePhoto?.originalFilename || pin.filename || '',
        pin.sourcePhoto?.sourceFolder || '',
      );
    } catch {
      failed += 1;
    } finally {
      if (runId !== aiEnrichmentRunId) return;
      completed += 1;
      setAiEnrichmentProgress(completed, total);
    }
  }

  if (runId !== aiEnrichmentRunId) return;
  aiEnrichmentRunning = false;
  setAiEnrichmentProgress(total, total, true);
  updateAiEnrichState();
  updateStats();
  renderOrganizationPreview();
  hideAiEnrichmentProgressLater();

  toast(
    failed ? `AI 보강 완료 · ${failed}개 사진 실패` : 'AI 보강이 완료됐습니다',
    failed ? 'info' : 'success',
    2600,
  );
}

async function downloadOrganizedZip() {
  if (!hasExportableSourcePhotos()) {
    toast('내보낼 사진이 없습니다', 'error');
    return;
  }

  try {
    const res = await fetch(`${FLASK}/organization/export.zip`);
    if (!res.ok) {
      let message = 'ZIP 내보내기에 실패했습니다';
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch { }
      throw new Error(message);
    }

    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tripsort-organized-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('정리된 ZIP을 다운로드했습니다', 'success');
  } catch (error) {
    toast(error.message || 'ZIP 내보내기에 실패했습니다', 'error');
  }
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
function normalizeTransportMode(mode) {
  return TRANSPORT_VALUES.has(mode) ? mode : UNKNOWN_TRANSPORT;
}

function setTransportSummary(mode) {
  if (!transportSummary) return;
  transportSummary.textContent = TRANSPORT_SUMMARIES[normalizeTransportMode(mode)];
  transportSummary.style.display = '';
}

function transportRouteLabel(mode) {
  const labels = {
    unknown: '이동',
    bus: '버스 이동',
    ktx: 'KTX 이동',
    srt: 'SRT 이동',
    rail: '열차 이동',
    subway: '지하철 이동',
    car: '자동차 이동',
    ferry: '배 이동',
    airplane: '비행기 이동',
  };
  return labels[normalizeTransportMode(mode)];
}

function setupTransportModeSelector() {
  if (!transportModeSelect) return;
  transportModeSelect.innerHTML = TRANSPORT_OPTIONS
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join('');
  transportModeSelect.addEventListener('change', () => {
    const id = parseInt(popup.dataset.pinId);
    const pin = getPinById(id);
    if (!pin || pinRegionScope(pin) !== 'domestic') return;
    const transportMode = normalizeTransportMode(transportModeSelect.value);
    updatePin(id, { transportMode });
    setTransportSummary(transportMode);
    const updated = getPinById(id);
    if (updated) {
      const stored = { ...updated, url: undefined };
      persistPin(stored);
      indexPin(stored);
    }
  });
}

function updatePopupTransport(pin) {
  if (!transportField || !transportModeSelect) return;
  const domestic = pinRegionScope(pin) === 'domestic';
  transportField.style.display = domestic ? 'flex' : 'none';
  if (transportSummary) transportSummary.style.display = domestic ? '' : 'none';
  if (domestic) {
    const transportMode = normalizeTransportMode(pin.transportMode);
    transportModeSelect.value = transportMode;
    setTransportSummary(transportMode);
  }
}

function setupPopup() {
  setupTransportModeSelector();
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
    if (
      e.target.id === 'globe' ||
      e.target.tagName === 'CANVAS' ||
      e.target.classList.contains('korea-map-surface') ||
      e.target.classList.contains('global-map-canvas') ||
      e.target.closest?.('.global-map-canvas')
    ) hidePopup();
  });
}

function showPopup(pin, clientX, clientY) {
  popup.dataset.pinId = pin.id;
  popup.querySelector('.popup-img').src = pin.url || '';
  popup.querySelector('.place-name').textContent = pin.place ?? '알 수 없는 위치';
  popup.querySelector('.coords').textContent = `${pin.lat.toFixed(4)}°, ${pin.lng.toFixed(4)}°`;
  popup.querySelector('.popup-date').textContent = pin.date ?? '날짜 정보 없음';
  updatePopupTransport(pin);
  updatePopupTags(pin.tags);
  updatePopupCaption(pin.caption ?? '');
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

function updatePopupCaption(caption) {
  const el = document.getElementById('popup-caption');
  if (!el) return;
  if (caption) {
    el.textContent = caption;
    el.classList.add('visible');
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
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
  const item = findSidebarItem(id);
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── Health check ──────────────────────────────────────────
function setupHealth() {
  setInterval(checkHealth, 30000);
  return checkHealth();
}

async function checkHealth() {
  const dotFlask  = document.getElementById('dot-flask');
  const dotOllama = document.getElementById('dot-ollama');
  try {
    const res  = await fetch(`${FLASK}/health`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    const requiredMap = data.required_models ?? {};
    const required = Object.values(requiredMap);
    const missing = required.filter(m => !m.available).map(m => m.name);
    aiStatus = {
      ollama: Boolean(data.ollama),
      vision: Boolean(requiredMap.vision?.available),
      rerank: Boolean(requiredMap.rerank?.available),
      missing,
    };
    dotFlask.className  = 'health-dot ' + (data.flask  ? 'ok' : 'err');
    dotOllama.className = 'health-dot ' + (data.ollama && !missing.length ? 'ok' : 'err');
    dotFlask.title  = data.flask  ? 'Flask 서버 정상' : 'Flask 서버 오류';
    dotOllama.title = data.ollama
      ? (missing.length
          ? `Ollama 연결됨 — 필요한 모델 없음: ${missing.join(', ')}`
          : `Ollama 정상 (${data.models?.length ?? 0}개 모델)`)
      : 'Ollama 연결 안 됨 — AI 기능 비활성화';
    updateAiStatusPanel();
  } catch {
    aiStatus = { ollama: false, vision: false, rerank: false, missing: [] };
    dotFlask.className  = 'health-dot err';
    dotOllama.className = 'health-dot err';
    updateAiStatusPanel();
  }
}

function setAiStatusValue(id, ok, readyText, missingText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? readyText : missingText;
  el.className = 'ai-status-value ' + (ok ? 'ok' : 'err');
}

function updateAiStatusPanel() {
  setAiStatusValue('ai-status-ollama', aiStatus.ollama, '연결됨', '연결 안 됨');
  setAiStatusValue('ai-status-vision', aiStatus.vision, 'VLM 사용 가능', 'VLM 모델 없음');
  setAiStatusValue('ai-status-rerank', aiStatus.rerank, '사용 가능', '모델 없음');

  const hint = document.getElementById('ai-status-hint');
  if (!hint) return;
  if (!aiStatus.ollama) {
    hint.textContent = 'Ollama를 실행하면 로컬 AI 기능을 사용할 수 있습니다.';
  } else if (aiStatus.missing.length) {
    hint.textContent = `필요 모델: ollama pull ${aiStatus.missing.join(' && ollama pull ')}`;
  } else {
    hint.textContent = 'VLM은 GPS 없는 사진의 장소 후보를 보강합니다. 태그·캡션은 사진 상세에서 필요할 때 생성됩니다.';
  }
  updateAiEnrichState();
}

// ── Date filter ───────────────────────────────────────────
function setupDateFilter() {
  const fromEl  = document.getElementById('date-from');
  const toEl    = document.getElementById('date-to');
  const clearEl = document.getElementById('date-clear');

  fromEl.addEventListener('change', applyDateFilter);
  toEl.addEventListener('change',   applyDateFilter);
  clearEl.addEventListener('click', () => {
    fromEl.value = '';
    toEl.value   = '';
    activeDateFrom = null;
    activeDateTo   = null;
    applyVisibility();
    refreshPoints();
  });
}

function applyDateFilter() {
  const fromEl = document.getElementById('date-from');
  const toEl   = document.getElementById('date-to');
  activeDateFrom = fromEl.value ? parseInt(fromEl.value) : null;
  activeDateTo   = toEl.value   ? parseInt(toEl.value)   : null;
  applyVisibility();
  refreshPoints();
}

function pinYear(pin) {
  if (!pin?.date) return null;
  const m = pin.date.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

function pinMatchesDateFilter(pin) {
  const year = pinYear(pin);
  if (year == null) return true;
  if (activeDateFrom && year < activeDateFrom) return false;
  if (activeDateTo   && year > activeDateTo)   return false;
  return true;
}

function applyVisibility() {
  sidebarItems().forEach(item => {
    const id  = parseInt(item.dataset.id);
    const pin = getPinById(id);
    const scopeOk = sidebarItemMatchesScope(item, pin);
    const tagOk  = !activeFilter || pin?.tags?.includes(activeFilter);
    const dateOk = pinMatchesDateFilter(pin);
    item.style.display = (scopeOk && tagOk && dateOk) ? '' : 'none';
  });
}

function updateDateFilterSection() {
  const section = document.getElementById('date-filter-section');
  const pins    = getAllPins().filter(p => p.date);
  if (!section) return;
  section.style.display = pins.length >= 2 ? '' : 'none';
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
function isSupportedImageFile(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  return ALLOWED_EXT.has(ext);
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

