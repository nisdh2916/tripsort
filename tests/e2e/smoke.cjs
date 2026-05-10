const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright');

const baseUrl = process.env.PINDROP_BASE_URL || 'http://localhost:5000';
const python = process.env.PYTHON || 'python';

function requestOk(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    if (await requestOk(url)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureServer() {
  if (await requestOk(`${baseUrl}/`)) return null;

  const child = spawn(python, ['app.py'], {
    cwd: process.cwd(),
    env: { ...process.env, FLASK_ENV: 'production', PINDROP_USE_RELOADER: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });

  if (!(await waitForServer(`${baseUrl}/`))) {
    child.kill();
    throw new Error('Flask server did not start');
  }

  return child;
}

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    let uploadRequests = 0;
    const persistedPins = [];
    const indexRequests = [];
    let reindexRequests = 0;
    const searchRequests = [];
    let searchMode = 'match';
    let reverseGeocodeRequests = 0;
    const deletedPinIds = [];
    const reverseGeocodeTimes = [];

    await page.route('https://unpkg.com/globe.gl', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.Globe = function () {
            return function (el) {
              const canvas = document.createElement('canvas');
              canvas.width = 320;
              canvas.height = 180;
              canvas.style.width = '100%';
              canvas.style.height = '100%';
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#0f4c81';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              el.appendChild(canvas);
              const controls = { autoRotate: false, autoRotateSpeed: 0 };
              const api = {
                controls: () => controls,
                pointOfView: () => api,
                globeImageUrl: url => {
                  el.dataset.globeImageUrl = url;
                  return api;
                },
                bumpImageUrl: url => {
                  el.dataset.bumpImageUrl = url;
                  return api;
                },
                backgroundImageUrl: url => {
                  el.dataset.backgroundImageUrl = url;
                  return api;
                },
                pointsData: data => {
                  el.dataset.pointCount = String((data || []).length);
                  el.dataset.lastPoints = JSON.stringify(data || []);
                  return api;
                },
                arcsData: () => api,
                htmlElementsData: () => api
              };
              [
                'pointLat', 'pointLng', 'pointColor', 'pointRadius',
                'pointAltitude', 'pointLabel', 'onPointClick', 'onPointHover',
                'arcStartLat', 'arcStartLng', 'arcEndLat', 'arcEndLng',
                'arcColor', 'arcStroke', 'arcDashLength', 'arcDashGap',
                'arcDashAnimateTime', 'arcAltitudeAutoScale', 'htmlLat',
                'htmlLng', 'htmlAltitude', 'htmlElement'
              ].forEach(name => { api[name] = () => api; });
              return api;
            };
          };
        `,
      });
    });

    await page.route('https://cdn.jsdelivr.net/npm/exifr/dist/full.umd.js', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: 'window.exifr = { parse: async () => null };',
      });
    });

    await page.route('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css', route => {
      route.fulfill({ contentType: 'text/css', body: '.maplibregl-map{}' });
    });

    await page.route('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.maplibregl = {
            Map: function (options) {
              this._container = options.container;
              this._sources = {};
              this._container.dataset.maplibreInitialized = 'true';
              this._container.dataset.maplibreStyle = options.style;
              this._container.dataset.maplibreCenter = JSON.stringify(options.center);
              this.loaded = () => true;
              this.on = (_event, cb) => { setTimeout(cb, 0); return this; };
              this.addControl = () => this;
              this.resize = () => { this._container.dataset.maplibreResized = 'true'; };
              this.flyTo = options => {
                this._container.dataset.maplibreFlyTo = JSON.stringify(options);
                return this;
              };
              this.fitBounds = (bounds, options) => {
                this._container.dataset.maplibreFitBounds = JSON.stringify({
                  bounds: bounds.points,
                  options,
                });
                return this;
              };
              this.addSource = (id, source) => {
                const datasetKey = 'source' + id.replace(/[^a-zA-Z0-9]/g, '');
                this._container.dataset[datasetKey] = JSON.stringify(source.data);
                this._sources[id] = {
                  setData: data => {
                    this._container.dataset[datasetKey] = JSON.stringify(data);
                  },
                };
                return this;
              };
              this.getSource = id => this._sources[id];
              this.addLayer = layer => {
                this._container.dataset['layer' + layer.id.replace(/[^a-zA-Z0-9]/g, '')] = 'true';
                return this;
              };
              this.getLayer = id => this._container.dataset['layer' + id.replace(/[^a-zA-Z0-9]/g, '')] ? {} : null;
            },
            Marker: function ({ element }) {
              this._element = element;
              this.setLngLat = lngLat => {
                this._lngLat = lngLat;
                element.dataset.lngLat = JSON.stringify(lngLat);
                return this;
              };
              this.addTo = map => {
                map._container.appendChild(element);
                return this;
              };
              this.getElement = () => element;
              this.remove = () => element.remove();
            },
            NavigationControl: function () {},
            LngLatBounds: function () {
              this.points = [];
              this.extend = point => {
                this.points.push(point);
                return this;
              };
            },
          };
        `,
      });
    });

    await page.route(`${baseUrl}/favicon.ico`, route => {
      route.fulfill({ status: 204, body: '' });
    });

    await page.route(`${baseUrl}/map-config`, route => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          provider: 'maptiler',
          apiKey: 'test-key',
          styleUrl: 'https://api.maptiler.com/maps/streets-v2/style.json?key=test-key',
        }),
      });
    });

    await page.route(`${baseUrl}/health`, route => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          flask: true,
          ollama: true,
          models: ['llama3.2:latest'],
          indexed: 0,
          required_models: {
            rerank: { name: 'llama3.2', available: true },
            vision: { name: 'llama3.2-vision', available: false },
          },
        }),
      });
    });

    await page.route(`${baseUrl}/pins`, route => {
      if (route.request().method() === 'POST') {
        persistedPins.push(route.request().postDataJSON());
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      if (route.request().method() !== 'GET') return route.continue();
      if (deletedPinIds.includes(42)) {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 42,
            lat: 37.5665,
            lng: 126.978,
            place: '서울특별시',
            date: '2026년 4월 30일',
            filename: 'sample.jpg',
            tags: ['도시', '야경'],
            caption: '서울 도심 야경 사진',
          },
        ]),
      });
    });

    await page.route(`${baseUrl}/pins/42`, route => {
      deletedPinIds.push(42);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`${baseUrl}/pins/47`, route => {
      deletedPinIds.push(47);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`${baseUrl}/pins/52`, route => {
      deletedPinIds.push(52);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`${baseUrl}/uploads/sample.jpg`, route => {
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8e/fufwAJ9gPycVqXWQAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
    });
    await page.route(`${baseUrl}/upload`, route => {
      uploadRequests += 1;
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ filename: 'uploaded.jpg', url: '/uploads/uploaded.jpg' }),
      });
    });
    await page.route(`${baseUrl}/index`, route => {
      indexRequests.push(route.request().postDataJSON());
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route(`${baseUrl}/reindex`, route => {
      reindexRequests += 1;
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, reindexed: 1, total: 1 }),
      });
    });
    await page.route(`${baseUrl}/search`, route => {
      searchRequests.push(route.request().postDataJSON());
      if (searchMode === 'error') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ error: 'local search unavailable' }),
        });
      }
      if (searchMode === 'empty') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pin_ids: [] }) });
      }
      if (searchMode === 'international') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pin_ids: [47] }) });
      }
      if (searchMode === 'mixed') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pin_ids: [46, 47] }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pin_ids: [46] }) });
    });
    await page.route(`${baseUrl}/tag`, route => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ tags: ['음식', '도시'] }),
      });
    });
    await page.route(`${baseUrl}/caption`, route => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ caption: '부산에서 먹은 음식 사진입니다.' }),
      });
    });
    await page.route(`${baseUrl}/reverse-geocode**`, route => {
      reverseGeocodeRequests += 1;
      reverseGeocodeTimes.push(Date.now());
      const url = new URL(route.request().url());
      if (url.searchParams.get('lat') === '0') {
        return route.fulfill({ contentType: 'text/plain', body: 'failed' });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ place: '서울시' }),
      });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pin-item');
    for (let i = 0; i < 20 && reindexRequests === 0; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.equal(reindexRequests, 1);

    assert.equal(await page.locator('h1').innerText(), 'Pindrop');
    assert.equal(await page.locator('#ai-status-ollama').innerText(), '연결됨');
    assert.equal(await page.locator('#ai-status-vision').innerText(), '모델 없음');
    assert.equal(await page.locator('#ai-status-rerank').innerText(), '사용 가능');
    assert.match(await page.locator('#ai-status-hint').innerText(), /ollama pull llama3\.2-vision/);
    await page.waitForFunction(() => document.querySelector('#globe')?.dataset.mapView === 'global');
    assert.equal(await page.locator('#globe .korea-map-surface').count(), 0);
    assert.equal(await page.locator('#map-mode-btn').isHidden(), true);
    assert.equal(await page.locator('#globe .global-map-canvas').getAttribute('data-maplibre-initialized'), 'true');
    assert.equal(await page.locator('#globe .global-map-canvas').getAttribute('data-maplibre-style'), 'https://api.maptiler.com/maps/streets-v2/style.json?key=test-key');
    assert.equal(await page.evaluate(() => {
      const canvas = document.querySelector('#globe .global-map-canvas');
      return canvas.getBoundingClientRect().width > 0 && canvas.getBoundingClientRect().height > 0;
    }), true);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 1);
    assert.deepEqual(await page.evaluate(() => {
      const point = JSON.parse(document.querySelector('#globe').dataset.lastPoints)[0];
      const pin = document.querySelector('#globe .global-map-pin');
      return {
        id: point._id,
        lat: point.lat,
        lng: point.lng,
        lngLat: JSON.parse(pin.dataset.lngLat),
        fit: Boolean(document.querySelector('#globe .global-map-canvas').dataset.maplibreFlyTo),
      };
    }), {
      id: 42,
      lat: 37.5665,
      lng: 126.978,
      lngLat: [126.978, 37.5665],
      fit: true,
    });
    assert.equal(await page.locator('#pin-list .pin-item[data-id="42"]').count(), 1);
    assert.equal(await page.locator('#overseas-empty-state').isVisible(), true);
    assert.equal(await page.locator('#overseas-count').innerText(), '0');
    const sidebarBox = await page.locator('#sidebar').boundingBox();
    const globeBox = await page.locator('.globe-container').boundingBox();
    assert.ok(sidebarBox.x + sidebarBox.width <= globeBox.x + 1);
    assert.match(await page.locator('#pin-count').innerText(), /1개의 핀/);
    assert.equal(await page.locator('.pin-item .place').innerText(), '서울특별시');
    assert.equal(await page.locator('#filter-bar .filter-chip', { hasText: '도시' }).count(), 1);
    assert.equal(await page.locator('#file-input').getAttribute('multiple'), '');
    assert.equal(await page.locator('#file-input').getAttribute('accept'), 'image/*');
    await page.evaluate(() => indexPin({ id: 900, lat: 0, lng: 0 }));
    assert.equal(indexRequests.length, 0);
    assert.deepEqual(await page.evaluate(async () => {
      window.exifr.parse = async () => ({
        latitude: 37.5665,
        longitude: 126.9780,
        DateTimeOriginal: '2026:05:05 12:30:00',
      });
      return extractExif(new File(['fake gps image'], 'gps.jpg', { type: 'image/jpeg' }));
    }), {
      lat: 37.5665,
      lng: 126.978,
      date: '2026년 5월 5일',
    });
    assert.deepEqual(await page.evaluate(() => ({
      city: pinColor(['도시']),
      night: pinColor(['야경']),
      unknown: pinColor(['없는태그']),
      empty: pinColor([]),
    })), {
      city: '#60a5fa',
      night: '#818cf8',
      unknown: '#3b82f6',
      empty: '#3b82f6',
    });
    assert.equal(await page.evaluate(() => reverseGeocode(37.5665, 126.978)), '서울시');
    assert.equal(reverseGeocodeRequests, 1);
    assert.equal(await page.evaluate(() => reverseGeocode(0, 0)), '0.000, 0.000');
    await page.evaluate(() => { window.exifr.parse = async () => null; });

    await page.dispatchEvent('#upload-zone', 'dragover');
    assert.equal(await page.locator('#upload-zone.dragover').count(), 1);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#upload-zone').click();
    const chooser = await chooserPromise;
    await chooser.setFiles([
      {
        name: 'no-gps-one.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake image one'),
      },
      {
        name: 'no-gps-two.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('fake image two'),
      },
    ]);
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item .status'))
        .filter(el => el.textContent === 'GPS 없음').length === 2;
    });
    await page.locator('.toast', { hasText: 'GPS 정보가 없습니다' }).first().waitFor();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['fake dropped image'], 'dropped.jpg', { type: 'image/jpeg' }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.querySelector('#upload-zone').dispatchEvent(event);
    });
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item .status'))
        .filter(el => el.textContent === 'GPS 없음').length === 3;
    });
    assert.equal(uploadRequests, 0);
    assert.match(await page.locator('#pin-count').innerText(), /1개의 핀/);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['plain text'], 'notes.txt', { type: 'text/plain' }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.querySelector('#upload-zone').dispatchEvent(event);
    });
    await page.locator('.toast', { hasText: '지원하지 않는 파일 형식' }).waitFor();
    assert.equal(await page.locator('.pin-item .status', { hasText: 'GPS 없음' }).count(), 3);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      const bytes = new Uint8Array(31 * 1024 * 1024);
      transfer.items.add(new File([bytes], 'too-large.jpg', { type: 'image/jpeg' }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.querySelector('#upload-zone').dispatchEvent(event);
    });
    await page.locator('.toast', { hasText: '파일이 너무 큽니다' }).waitFor();
    assert.equal(await page.locator('.pin-item .status', { hasText: 'GPS 없음' }).count(), 3);

    await page.locator('.pin-item', { hasText: '서울특별시' }).click();
    await page.waitForSelector('#popup.visible');
    assert.equal(await page.locator('#popup .place-name').innerText(), '서울특별시');
    assert.match(await page.locator('#popup .coords').innerText(), /37\.5665/);
    assert.match(await page.locator('#popup .popup-img').getAttribute('src'), /sample\.jpg/);
    assert.equal(await page.locator('#popup .popup-date').innerText(), '2026년 4월 30일');
    assert.equal(await page.locator('#popup .popup-tags .tag', { hasText: '도시' }).count(), 1);
    assert.equal(await page.locator('#popup-caption').innerText(), '서울 도심 야경 사진');

    await page.locator('#popup-delete').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item[data-id="42"]').length === 0);
    assert.equal(await page.locator('#popup.visible').count(), 0);
    assert.deepEqual(deletedPinIds, [42]);
    assert.deepEqual(await page.evaluate(async () => {
      const response = await fetch('/pins');
      return (await response.json()).map(pin => pin.id);
    }), []);
    assert.equal(await page.locator('.pin-item .status', { hasText: 'GPS 없음' }).count(), 3);

    reverseGeocodeTimes.length = 0;
    await page.evaluate(async () => {
      window.exifr.parse = async file => file.name.includes('tokyo')
        ? {
          latitude: 35.6895,
          longitude: 139.6917,
          DateTimeOriginal: '2026:05:05 12:30:00',
        }
        : {
          latitude: 35.1796,
          longitude: 129.0756,
          DateTimeOriginal: '2026:05:05 12:30:00',
        };
      await handleFiles([
        new File(['first gps image'], 'busan-one.jpg', { type: 'image/jpeg' }),
        new File(['second gps image'], 'tokyo-one.jpg', { type: 'image/jpeg' }),
      ]);
    });
    for (let i = 0; i < 20 && indexRequests.length < 2; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.deepEqual(indexRequests.slice(0, 2).map(request => request.id), [46, 47]);
    assert.deepEqual(indexRequests.slice(0, 2).map(request => request.filename), ['uploaded.jpg', 'uploaded.jpg']);
    assert.deepEqual(persistedPins.slice(0, 2).map(pin => ({
      id: pin.id,
      regionScope: pin.regionScope,
      transportMode: pin.transportMode,
    })), [
      { id: 46, regionScope: 'domestic', transportMode: 'unknown' },
      { id: 47, regionScope: 'international', transportMode: 'unknown' },
    ]);
    assert.equal(reverseGeocodeTimes.length, 2);
    assert.ok(
      reverseGeocodeTimes[1] - reverseGeocodeTimes[0] >= 1000,
      `Expected reverse geocode calls to be spaced, got ${reverseGeocodeTimes[1] - reverseGeocodeTimes[0]}ms`,
    );
    assert.match(await page.locator('#pin-count').innerText(), /2개의 핀/);
    assert.equal(await page.locator('#pin-list .pin-item[data-id="46"]').count(), 1);
    assert.equal(await page.locator('#overseas-list .pin-item[data-id="47"]').count(), 1);
    assert.equal(await page.locator('#overseas-empty-state').isVisible(), false);
    assert.equal(await page.locator('#overseas-count').innerText(), '1');
    assert.deepEqual(await page.locator('#overseas-list .pin-item[data-id="47"]').evaluate(item => ({
      hasPlace: Boolean(item.querySelector('.place')?.textContent.trim()),
      hasDate: Boolean(item.querySelector('.date')?.textContent.trim()),
      hasStatus: Boolean(item.querySelector('.status')?.textContent.trim()),
      coords: item.querySelector('.pin-coords')?.textContent.trim(),
    })), {
      hasPlace: true,
      hasDate: true,
      hasStatus: true,
      coords: '35.6895, 139.6917',
    });
    assert.equal(await page.locator('#globe').getAttribute('data-point-count'), '2');
    assert.deepEqual(await page.evaluate(() => {
      return JSON.parse(document.querySelector('#globe').dataset.lastPoints)
        .map(point => ({ lat: point.lat, lng: point.lng }));
    }), [
      { lat: 35.1796, lng: 129.0756 },
      { lat: 35.6895, lng: 139.6917 },
    ]);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    assert.deepEqual(await page.evaluate(() => {
      const pin = document.querySelector('#globe .global-map-pin[data-id="46"]');
      return {
        lngLat: JSON.parse(pin.dataset.lngLat),
        lastView: JSON.parse(document.querySelector('#globe').dataset.lastPointOfView),
      };
    }), {
      lngLat: [129.0756, 35.1796],
      lastView: { lat: 35.6895, lng: 139.6917, altitude: 2 },
    });
    assert.match(await page.locator('#scope-filter [data-scope="all"]').getAttribute('class'), /active/);
    await page.locator('#scope-filter [data-scope="domestic"]').click();
    assert.match(await page.locator('#scope-filter [data-scope="domestic"]').getAttribute('class'), /active/);
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id)
        .sort();
    }), ['46']);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 1);
    await page.locator('#scope-filter [data-scope="international"]').click();
    assert.match(await page.locator('#scope-filter [data-scope="international"]').getAttribute('class'), /active/);
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    }), ['47']);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 1);
    await page.locator('#scope-filter [data-scope="all"]').click();
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id)
        .sort();
    }), ['43', '44', '45', '46', '47']);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    await page.locator('#globe .global-map-pin[data-id="46"]').click();
    await page.waitForSelector('#popup.visible');
    assert.match(await page.locator('#popup .coords').innerText(), /35\.1796/);
    await page.locator('.pin-item[data-id="46"]').click();
    await page.waitForSelector('#popup.visible');
    assert.equal(await page.locator('#transport-field').isVisible(), true);
    assert.deepEqual(await page.locator('#transport-mode option').evaluateAll(options =>
      options.map(option => [option.value, option.textContent])
    ), [
      ['unknown', '알 수 없음'],
      ['bus', '버스'],
      ['ktx', 'KTX'],
      ['srt', 'SRT'],
      ['rail', '일반열차'],
      ['subway', '지하철'],
      ['car', '자동차'],
      ['ferry', '배'],
      ['airplane', '비행기'],
    ]);
    assert.equal(await page.locator('#transport-mode').inputValue(), 'unknown');
    assert.equal(await page.locator('#transport-summary').innerText(), '이동수단 미정');
    assert.equal((await page.locator('#transport-summary').innerText()).includes('비행기'), false);
    for (const [mode, summary] of [
      ['bus', '버스 이동'],
      ['ktx', 'KTX 이동'],
      ['srt', 'SRT 이동'],
      ['rail', '열차 이동'],
      ['subway', '지하철 이동'],
      ['car', '자동차 이동'],
      ['ferry', '배 이동'],
      ['airplane', '비행기 이동'],
    ]) {
      await page.locator('#transport-mode').selectOption(mode);
      assert.equal(await page.locator('#transport-summary').innerText(), summary);
    }
    for (let i = 0; i < 20 && !persistedPins.some(pin => pin.id === 46 && pin.transportMode === 'airplane'); i += 1) {
      await page.waitForTimeout(100);
    }
    assert.equal(await page.evaluate(() => getPinById(46).transportMode), 'airplane');
    await page.locator('#transport-mode').selectOption('ktx');
    for (let i = 0; i < 20 && !persistedPins.some(pin => pin.id === 46 && pin.transportMode === 'ktx'); i += 1) {
      await page.waitForTimeout(100);
    }
    assert.equal(await page.evaluate(() => getPinById(46).transportMode), 'ktx');
    for (let i = 0; i < 20 && !indexRequests.some(request => request.id === 46 && request.transportMode === 'ktx'); i += 1) {
      await page.waitForTimeout(100);
    }
    assert.ok(indexRequests.some(request => request.id === 46 && request.transportMode === 'ktx'));
    await page.locator('#popup-close').click();
    await page.locator('.pin-item[data-id="46"]').click();
    assert.equal(await page.locator('#transport-mode').inputValue(), 'ktx');
    assert.equal(await page.locator('#transport-summary').innerText(), 'KTX 이동');
    await page.evaluate(() => {
      [
        {
          id: 49,
          lat: 37.5665,
          lng: 126.978,
          place: '서울특별시',
          date: '2026년 5월 6일',
          filename: 'route-seoul.jpg',
          tags: [],
          regionScope: 'domestic',
          transportMode: 'unknown',
          url: '',
        },
        {
          id: 50,
          lat: 33.4996,
          lng: 126.5312,
          place: '제주시',
          date: '2026년 5월 7일',
          filename: 'route-jeju.jpg',
          tags: [],
          regionScope: 'domestic',
          transportMode: 'unknown',
          url: '',
        },
      ].forEach(pin => {
        addPin(pin);
        addSidebarItem(pin, false);
      });
      updatePinCount();
      updateFilterBar();
      updateDateFilterSection();
      updateStats();
    });
    await page.locator('#arc-btn').click();
    assert.equal(await page.locator('#globe').getAttribute('data-arc-count'), '2');
    assert.deepEqual(await page.evaluate(() => {
      const source = JSON.parse(document.querySelector('#globe .global-map-canvas').dataset.sourcepindroproutes);
      return source.features.map(feature => feature.properties.label);
    }), ['KTX 이동', '이동']);
    assert.equal(await page.evaluate(() => {
      const source = JSON.parse(document.querySelector('#globe .global-map-canvas').dataset.sourcepindroproutes);
      return source.features.length;
    }), 2);
    await page.locator('#arc-btn').click();
    assert.equal(await page.evaluate(() => {
      const source = JSON.parse(document.querySelector('#globe .global-map-canvas').dataset.sourcepindroproutes);
      return source.features.length;
    }), 0);
    await page.evaluate(() => {
      replaceAllPins(getAllPins().filter(pin => ![49, 50].includes(pin.id)));
      document.querySelectorAll('.pin-item[data-id="49"], .pin-item[data-id="50"]').forEach(el => el.remove());
      refreshListEmptyStates();
      refreshPoints();
      updatePinCount();
      updateFilterBar();
      updateDateFilterSection();
      updateStats();
    });
    await page.evaluate(() => {
      const jejuPin = {
        id: 51,
        lat: 33.4996,
        lng: 126.5312,
        place: '제주시',
        date: '2026년 5월 8일',
        filename: 'jeju-island.jpg',
        tags: [],
        regionScope: 'domestic',
        transportMode: 'ferry',
        url: '',
      };
      addPin(jejuPin);
      addSidebarItem(jejuPin, false);
      updatePinCount();
      updateFilterBar();
      updateDateFilterSection();
      updateStats();
    });
    assert.deepEqual(await page.evaluate(() => {
      const pin = getPinById(51);
      return {
        scope: pinRegionScope(pin),
        transportMode: pin.transportMode,
        projected: Boolean(window.projectKoreaMapPoint(pin.lat, pin.lng)),
      };
    }), {
      scope: 'domestic',
      transportMode: 'ferry',
      projected: true,
    });
    await page.evaluate(() => updatePin(51, { transportMode: 'airplane' }));
    assert.deepEqual(await page.evaluate(() => {
      const pin = getPinById(51);
      return {
        scope: pinRegionScope(pin),
        transportMode: pin.transportMode,
      };
    }), {
      scope: 'domestic',
      transportMode: 'airplane',
    });
    await page.locator('#scope-filter [data-scope="domestic"]').click();
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id)
        .sort();
    }), ['46', '51']);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    await page.locator('#scope-filter [data-scope="all"]').click();
    await page.evaluate(() => {
      replaceAllPins(getAllPins().filter(pin => pin.id !== 51));
      document.querySelector('.pin-item[data-id="51"]')?.remove();
      refreshListEmptyStates();
      refreshPoints();
      updatePinCount();
      updateFilterBar();
      updateDateFilterSection();
      updateStats();
    });
    assert.equal(await page.locator('#popup .loading-tags').innerText(), '태그 분석 중…');
    const indexCountBeforeTags = indexRequests.length;
    await page.evaluate(() => {
      aiStatus.vision = true;
      fetchTags(46, 'uploaded.jpg');
    });
    await page.locator('#popup .popup-tags .tag', { hasText: '음식' }).waitFor();
    await page.locator('#popup-caption', { hasText: '부산에서 먹은 음식 사진입니다.' }).waitFor();
    for (
      let i = 0;
      i < 20 && indexRequests.slice(indexCountBeforeTags)
        .filter(request => request.id === 46 && ((request.tags ?? []).length || request.caption)).length < 2;
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    const tagIndexRequests = indexRequests.slice(indexCountBeforeTags)
      .filter(request => request.id === 46 && ((request.tags ?? []).length || request.caption));
    assert.equal(tagIndexRequests[0].id, 46);
    assert.ok(tagIndexRequests[0].tags.length > 0);
    assert.equal(tagIndexRequests[1].id, 46);
    assert.ok(tagIndexRequests[1].caption);
    assert.equal(tagIndexRequests[1].transportMode, 'ktx');
    for (
      let i = 0;
      i < 20 && !persistedPins.some(pin => pin.id === 46 && (pin.tags ?? []).length && pin.caption);
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.ok(persistedPins.some(pin => pin.id === 46 && (pin.tags ?? []).length && pin.caption));
    assert.equal(await page.locator('.pin-item[data-id="46"] .tag', { hasText: '음식' }).count(), 1);
    assert.equal(await page.locator('.pin-item[data-id="46"] .status').innerText(), '완료');
    await page.evaluate(() => {
      updatePin(47, { tags: ['해외'], caption: '도쿄 야경' });
      updateSidebarItem(47, { tags: ['해외'], status: 'done' });
      updateFilterBar();
    });
    assert.equal(await page.locator('#overseas-list .pin-item[data-id="47"] .tag', { hasText: '해외' }).count(), 1);
    assert.equal(await page.evaluate(() => getPinById(47).caption), '도쿄 야경');
    await page.locator('#overseas-list .pin-item[data-id="47"]').click();
    await page.waitForSelector('#popup.visible');
    assert.equal(await page.locator('#transport-field').isVisible(), false);
    assert.equal(await page.locator('#transport-summary').isVisible(), false);
    assert.match(await page.locator('#popup .coords').innerText(), /35\.6895/);
    assert.match(await page.locator('#popup .coords').innerText(), /139\.6917/);
    assert.match(await page.locator('#popup .popup-date').innerText(), /2026/);
    assert.equal(await page.locator('#popup .popup-tags .tag', { hasText: '해외' }).count(), 1);
    assert.equal(await page.locator('#popup-caption').innerText(), '도쿄 야경');
    await page.locator('#popup-close').click();
    assert.equal(await page.locator('#filter-section').isVisible(), true);
    await page.locator('#scope-filter [data-scope="international"]').click();
    await page.locator('#filter-bar .filter-chip', { hasText: '해외' }).click();
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    }), ['47']);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 1);
    await page.locator('#filter-bar .filter-chip', { hasText: '전체' }).click();
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    }), ['47']);
    await page.locator('#scope-filter [data-scope="all"]').click();
    assert.equal(await page.locator('#filter-bar .filter-chip', { hasText: '음식' }).count(), 1);
    await page.locator('#filter-bar .filter-chip', { hasText: '음식' }).click();
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    }), ['46']);
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 47).color;
    }), 'rgba(100,100,100,0.25)');
    await page.locator('#filter-bar .filter-chip', { hasText: '전체' }).click();
    assert.equal(await page.locator('.pin-item').count(), 5);
    await page.evaluate(() => {
      updatePin(47, { date: '2024년 1월 1일' });
      updateDateFilterSection();
    });
    assert.equal(await page.locator('#date-filter-section').isVisible(), true);
    await page.locator('#date-from').fill('2025');
    await page.locator('#date-from').dispatchEvent('change');
    await page.locator('#date-to').fill('2026');
    await page.locator('#date-to').dispatchEvent('change');
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id)
        .sort();
    }), ['43', '44', '45', '46']);
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 47).color;
    }), 'rgba(100,100,100,0.25)');
    await page.locator('#date-clear').click();
    assert.equal(await page.locator('.pin-item').count(), 5);
    await page.locator('#scope-filter [data-scope="international"]').click();
    await page.locator('#date-from').fill('2025');
    await page.locator('#date-from').dispatchEvent('change');
    await page.locator('#date-to').fill('2026');
    await page.locator('#date-to').dispatchEvent('change');
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    }), []);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 1);
    await page.locator('#date-clear').click();
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    }), ['47']);
    await page.locator('#scope-filter [data-scope="all"]').click();
    assert.equal(await page.locator('.pin-item').count(), 5);
    assert.equal(await page.locator('#search-input').isVisible(), true);
    await page.locator('#search-input').fill('food');
    await page.locator('#search-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item.search-match').length === 1);
    assert.deepEqual(searchRequests[0], { query: 'food' });
    assert.equal(await page.locator('.pin-item[data-id="46"]').isVisible(), true);
    assert.equal(await page.locator('.pin-item[data-id="47"]').isVisible(), false);
    assert.equal(await page.locator('#search-clear').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      const point = points.find(item => item._id === 46);
      return { color: point.color, radius: point.radius };
    }), { color: '#f97316', radius: 0.8 });
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 47).color;
    }), 'rgba(100,100,100,0.25)');
    await page.locator('#search-clear').click();
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .every(el => getComputedStyle(el).display !== 'none');
    });
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 46).color;
    }), '#f97316');
    searchMode = 'international';
    await page.locator('#search-input').fill('tokyo');
    await page.locator('#search-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item.search-match').length === 1);
    assert.equal(await page.locator('#overseas-list .pin-item[data-id="47"].search-match').count(), 1);
    assert.equal(await page.locator('.pin-item[data-id="46"]').isVisible(), false);
    assert.equal(await page.locator('.pin-item[data-id="47"]').isVisible(), true);
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    assert.equal(await page.evaluate(() => window.projectKoreaMapPoint(35.6895, 139.6917)), null);
    await page.locator('#search-clear').click();
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .every(el => getComputedStyle(el).display !== 'none');
    });
    searchMode = 'mixed';
    await page.locator('#search-input').fill('busan tokyo');
    await page.locator('#search-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item.search-match').length === 2);
    assert.deepEqual(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item.search-match'))
        .map(el => el.dataset.id)
        .sort();
    }), ['46', '47']);
    assert.deepEqual(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      const point = points.find(item => item._id === 46);
      return { color: point.color, radius: point.radius };
    }), { color: '#f97316', radius: 0.8 });
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    await page.locator('#search-clear').click();
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .every(el => getComputedStyle(el).display !== 'none');
    });
    searchMode = 'empty';
    await page.locator('#search-input').fill('missing memory');
    await page.locator('#search-btn').click();
    await page.locator('.toast', { hasText: '찾지 못했습니다' }).waitFor();
    assert.equal(await page.locator('#search-clear').isVisible(), false);
    searchMode = 'error';
    await page.locator('#search-input').fill('offline search');
    await page.locator('#search-btn').click();
    await page.locator('.toast', { hasText: 'local search unavailable' }).waitFor();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-btn').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^pindrop-\d{4}-\d{2}-\d{2}\.json$/);
    const exportedPins = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    const exportedPin = exportedPins.find(pin => pin.id === 46);
    assert.deepEqual(Object.keys(exportedPin).sort(), [
      'date',
      'filename',
      'id',
      'lat',
      'lng',
      'place',
      'regionScope',
      'tags',
      'transportMode',
    ]);
    assert.equal(exportedPin.lat, 35.1796);
    assert.equal(exportedPin.lng, 129.0756);
    assert.equal(exportedPin.filename, 'uploaded.jpg');
    assert.equal(Array.isArray(exportedPin.tags), true);
    assert.equal(exportedPin.regionScope, 'domestic');
    assert.equal(exportedPin.transportMode, 'ktx');
    await page.evaluate(() => {
      const pin = {
        id: 52,
        lat: 37.4563,
        lng: 126.7052,
        place: '인천광역시',
        date: '2026년 5월 9일',
        filename: 'delete-domestic.jpg',
        tags: [],
        regionScope: 'domestic',
        transportMode: 'bus',
        url: '',
      };
      addPin(pin);
      addSidebarItem(pin, false);
      updatePinCount();
      updateFilterBar();
      updateDateFilterSection();
      updateStats();
    });
    await page.locator('#pin-list .pin-item[data-id="52"] .delete-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item[data-id="52"]').length === 0);
    assert.deepEqual(deletedPinIds, [42, 52]);
    assert.equal(await page.evaluate(() => getPinById(52) == null), true);
    await page.locator('.pin-item[data-id="47"] .delete-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item[data-id="47"]').length === 0);
    assert.deepEqual(deletedPinIds, [42, 52, 47]);
    assert.equal(await page.locator('#overseas-empty-state').isVisible(), true);
    assert.equal(await page.locator('#overseas-count').innerText(), '0');
    assert.equal(await page.evaluate(() => getPinById(47) == null), true);
    assert.deepEqual(await page.evaluate(async () => {
      const response = await fetch('/pins');
      return (await response.json()).map(pin => pin.id);
    }), []);
    assert.deepEqual(await page.evaluate(() => {
      return JSON.parse(document.querySelector('#globe').dataset.lastPoints)
        .map(point => point._id)
        .sort((a, b) => a - b);
    }), [46]);
    await page.evaluate(() => {
      document.getElementById('globe').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await page.locator('#popup.visible').count(), 0);
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 46).color;
    }), '#f97316');
    await page.evaluate(async () => {
      window.exifr.parse = async () => ({
        latitude: 0,
        longitude: 0,
        DateTimeOriginal: '2026:05:05 13:00:00',
      });
      await handleFiles([
        new File(['reverse geocode fallback image'], 'fallback-place.jpg', { type: 'image/jpeg' }),
      ]);
    });
    for (let i = 0; i < 20 && !persistedPins.some(pin => pin.id === 48); i += 1) {
      await page.waitForTimeout(100);
    }
    const fallbackPin = persistedPins.find(pin => pin.id === 48);
    assert.equal(fallbackPin.place, '0.000, 0.000');
    assert.equal(fallbackPin.regionScope, 'international');
    await page.evaluate(() => {
      replaceAllPins([]);
      document.querySelectorAll('.pin-item').forEach(el => el.remove());
      refreshListEmptyStates();
      refreshPoints();
      updatePinCount();
      updateFilterBar();
      updateDateFilterSection();
      updateStats();
    });
    await page.locator('#export-btn').click();
    await page.locator('.toast', { hasText: '내보낼 핀이 없습니다' }).waitFor();
    assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
