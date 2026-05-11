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
const DETAIL_MAP_ASSETS = {
  css: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  js: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
};
const KOREA_LAND_PATH = 'M184.6 50.7L195.3 86.9L212.6 122L227.2 167.7L229 193.6L226.9 202.2L227.6 217.9L225.5 224.3L227.2 241.3L225.2 245.6L228.1 249.2L232.2 242.5L233.5 247.4L227.7 276.1L228.2 285.4L226.5 288.5L224.9 283.9L224.4 297.4L220.8 300.2L217.8 312.4L214.8 312.8L214 317.2L212.6 315L210 320.7L208.3 320.3L208.3 313.8L206.7 317.9L205.9 315L205.3 318L201.7 317.9L201.2 315.7L200.5 318.1L198 316.9L197.9 313.3L197.2 315.4L194.7 313.3L194.1 308L193.1 310.6L196.1 319.5L189.1 316.6L184.9 323.1L189.5 320.3L189.7 324.4L186.8 325.4L187.3 332.4L189 332.4L187.4 336L185.3 336.2L186.6 334.5L183.6 333.7L183.4 328.1L182.1 331.1L179 328.8L178.3 332.4L172.2 329.3L172.8 317.9L170 321.6L170.3 324.7L168.2 325.7L167 322.6L165.6 328.1L159.8 327.1L158.8 324.9L156.5 331.2L153.7 328.2L153 330.6L156.3 338.3L161 335.5L159.7 344.8L156.3 344.4L155 346.9L155.6 352.9L152.4 349.6L153.4 343.3L150.7 332.3L149.4 336.2L144.6 337.4L147 339.2L144.3 342.2L145.8 342.5L150.1 355L144 355.4L144.3 357.7L147.6 358.8L143.1 363.8L143.7 366L138.9 358.3L137.2 360.8L135 358.8L138.5 351.5L137.7 356.2L139.9 355.5L141 346.4L142.6 350.4L144.3 346.9L143.3 343.6L141.6 345.1L139.9 341.7L138 347.4L135.4 347.7L130.4 353.4L125.9 368L122.4 365.5L121.1 355.3L119.1 366.9L115.3 369.7L114.1 376.9L111.3 377.5L111.1 373.8L109.2 373.2L110.7 368.3L108.6 363.9L109.6 361.2L111.7 360.8L111.6 357.1L105.6 359.3L103.8 355.5L103 356.6L101.8 355.1L102.9 353.6L100.8 348.9L102.2 342.8L105.3 354.1L108.1 355.5L108.9 354.1L106.6 350.3L105.4 351.6L105.1 345.9L107.9 346.3L111.4 352.5L111.3 350.3L114.9 352L110.3 345.4L104.6 343L108.4 340.8L111.4 343.3L111.8 339.5L115.5 340.1L116.6 338.6L113 337.6L112.7 331.6L110.5 340.5L109.5 338.2L104.9 339.9L107.5 325.5L104.8 326.5L104.5 329.6L102.6 328.8L102.1 326.2L104 326.2L105 322.9L102.1 317.4L101.5 320.1L100.2 314.8L101.6 313.6L102.6 315.4L103.7 312.3L103.8 316.8L107 322.6L108.1 316.6L104.8 311L104.5 306.1L102.4 306.5L105.1 305.1L106.5 296.2L108.3 298.1L106.7 294.4L109.7 284.5L115.7 280.9L117.7 283.8L116.8 279.7L110.5 280.6L108.7 275.9L116.5 264.3L119.3 264.3L121.3 266.8L121.6 264.4L118.1 260.1L123.5 256.7L122.4 255.3L119.3 257.3L114.5 257L114.4 253.9L111 253.2L110.9 250.9L119.8 249.5L124.8 244L117.7 248.7L113.6 238.8L111.2 237.1L109.7 238.8L111.3 235.6L114.1 235.7L111.4 232.1L113.3 226.5L110.6 224.3L113.3 222.1L110.8 220.5L110 217L114.7 213L109.9 214.9L110.6 208.8L108.8 207.9L108.3 203.8L110.8 201.4L109.2 192.3L107 202.9L104.7 201.2L103.7 192.8L102.1 195.9L103.7 202.7L101.8 204.7L101 194.4L97.1 197.9L96.3 195.7L98.5 193.9L96.3 191.3L95.3 195.6L95.1 191.3L96.6 187.1L98.5 189.7L97.7 187.7L99.6 187.1L97.9 186.6L97.7 181.9L99.4 180.5L99.2 182.8L101 182.7L102.4 175.7L101.3 188.1L104.3 189.2L103.1 184.8L104.6 185.7L106.2 184L105.1 182.5L106.8 179.1L104.2 176.6L104.1 173.2L107.8 173L109.4 185.2L110.8 177.2L113.3 180.9L109.7 173.5L112.9 174.9L110 169.1L115 173.5L115.2 179.9L117.3 173.6L121.8 176.6L121.3 181.5L122.9 179.4L124 191.8L124.5 186.1L126.2 186.7L124.4 183.1L129.6 179.4L131.7 173.7L129.3 174.7L128.8 178.4L126.5 178.6L123 173L126.4 172.2L125.6 166L124 170.4L120.2 169.6L120.6 164.4L124.5 161.9L124.6 159.7L123.2 161.3L122.1 159.3L117.4 163.4L118.3 160.8L116.6 160L118.8 157.2L116.3 154.1L120.7 154.1L121.3 156.6L122.8 152.5L124.8 153L117.6 148.2L118.7 144.3L116.6 143.9L115.6 145.8L114.6 144.6L115.5 142L113.8 137.6L115.8 135.2L114 135L111.4 115.3L116.5 116.1L116.5 122.5L120.2 125.1L117.2 121.5L116.6 102.5L120.5 99.4L128.9 81.3L133.6 76.2L145.1 73.8L148.9 75.5L160.1 73.3L162 75.6L171.6 74.9L179 67.6L181.2 53.7L184.6 50.7Z M127.8 438.9L123.6 451.6L114.3 456.8L103.3 457L100.8 460.1L96.9 454.7L97.2 449.2L100.8 442.1L109.4 435.7L121.7 432.5L127.8 438.9Z M199.9 334L199.7 339.9L197.5 338.6L196.3 342.5L197.8 344L193.4 346.4L194.7 344.8L192.4 340.6L194.2 336.5L191.2 338.6L189.5 334L192.9 330.9L195.8 332.4L194.4 327.5L197.8 325.2L198.1 321.6L198.6 333.4L199.8 332.6L199.9 334Z M105.2 362L103.8 368.7L102.4 367.6L98.4 372.5L95.8 372.8L94.6 366.7L99.1 359.8L100.7 360.2L99.9 356.2L102.9 359.3L104 358.3L105.2 362Z M172.8 338.1L172.2 346.9L169 346.8L167.5 341.7L166.3 345.8L164.7 345.1L163.1 335.3L165.6 329L167.5 330.6L166.2 334L168.5 338.7L172.8 338.1Z M110.3 128.2L106.4 127.8L104.8 125.6L106.7 124.1L104.8 114L107 111.1L110.7 115.4L111.7 125.6L110.3 128.2Z M112.5 134.4L113.3 136.3L107.7 141.5L104.6 139.9L104.4 137.5L108.9 135.6L110 133.2L112.5 134.4Z M106.2 214.1L107.3 217.9L104.6 217.7L104.6 213L103.1 213.1L102.6 204.8L104.4 202.7L106.2 214.1Z M120.6 376.2L119.3 377.7L116.1 374.7L116.6 369.4L118.4 369.9L120.6 376.2Z M286.1 132.1L285.1 138.9L282.2 135L286.1 132.1Z M136.9 363.1L139.8 364.6L136.8 368L134.4 364.5L136.9 363.1Z M161.3 347.9L162.7 353.1L161.5 355.9L159.4 352.4L161.4 345.4L161.3 347.9Z M39.3 99.3L39.7 101.2L35.8 103.5L35 99.3L39.3 99.3Z M172.9 335.8L168.9 335.8L170.1 330.7L170.5 334L171.8 332.1L172.9 335.8Z M101.8 112.7L103.7 113.5L102.7 115.7L99 115.9L99.9 112L101.8 112.7Z M94.4 320.3L92.2 319.5L92.6 317.1L96 313L94.4 320.3Z M103.6 334.4L103.7 337.5L102.2 335L99.2 335.1L101.9 330.3L103.6 334.4Z M120.5 370.7L121.3 367.4L123.4 366.5L124.4 369.9L121 372.8L120.5 370.7Z M90.3 340.6L86.3 345.3L86.1 341.4L90.3 340.6Z M92.2 330.6L92.8 329.5L93.2 333.9L89.5 334.5L92.2 330.6Z M97 344.3L96.4 346.5L92.8 341.5L97 344.3Z M104.3 120.8L104 123.7L101.3 120.5L102.6 117L104.3 120.8Z M89.6 345.7L88.4 350L86.6 347.7L89.1 344.6L89.6 345.7Z M93.2 337.5L92.7 335.4L95.7 333.2L94.2 339.3L93.2 337.5Z M114.6 154L111.6 158.3L111.7 151.7L114.6 154Z M185.4 337.7L187.5 337.7L186.9 342L183.3 337.3L185.4 337.7Z M99.4 320.6L96.6 316.4L99.4 316.7L100.3 322.5L99.4 320.6Z M124.2 376.3L120.3 374.2L125.4 373.5L124.2 376.3Z M126.4 384.6L126.5 387.7L124.3 387.7L124.7 383.9L126.4 384.6Z M114 386.8L114.5 388.1L110.7 390L111.3 386.1L114 386.8Z M151.3 365.6L149.8 368.3L148.1 364.1L151.3 365.6Z M94 354.5L94 357.4L91.4 359.3L92.7 352.4L94 354.5Z M161.3 361.3L160.8 362.7L158.5 358.6L159.9 358L161.3 361.3Z';

let mapMode = 'global';
let mapConfigPromise = null;
let detailMap = null;
let detailMapReady = false;
let detailMapMarkers = new Map();
let lastPointData = [];
let lastArcData = [];

function createKoreaMapSurface(el) {
  el.innerHTML = '';
  el.dataset.mapView = 'korea';
  el.dataset.pointCount = '0';
  el.dataset.lastPoints = '[]';

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('korea-map-surface');
  svg.setAttribute('viewBox', '0 0 360 520');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '대한민국 지도');

  const sea = document.createElementNS(ns, 'rect');
  sea.setAttribute('width', '360');
  sea.setAttribute('height', '520');
  sea.setAttribute('fill', '#082f49');
  svg.appendChild(sea);

  const land = document.createElementNS(ns, 'path');
  land.classList.add('korea-map-land');
  land.setAttribute('d', KOREA_LAND_PATH);
  land.setAttribute('fill', '#14532d');
  land.setAttribute('stroke', '#86efac');
  land.setAttribute('stroke-width', '2');
  land.setAttribute('stroke-linejoin', 'round');
  land.setAttribute('stroke-linecap', 'round');
  svg.appendChild(land);

  const routes = document.createElementNS(ns, 'g');
  routes.classList.add('korea-map-routes');
  svg.appendChild(routes);

  const points = document.createElementNS(ns, 'g');
  points.classList.add('korea-map-points');
  svg.appendChild(points);

  el.appendChild(svg);
  const detail = document.createElement('div');
  detail.className = 'global-map-canvas';
  detail.setAttribute('aria-label', 'Global detail map');
  el.appendChild(detail);
  return svg;
}

function createMapSurface(el) {
  el.innerHTML = '';
  el.dataset.mapView = 'loading';
  el.dataset.pointCount = '0';
  el.dataset.lastPoints = '[]';

  const detail = document.createElement('div');
  detail.className = 'global-map-canvas';
  detail.setAttribute('aria-label', 'Global detail map');
  el.appendChild(detail);

  const placeholder = document.createElement('div');
  placeholder.className = 'map-placeholder';
  placeholder.textContent = '상세 지도를 불러올 수 없습니다. MapTiler 키 설정을 확인해주세요.';
  el.appendChild(placeholder);
  return detail;
}

function renderKoreaPoints(el, data) {
  const layer = el.querySelector('.korea-map-points');
  if (!layer) return;
  layer.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  data.forEach(point => {
    if (point.hidden) return;
    const projected = window.projectKoreaMapPoint?.(point.lat, point.lng);
    if (!projected) return;
    const { x, y } = projected;
    const circle = document.createElementNS(ns, 'circle');
    circle.classList.add('korea-map-pin');
    circle.setAttribute('cx', String(x));
    circle.setAttribute('cy', String(y));
    circle.setAttribute('r', String(Math.max(4, point.radius * 9)));
    circle.setAttribute('fill', point.color);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '1.5');
    circle.addEventListener('click', event => {
      event.stopPropagation();
      onPinClick(point, event);
    });
    layer.appendChild(circle);
  });
}

function renderKoreaRoutes(el, data) {
  const layer = el.querySelector('.korea-map-routes');
  if (!layer) return;
  layer.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  data.forEach(route => {
    const start = window.projectKoreaMapPoint?.(route.startLat, route.startLng);
    const end = window.projectKoreaMapPoint?.(route.endLat, route.endLng);
    if (!start || !end) return;

    const line = document.createElementNS(ns, 'line');
    line.classList.add('korea-map-route');
    line.setAttribute('x1', String(start.x));
    line.setAttribute('y1', String(start.y));
    line.setAttribute('x2', String(end.x));
    line.setAttribute('y2', String(end.y));
    line.dataset.label = route.label;
    layer.appendChild(line);

    const label = document.createElementNS(ns, 'text');
    label.classList.add('korea-map-route-label');
    label.setAttribute('x', String((start.x + end.x) / 2));
    label.setAttribute('y', String((start.y + end.y) / 2 - 6));
    label.textContent = route.label;
    layer.appendChild(label);
  });
}

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function loadDetailMapConfig() {
  if (!mapConfigPromise) {
    mapConfigPromise = fetch('/map-config')
      .then(res => res.ok ? res.json() : null)
      .catch(() => null);
  }
  return mapConfigPromise;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.dataset.loaded === 'true'
        ? resolve()
        : existing.addEventListener('load', resolve, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.loaded = 'false';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadCssOnce(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

async function ensureMapLibre() {
  if (window.maplibregl) return;
  loadCssOnce(DETAIL_MAP_ASSETS.css);
  await loadScriptOnce(DETAIL_MAP_ASSETS.js);
}

function mapReady(map) {
  if (map.loaded?.()) return Promise.resolve();
  return new Promise(resolve => map.on('load', resolve));
}

function detailMapZoom(altitude) {
  if (altitude == null) return 7;
  return Math.max(3, Math.min(13, 11 - altitude * 2));
}

function showMapUnavailable(el) {
  mapMode = 'unavailable';
  el.classList.remove('global-map-active');
  el.classList.add('map-unavailable');
  el.dataset.mapView = 'unavailable';
}

async function activateGlobalMap(el, options = {}) {
  const config = await loadDetailMapConfig();
  if (!config?.enabled || !config.styleUrl) {
    showMapUnavailable(el);
    if (!options.silent && typeof toast === 'function') {
      toast('Set PINDROP_MAPTILER_KEY to enable the global detail map.', 'error');
    }
    return false;
  }

  try {
    await ensureMapLibre();
  } catch {
    showMapUnavailable(el);
    if (!options.silent && typeof toast === 'function') toast('Global detail map failed to load.', 'error');
    return false;
  }

  const canvas = el.querySelector('.global-map-canvas');
  mapMode = 'global';
  el.classList.remove('map-unavailable');
  el.classList.add('global-map-active');
  el.dataset.mapView = 'global';

  if (!detailMap) {
    detailMap = new maplibregl.Map({
      container: canvas,
      style: config.styleUrl,
      center: [127.8, 36.5],
      zoom: 5.2,
      attributionControl: true,
    });
    if (maplibregl.NavigationControl) {
      detailMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }
    await mapReady(detailMap);
    detailMapReady = true;
  }

  detailMap.resize?.();
  detailMap.flyTo?.({ center: [127.8, 36.5], zoom: 5.2, duration: 0 });
  renderGlobalPoints(el, lastPointData);
  renderGlobalRoutes(lastArcData);
  fitGlobalMapToPoints(lastPointData, { duration: 0 });
  return true;
}

function deactivateGlobalMap(el) {
  mapMode = 'korea';
  el.classList.remove('global-map-active');
  el.dataset.mapView = 'korea';
  return false;
}

async function toggleGlobalMapMode() {
  const el = document.getElementById('globe');
  if (!el) return false;
  return activateGlobalMap(el);
}

function renderGlobalPoints(el, data) {
  if (!detailMap || !detailMapReady) return;
  const nextIds = new Set();
  data.forEach(point => {
    if (point.hidden || !validPoint(point)) return;
    const id = String(point._id);
    nextIds.add(id);
    let marker = detailMapMarkers.get(id);
    if (!marker) {
      const markerEl = document.createElement('button');
      markerEl.type = 'button';
      markerEl.className = 'global-map-pin';
      markerEl.addEventListener('click', event => {
        event.stopPropagation();
        onPinClick(point, event);
      });
      marker = new maplibregl.Marker({ element: markerEl })
        .setLngLat([point.lng, point.lat])
        .addTo(detailMap);
      detailMapMarkers.set(id, marker);
    }
    const markerEl = marker.getElement?.() || marker._element;
    if (markerEl) {
      markerEl.style.background = point.color;
      markerEl.dataset.id = id;
      markerEl.dataset.lat = String(point.lat);
      markerEl.dataset.lng = String(point.lng);
      markerEl.title = point.label || '';
    }
    marker.setLngLat?.([point.lng, point.lat]);
  });

  detailMapMarkers.forEach((marker, id) => {
    if (!nextIds.has(id)) {
      marker.remove();
      detailMapMarkers.delete(id);
    }
  });
  el.dataset.globalPointCount = String(nextIds.size);
}

function routeFeatures(data) {
  return {
    type: 'FeatureCollection',
    features: data
      .filter(route => Number.isFinite(route.startLat) && Number.isFinite(route.startLng) &&
        Number.isFinite(route.endLat) && Number.isFinite(route.endLng))
      .map(route => ({
        type: 'Feature',
        properties: { label: route.label },
        geometry: {
          type: 'LineString',
          coordinates: [
            [route.startLng, route.startLat],
            [route.endLng, route.endLat],
          ],
        },
      })),
  };
}

function renderGlobalRoutes(data) {
  if (!detailMap || !detailMapReady) return;
  const sourceId = 'tripsort-routes';
  const layerId = 'tripsort-routes-line';
  const geojson = routeFeatures(data);
  const source = detailMap.getSource?.(sourceId);
  if (source) {
    source.setData(geojson);
    return;
  }
  detailMap.addSource(sourceId, { type: 'geojson', data: geojson });
  detailMap.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': '#facc15',
      'line-width': 3,
      'line-dasharray': [1.5, 1.2],
    },
  });
}

function fitGlobalMapToPoints(data, options = {}) {
  if (!detailMap || !detailMapReady) return;
  const visible = data.filter(point => !point.hidden && validPoint(point));
  if (!visible.length) return;
  if (visible.length === 1) {
    detailMap.flyTo?.({
      center: [visible[0].lng, visible[0].lat],
      zoom: 7,
      duration: options.duration ?? 800,
    });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  visible.forEach(point => bounds.extend([point.lng, point.lat]));
  detailMap.fitBounds?.(bounds, {
    padding: 70,
    maxZoom: 9,
    duration: options.duration ?? 800,
  });
}

// ── Init ──────────────────────────────────────────────────
function initGlobe(containerId) {
  const el = document.getElementById(containerId);
  createMapSurface(el);
  const controls = { autoRotate: false, autoRotateSpeed: 0 };

  globeInstance = {
    controls: () => controls,
    pointOfView(view) {
      if (view) el.dataset.lastPointOfView = JSON.stringify(view);
      if (view && mapMode === 'global' && detailMapReady && detailMap) {
        detailMap.flyTo?.({
          center: [view.lng, view.lat],
          zoom: detailMapZoom(view.altitude),
          duration: 1000,
        });
      }
      return globeInstance;
    },
    pointsData(data) {
      const pointData = data || [];
      const mapPointData = pointData.filter(validPoint);
      lastPointData = pointData;
      el.dataset.pointCount = String(mapPointData.length);
      el.dataset.lastPoints = JSON.stringify(mapPointData);
      renderGlobalPoints(el, pointData);
      return globeInstance;
    },
    arcsData(data) {
      lastArcData = data || [];
      el.dataset.arcCount = String((data || []).length);
      renderGlobalRoutes(data || []);
      return globeInstance;
    },
    htmlElementsData(data) {
      el.dataset.htmlElementCount = String((data || []).length);
      return globeInstance;
    },
  };

  activateGlobalMap(el, { silent: true });
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
  const hasSearch = searchIds.size > 0;
  globeInstance.pointsData(pins.map(p => {
    const isMatch = searchIds.has(p.id);
    const passesFilters = pinMatchesActiveFilters(p);
    return {
      lat:    p.lat,
      lng:    p.lng,
      color:  hasSearch
        ? (isMatch ? pinColor(p.tags) : 'rgba(100,100,100,0.25)')
        : (passesFilters ? pinColor(p.tags) : 'rgba(100,100,100,0.25)'),
      radius: hasSearch ? (isMatch ? 0.8 : 0.3) : (passesFilters ? 0.5 : 0.3),
      label:  p.place ?? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`,
      _id:    p.id,
      hidden: typeof pinHiddenByScopeFilter === 'function' && pinHiddenByScopeFilter(p),
    };
  }));
}

function pinMatchesActiveFilters(pin) {
  const scopeOk = typeof pinMatchesScopeFilter !== 'function' || pinMatchesScopeFilter(pin);
  const tagOk = typeof activeFilter === 'undefined' || !activeFilter || pin?.tags?.includes(activeFilter);
  const dateOk = typeof pinMatchesDateFilter !== 'function' || pinMatchesDateFilter(pin);
  return scopeOk && tagOk && dateOk;
}

// ── Arcs ──────────────────────────────────────────────────
function sortedPins() {
  return [...pins]
    .filter(p => p.lat != null)
    .sort((a, b) => (a.date && b.date) ? a.date.localeCompare(b.date) : a.id - b.id);
}

function sortedDomesticRoutePins() {
  return [...pins]
    .filter(p => p.lat != null && p.lng != null && p.date)
    .filter(p => typeof pinRegionScope !== 'function' || pinRegionScope(p) === 'domestic')
    .filter(p => typeof pinMatchesActiveFilters !== 'function' || pinMatchesActiveFilters(p))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function buildArcs() {
  const sp = sortedDomesticRoutePins();
  const arcs = [];
  for (let i = 0; i < sp.length - 1; i++) {
    arcs.push({
      startLat: sp[i].lat, startLng: sp[i].lng,
      endLat:   sp[i+1].lat, endLng: sp[i+1].lng,
      color: ['rgba(59,130,246,0.6)', 'rgba(139,92,246,0.6)'],
      label: typeof transportRouteLabel === 'function'
        ? transportRouteLabel(sp[i].transportMode)
        : '이동',
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
  if (mapMode === 'global') {
    fitGlobalMapToPoints(lastPointData);
    return;
  }
  const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
  const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
  globeInstance.pointOfView({ lat, lng, altitude: 2.5 }, 1200);
}

// ── Events ────────────────────────────────────────────────
function onPinClick(point, event) {
  const pin = pins.find(p => p.id === point._id);
  if (pin) {
    window.dispatchEvent(new CustomEvent('tripsort:pinclick', {
      detail: { pin, clientX: event?.clientX, clientY: event?.clientY },
    }));
  }
}

function onPinHover(point) {
  document.body.style.cursor = point ? 'pointer' : 'default';
}

// ── Search highlight ──────────────────────────────────────
let searchIds = new Set();

function setSearchHighlight(ids) {
  searchIds = new Set(ids);
  refreshPoints();
}

function getPinById(id) { return pins.find(p => p.id === id); }
function getAllPins()    { return [...pins]; }
function isTourRunning(){ return tourRunning; }
