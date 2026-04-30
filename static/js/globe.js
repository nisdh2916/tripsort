let globeInstance = null;
let pins = [];

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
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointRadius('radius')
    .pointAltitude(0.01)
    .pointLabel('label')
    .onPointClick(onPinClick)
    .onPointHover(onPinHover);

  // 자동 회전
  globeInstance.controls().autoRotate = true;
  globeInstance.controls().autoRotateSpeed = 0.4;

  return globeInstance;
}

function pinColor(tags) {
  if (!tags || tags.length === 0) return DEFAULT_PIN_COLOR;
  return TAG_COLORS[tags[0]] ?? DEFAULT_PIN_COLOR;
}

function addPin(pinData) {
  // pinData: { id, lat, lng, place, date, filename, url, tags }
  pins.push(pinData);
  refreshPoints();
}

function updatePin(id, updates) {
  const idx = pins.findIndex(p => p.id === id);
  if (idx === -1) return;
  pins[idx] = { ...pins[idx], ...updates };
  refreshPoints();
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

function flyTo(lat, lng) {
  if (!globeInstance) return;
  globeInstance.controls().autoRotate = false;
  globeInstance.pointOfView({ lat, lng, altitude: 2 }, 1000);
}

function onPinClick(point) {
  const pin = pins.find(p => p.id === point._id);
  if (pin) {
    window.dispatchEvent(new CustomEvent('pindrop:pinclick', { detail: pin }));
  }
}

function onPinHover(point) {
  document.body.style.cursor = point ? 'pointer' : 'default';
}

function getPinById(id) {
  return pins.find(p => p.id === id);
}

function getAllPins() {
  return [...pins];
}
