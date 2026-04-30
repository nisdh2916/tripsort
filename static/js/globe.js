let globeInstance = null;
let pins = [];
let arcsVisible = false;

const TAG_COLORS = {
  '음식': '#f97316',
  '풍경': '#22c55e',
  '인물': '#a78bfa',
  '건축': '#facc15',
  '자연': '#34d399',
  '도시': '#60a5fa',
  '교통': '#94a3b8',
  '동물': '#f472b6',
  '실내': '#c084fc',
  '야경': '#818cf8',
};

const DEFAULT_PIN_COLOR = '#3b82f6';

function initGlobe(containerId) {
  const el = document.getElementById(containerId);

  globeInstance = Globe()(el)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    // Points
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointRadius('radius')
    .pointAltitude(0.01)
    .pointLabel('label')
    .onPointClick(onPinClick)
    .onPointHover(onPinHover)
    // Arcs
    .arcsData([])
    .arcStartLat('startLat')
    .arcStartLng('startLng')
    .arcEndLat('endLat')
    .arcEndLng('endLng')
    .arcColor('color')
    .arcStroke(0.5)
    .arcDashLength(0.4)
    .arcDashGap(0.2)
    .arcDashAnimateTime(2000)
    .arcAltitudeAutoScale(0.4);

  globeInstance.controls().autoRotate = true;
  globeInstance.controls().autoRotateSpeed = 0.4;

  return globeInstance;
}

function pinColor(tags) {
  if (!tags || tags.length === 0) return DEFAULT_PIN_COLOR;
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
    lat: p.lat,
    lng: p.lng,
    color: pinColor(p.tags),
    radius: 0.5,
    label: p.place ?? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`,
    _id: p.id,
  })));
}

// 날짜순 정렬 후 인접 핀 사이에 arc 생성
function buildArcs() {
  const sorted = [...pins]
    .filter(p => p.lat != null)
    .sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      return a.id - b.id;
    });

  const arcs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    arcs.push({
      startLat: s.lat, startLng: s.lng,
      endLat:   e.lat, endLng:   e.lng,
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

function flyTo(lat, lng) {
  if (!globeInstance) return;
  globeInstance.controls().autoRotate = false;
  globeInstance.pointOfView({ lat, lng, altitude: 2 }, 1000);
}

function flyToAll() {
  if (!globeInstance || !pins.length) return;
  globeInstance.controls().autoRotate = false;
  const lats = pins.map(p => p.lat);
  const lngs = pins.map(p => p.lng);
  const lat  = lats.reduce((a, b) => a + b, 0) / lats.length;
  const lng  = lngs.reduce((a, b) => a + b, 0) / lngs.length;
  globeInstance.pointOfView({ lat, lng, altitude: 2.5 }, 1200);
}

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

function getPinById(id)  { return pins.find(p => p.id === id); }
function getAllPins()     { return [...pins]; }
