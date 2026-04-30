let globeInstance = null;
let pins = [];
let arcsVisible = false;

// ── Tour state ────────────────────────────────────────────
let tourAnimId   = null;
let tourRunning  = false;
let planeVisible = false;

const TAG_COLORS = {
  '음식': '#f97316', '풍경': '#22c55e', '인물': '#a78bfa',
  '건축': '#facc15', '자연': '#34d399', '도시': '#60a5fa',
  '교통': '#94a3b8', '동물': '#f472b6', '실내': '#c084fc', '야경': '#818cf8',
};
const DEFAULT_PIN_COLOR = '#3b82f6';

// ── Init ──────────────────────────────────────────────────
function initGlobe(containerId) {
  const el = document.getElementById(containerId);

  globeInstance = Globe()(el)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    // Points
    .pointsData([])
    .pointLat('lat').pointLng('lng').pointColor('color')
    .pointRadius('radius').pointAltitude(0.01).pointLabel('label')
    .onPointClick(onPinClick).onPointHover(onPinHover)
    // Arcs
    .arcsData([])
    .arcStartLat('startLat').arcStartLng('startLng')
    .arcEndLat('endLat').arcEndLng('endLng')
    .arcColor('color').arcStroke(0.5)
    .arcDashLength(0.4).arcDashGap(0.2)
    .arcDashAnimateTime(2000).arcAltitudeAutoScale(0.4)
    // Plane (HTML element)
    .htmlElementsData([])
    .htmlLat('lat').htmlLng('lng').htmlAltitude('alt')
    .htmlElement(d => {
      const el = document.createElement('div');
      el.className = 'plane-marker';
      el.innerHTML = '✈';
      el.style.cssText = `
        font-size: 22px;
        color: #fff;
        text-shadow: 0 0 8px #60a5fa, 0 0 16px #3b82f6;
        pointer-events: none;
        transition: transform 0.1s;
        transform: rotate(${d.heading ?? 0}deg);
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));
      `;
      return el;
    });

  globeInstance.controls().autoRotate = true;
  globeInstance.controls().autoRotateSpeed = 0.4;

  return globeInstance;
}

// ── Points ────────────────────────────────────────────────
function pinColor(tags) {
  if (!tags?.length) return DEFAULT_PIN_COLOR;
  return TAG_COLORS[tags[0]] ?? DEFAULT_PIN_COLOR;
}

function addPin(pinData) {
  pins.push(pinData);
  refreshPoints();
  if (arcsVisible) refreshArcs();
}

function updatePin(id, updates) {
  const idx = pins.findIndex(p => p.id === id);
  if (idx === -1) return;
  pins[idx] = { ...pins[idx], ...updates };
  refreshPoints();
  if (arcsVisible) refreshArcs();
}

function replaceAllPins(newPins) {
  pins = newPins;
  refreshPoints();
  if (arcsVisible) refreshArcs();
}

function refreshPoints() {
  if (!globeInstance) return;
  globeInstance.pointsData(pins.map(p => ({
    lat: p.lat, lng: p.lng,
    color: pinColor(p.tags),
    radius: 0.5,
    label: p.place ?? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`,
    _id: p.id,
  })));
}

// ── Arcs ──────────────────────────────────────────────────
function sortedPins() {
  return [...pins]
    .filter(p => p.lat != null)
    .sort((a, b) => (a.date && b.date) ? a.date.localeCompare(b.date) : a.id - b.id);
}

function buildArcs() {
  const sp = sortedPins();
  const arcs = [];
  for (let i = 0; i < sp.length - 1; i++) {
    arcs.push({
      startLat: sp[i].lat, startLng: sp[i].lng,
      endLat:   sp[i+1].lat, endLng: sp[i+1].lng,
      color: ['rgba(59,130,246,0.6)', 'rgba(139,92,246,0.6)'],
    });
  }
  return arcs;
}

function refreshArcs() {
  if (!globeInstance) return;
  globeInstance.arcsData(arcsVisible ? buildArcs() : []);
}

function toggleArcs() {
  arcsVisible = !arcsVisible;
  refreshArcs();
  return arcsVisible;
}

// ── Plane (Great Circle animation) ───────────────────────

// 구면 선형보간(SLERP) — 대권 경로 상의 위도/경도 반환
function greatCircleLerp(lat1, lng1, lat2, lng2, t) {
  const toR = d => d * Math.PI / 180;
  const toD = r => r * 180 / Math.PI;

  const φ1 = toR(lat1), λ1 = toR(lng1);
  const φ2 = toR(lat2), λ2 = toR(lng2);

  const v1 = [Math.cos(φ1)*Math.cos(λ1), Math.cos(φ1)*Math.sin(λ1), Math.sin(φ1)];
  const v2 = [Math.cos(φ2)*Math.cos(λ2), Math.cos(φ2)*Math.sin(λ2), Math.sin(φ2)];

  const dot = Math.min(1, Math.max(-1, v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]));
  const omega = Math.acos(dot);

  if (omega < 1e-5) return { lat: lat1, lng: lng1, heading: 0 };

  const sinO = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinO;
  const b = Math.sin(t * omega) / sinO;

  const x = a*v1[0] + b*v2[0];
  const y = a*v1[1] + b*v2[1];
  const z = a*v1[2] + b*v2[2];

  const lat = toD(Math.atan2(z, Math.sqrt(x*x + y*y)));
  const lng = toD(Math.atan2(y, x));

  // 비행 방위각 계산 (✈ 이모지 회전용)
  const heading = bearingTo(lat1, lng1, lat2, lng2);

  return { lat, lng, heading };
}

function bearingTo(lat1, lng1, lat2, lng2) {
  const toR = d => d * Math.PI / 180;
  const dLng = toR(lng2 - lng1);
  const φ1 = toR(lat1), φ2 = toR(lat2);
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function setPlanePos(lat, lng, alt, heading) {
  if (!globeInstance) return;
  globeInstance.htmlElementsData([{ lat, lng, alt, heading }]);
  // 이모지 회전 갱신
  const el = document.querySelector('.plane-marker');
  if (el) el.style.transform = `rotate(${heading + 90}deg)`;
}

function hidePlane() {
  if (!globeInstance) return;
  globeInstance.htmlElementsData([]);
  planeVisible = false;
}

// 한 구간 비행 애니메이션 — Promise 반환
function flyLeg(fromLat, fromLng, toLat, toLng, duration) {
  const MAX_ALT = 0.07;
  const start = performance.now();

  return new Promise(resolve => {
    function frame(now) {
      if (!tourRunning) return resolve('stopped');
      const t = Math.min(1, (now - start) / duration);
      const { lat, lng, heading } = greatCircleLerp(fromLat, fromLng, toLat, toLng, t);
      const alt = MAX_ALT * Math.sin(t * Math.PI); // 이륙·착륙 포물선

      setPlanePos(lat, lng, alt, heading);

      if (t < 1) {
        tourAnimId = requestAnimationFrame(frame);
      } else {
        resolve('done');
      }
    }
    tourAnimId = requestAnimationFrame(frame);
  });
}

// 전체 투어 — 날짜순으로 핀을 순회
async function startTour({ onArrive, onComplete, speed = 1 }) {
  if (tourRunning) return;
  const sp = sortedPins();
  if (sp.length < 2) return;

  tourRunning  = true;
  planeVisible = true;
  globeInstance.controls().autoRotate = false;

  // 첫 번째 핀으로 이동 후 시작
  globeInstance.pointOfView({ lat: sp[0].lat, lng: sp[0].lng, altitude: 2.5 }, 800);
  await sleep(900);
  onArrive?.(sp[0], 0, sp.length);

  for (let i = 0; i < sp.length - 1; i++) {
    if (!tourRunning) break;

    const from = sp[i];
    const to   = sp[i + 1];

    // 거리에 비례한 비행 시간 (기본 4초, speed로 조절)
    const dist     = haversine(from.lat, from.lng, to.lat, to.lng);
    const duration = Math.max(2000, Math.min(8000, dist * 3)) / speed;

    // 카메라를 두 핀 중간 위로
    const midLat = (from.lat + to.lat) / 2;
    const midLng = (from.lng + to.lng) / 2;
    globeInstance.pointOfView({ lat: midLat, lng: midLng, altitude: 3 }, duration * 0.3);

    const result = await flyLeg(from.lat, from.lng, to.lat, to.lng, duration);
    if (result === 'stopped') break;

    // 도착
    globeInstance.pointOfView({ lat: to.lat, lng: to.lng, altitude: 2 }, 800);
    await sleep(500);
    onArrive?.(to, i + 1, sp.length);
    await sleep(2200 / speed);
  }

  hidePlane();
  tourRunning = false;
  onComplete?.();
}

function stopTour() {
  tourRunning = false;
  if (tourAnimId) { cancelAnimationFrame(tourAnimId); tourAnimId = null; }
  hidePlane();
}

// ── Helpers ───────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Camera ───────────────────────────────────────────────
function flyTo(lat, lng) {
  if (!globeInstance) return;
  globeInstance.controls().autoRotate = false;
  globeInstance.pointOfView({ lat, lng, altitude: 2 }, 1000);
}

function flyToAll() {
  if (!globeInstance || !pins.length) return;
  globeInstance.controls().autoRotate = false;
  const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
  const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
  globeInstance.pointOfView({ lat, lng, altitude: 2.5 }, 1200);
}

// ── Events ────────────────────────────────────────────────
function onPinClick(point, event) {
  const pin = pins.find(p => p.id === point._id);
  if (pin) {
    window.dispatchEvent(new CustomEvent('pindrop:pinclick', {
      detail: { pin, clientX: event?.clientX, clientY: event?.clientY },
    }));
  }
}

function onPinHover(point) {
  document.body.style.cursor = point ? 'pointer' : 'default';
}

function getPinById(id) { return pins.find(p => p.id === id); }
function getAllPins()    { return [...pins]; }
function isTourRunning(){ return tourRunning; }
