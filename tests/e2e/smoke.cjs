const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const { launchChromium } = require('./browser.cjs');

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
  const browser = await launchChromium({ headless: true });

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
    const inferPlaceRequests = [];
    let reindexRequests = 0;
    const searchRequests = [];
    let searchMode = 'match';
    let zipExportMode = 'success';
    let zipExportRequests = 0;
    let reverseGeocodeRequests = 0;
    const deletedPinIds = [];
    const reverseGeocodeTimes = [];
    let restoreFromPersistedPins = false;

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
      const seedPins = deletedPinIds.includes(42) ? [] : [
        {
          id: 42,
          lat: 37.5665,
          lng: 126.978,
          place: 'Seoul City Hall',
          date: '2026-04-30',
          filename: 'sample.jpg',
          tags: ['?꾩떆', '?쇨꼍'],
          caption: '?쒖슱 ?꾩떖 ?쇨꼍 ?ъ쭊',
        },
      ];
      const latestPersistedPins = Array.from(new Map(
        persistedPins
          .filter(pin => !deletedPinIds.includes(pin.id))
          .map(pin => [pin.id, pin]),
      ).values());
      const restoredPins = restoreFromPersistedPins
        ? Array.from(new Map(
          [...seedPins, ...latestPersistedPins].map(pin => [pin.id, pin]),
        ).values())
        : seedPins;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(restoredPins),
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

    await page.route(`${baseUrl}/pins/41`, route => {
      deletedPinIds.push(41);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`${baseUrl}/pins/40`, route => {
      deletedPinIds.push(40);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`${baseUrl}/pins/39`, route => {
      deletedPinIds.push(39);
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
    await page.route(`${baseUrl}/uploads/uploaded.jpg`, route => {
      route.fulfill({
        contentType: 'image/jpeg',
        body: Buffer.from([255, 216, 255, 217]),
      });
    });
    await page.route(`${baseUrl}/upload`, route => {
      uploadRequests += 1;
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ filename: 'uploaded.jpg', url: '/uploads/uploaded.jpg' }),
      });
    });
    await page.route(`${baseUrl}/infer-place`, route => {
      const body = route.request().postDataJSON();
      inferPlaceRequests.push(body);
      if (inferPlaceRequests.length === 1) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            available: true,
            place: 'N Seoul Tower',
            confidence: 'medium',
            reason: 'Visible tower and skyline.',
          }),
        });
      }
      if (inferPlaceRequests.length === 2) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            available: false,
            place: '',
            confidence: 'unavailable',
            reason: 'Vision model unavailable: llama3.2-vision',
          }),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          available: true,
          place: 'Maybe Busan',
          confidence: 'low',
          reason: 'Only a weak visual clue was found.',
        }),
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
        body: JSON.stringify({ tags: ['?뚯떇', '?꾩떆'] }),
      });
    });
    await page.route(`${baseUrl}/caption`, route => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ caption: '遺?곗뿉??癒뱀? ?뚯떇 ?ъ쭊?낅땲??' }),
      });
    });
    await page.route(`${baseUrl}/organization/export.zip`, route => {
      zipExportRequests += 1;
      if (zipExportMode === 'error') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'ZIP export test failure' }),
        });
      }
      return route.fulfill({
        contentType: 'application/zip',
        headers: {
          'Content-Disposition': 'attachment; filename="tripsort-organized-test.zip"',
        },
        body: Buffer.from('fake zip bytes'),
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
        body: JSON.stringify({ place: 'Seoul' }),
      });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pin-item');
    for (let i = 0; i < 20 && reindexRequests === 0; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.equal(reindexRequests, 1);

    assert.equal(await page.locator('h1').innerText(), 'TripSort');
    assert.ok((await page.locator('#ai-status-ollama').innerText()).length > 0);
    assert.equal(await page.locator('#ai-status-vision').innerText(), 'VLM 모델 없음');
    assert.ok((await page.locator('#ai-status-rerank').innerText()).length > 0);
    assert.match(await page.locator('#ai-status-hint').innerText(), /ollama pull llama3\.2-vision/);
    assert.equal(await page.locator('#organizer-workspace').isVisible(), true);
    assert.equal(await page.locator('#map-workspace').isHidden(), true);
    assert.equal(await page.locator('#globe .global-map-canvas').getAttribute('data-maplibre-initialized'), null);
    await page.locator('#map-view-btn').click();
    await page.waitForFunction(() => document.querySelector('#globe')?.dataset.mapView === 'global');
    assert.equal(await page.locator('#globe .korea-map-surface').count(), 0);
    assert.equal(await page.locator('#map-mode-btn').isHidden(), true);
    assert.equal(await page.locator('.map-support-label').innerText(), '지도 미리보기');
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
    await page.locator('#organizer-view-btn').click();
    assert.equal(await page.locator('#pin-list .pin-item[data-id="42"]').count(), 1);
    assert.equal(await page.locator('#overseas-empty-state').isVisible(), true);
    assert.equal(await page.locator('#overseas-count').innerText(), '0');
    const sidebarBox = await page.locator('#sidebar').boundingBox();
    const workspaceBox = await page.locator('.workspace').boundingBox();
    assert.ok(sidebarBox.x + sidebarBox.width <= workspaceBox.x + 1);
    assert.match(await page.locator('#pin-count').innerText(), /1개의 사진/);
    assert.equal(await page.locator('.pin-item .place').innerText(), 'Seoul City Hall');
    assert.equal(
      await page.locator('#organization-preview .organization-folder').innerText(),
      'Trip_2026-04-30_Seoul City Hall/2026-04-30_Seoul City Hall',
    );
    await page.locator('#organization-preview .organization-trip-input').first().fill('Seoul Day Trip');
    await page.locator('#organization-preview .organization-trip-form button').first().click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 42)?.organization?.tripName !== 'Seoul Day Trip';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      [...persistedPins].reverse().find(pin => pin.id === 42).organization.tripName,
      'Seoul Day Trip',
    );
    assert.equal(
      await page.locator('#organization-preview .organization-folder').innerText(),
      'Seoul Day Trip/2026-04-30_Seoul City Hall',
    );
    assert.deepEqual(await page.evaluate(() => {
      const savedPins = getAllPins();
      const makeTripPin = (id, date, place, originalFilename) => ({
        id,
        lat: null,
        lng: null,
        place,
        date,
        filename: 'sample.jpg',
        tags: [],
        regionScope: 'unknown',
        transportMode: 'unknown',
        sourcePhoto: {
          originalFilename,
          storedFilename: 'sample.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12,
          importedAt: '2026-05-10T00:00:00Z',
        },
        organization: {
          tripId: 'split-preview-trip',
          candidateCaptureDate: date,
          candidatePlace: place,
          confidence: 'high',
          reason: 'Seeded split preview test.',
          status: 'ready',
        },
      });
      replaceAllPins([
        ...savedPins,
        makeTripPin(901, '2026-05-01', 'Jeju City', 'arrival.jpg'),
        makeTripPin(902, '2026-05-10', 'Tokyo', 'tokyo.jpg'),
      ]);
      renderOrganizationPreview();
      const folders = [901, 902].map(id => (
        document.querySelector(`#organization-preview .organization-row[data-id="${id}"]`)
          .closest('.organization-group')
          .querySelector('.organization-folder')
          .textContent
      ));
      replaceAllPins(savedPins);
      renderOrganizationPreview();
      return folders;
    }), [
      'Trip_2026-05-01_Jeju City/2026-05-01_Jeju City',
      'Trip_2026-05-10_Tokyo/2026-05-10_Tokyo',
    ]);
    assert.deepEqual(await page.evaluate(() => {
      const savedPins = getAllPins();
      const makeSignalPin = (id, date, place, country, city, originalFilename) => ({
        id,
        lat: null,
        lng: null,
        place,
        date,
        filename: 'sample.jpg',
        tags: [],
        regionScope: 'unknown',
        transportMode: 'unknown',
        sourcePhoto: {
          originalFilename,
          storedFilename: 'sample.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12,
          importedAt: '2026-05-10T00:00:00Z',
        },
        organization: {
          tripId: 'signal-preview-trip',
          candidateCaptureDate: date,
          candidatePlace: place,
          confidence: 'high',
          reason: 'Seeded signal split preview test.',
          status: 'ready',
          tripSignals: {
            country,
            city,
            confidence: 'high',
            source: 'vlm',
          },
        },
      });
      replaceAllPins([
        ...savedPins,
        makeSignalPin(903, '2026-05-01', 'Seoul', 'South Korea', 'Seoul', 'seoul.jpg'),
        makeSignalPin(904, '2026-05-02', 'Tokyo', 'Japan', 'Tokyo', 'tokyo.jpg'),
      ]);
      renderOrganizationPreview();
      const folders = [903, 904].map(id => (
        document.querySelector(`#organization-preview .organization-row[data-id="${id}"]`)
          .closest('.organization-group')
          .querySelector('.organization-folder')
          .textContent
      ));
      replaceAllPins(savedPins);
      renderOrganizationPreview();
      return folders;
    }), [
      'Trip_2026-05-01_Seoul/2026-05-01_Seoul',
      'Trip_2026-05-02_Tokyo/2026-05-02_Tokyo',
    ]);
    await page.evaluate(() => {
      window.__manualTripSavedPins = getAllPins();
      const makeSignalPin = (id, date, place, country, city, originalFilename) => ({
        id,
        lat: null,
        lng: null,
        place,
        date,
        filename: 'sample.jpg',
        tags: [],
        regionScope: 'unknown',
        transportMode: 'unknown',
        sourcePhoto: {
          originalFilename,
          storedFilename: 'sample.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12,
          importedAt: '2026-05-10T00:00:00Z',
        },
        organization: {
          tripId: 'manual-merge-preview-trip',
          candidateCaptureDate: date,
          candidatePlace: place,
          confidence: 'high',
          reason: 'Seeded manual merge preview test.',
          status: 'ready',
          tripSignals: {
            country,
            city,
            confidence: 'high',
            source: 'vlm',
          },
        },
      });
      addPin(makeSignalPin(905, '2026-05-01', 'Seoul', 'South Korea', 'Seoul', 'seoul.jpg'));
      addPin(makeSignalPin(906, '2026-05-02', 'Tokyo', 'Japan', 'Tokyo', 'tokyo.jpg'));
      renderOrganizationPreview();
    });
    await page.locator('#organization-preview .organization-row[data-id="906"]').evaluate(row => {
      row.closest('.organization-group').querySelector('.organization-merge-previous-btn').click();
    });
    for (
      let i = 0;
      i < 20 && !(
        [...persistedPins].reverse().find(pin => pin.id === 905)?.organization?.tripGroupId
        && [...persistedPins].reverse().find(pin => pin.id === 905)?.organization?.tripGroupId
          === [...persistedPins].reverse().find(pin => pin.id === 906)?.organization?.tripGroupId
      );
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    const manualMergedPins = [905, 906].map(id => [...persistedPins].reverse().find(pin => pin.id === id));
    assert.ok(manualMergedPins[0].organization.tripGroupId);
    assert.equal(manualMergedPins[0].organization.tripGroupId, manualMergedPins[1].organization.tripGroupId);
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="906"]').evaluate(row => (
        row.closest('.organization-group').querySelector('.organization-folder').textContent
      )),
      'Trip_2026-05-01_to_2026-05-02_Seoul/2026-05-02_Tokyo',
    );
    await page.evaluate(() => {
      replaceAllPins(window.__manualTripSavedPins);
      delete window.__manualTripSavedPins;
      renderOrganizationPreview();
    });
    for (let i = persistedPins.length - 1; i >= 0; i -= 1) {
      if ([905, 906].includes(persistedPins[i].id)) persistedPins.splice(i, 1);
    }
    await page.evaluate(() => {
      window.__manualTripSavedPins = getAllPins();
      const makeSignalPin = (id, date, originalFilename) => ({
        id,
        lat: null,
        lng: null,
        place: 'Seoul',
        date,
        filename: 'sample.jpg',
        tags: [],
        regionScope: 'unknown',
        transportMode: 'unknown',
        sourcePhoto: {
          originalFilename,
          storedFilename: 'sample.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12,
          importedAt: '2026-05-10T00:00:00Z',
        },
        organization: {
          tripId: 'manual-split-preview-trip',
          candidateCaptureDate: date,
          candidatePlace: 'Seoul',
          confidence: 'high',
          reason: 'Seeded manual split preview test.',
          status: 'ready',
          tripSignals: {
            country: 'South Korea',
            city: 'Seoul',
            confidence: 'high',
            source: 'vlm',
          },
        },
      });
      addPin(makeSignalPin(907, '2026-05-01', 'day-one.jpg'));
      addPin(makeSignalPin(908, '2026-05-02', 'day-two.jpg'));
      renderOrganizationPreview();
    });
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="908"]').evaluate(row => (
        row.closest('.organization-group').querySelector('.organization-folder').textContent
      )),
      'Trip_2026-05-01_to_2026-05-02_Seoul/2026-05-02_Seoul',
    );
    await page.locator('#organization-preview .organization-row[data-id="908"] .organization-split-here-btn').click();
    for (
      let i = 0;
      i < 20 && !(
        [...persistedPins].reverse().find(pin => pin.id === 907)?.organization?.tripGroupId
        && [...persistedPins].reverse().find(pin => pin.id === 908)?.organization?.tripGroupId
        && [...persistedPins].reverse().find(pin => pin.id === 907)?.organization?.tripGroupId
          !== [...persistedPins].reverse().find(pin => pin.id === 908)?.organization?.tripGroupId
      );
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    const manualSplitPins = [907, 908].map(id => [...persistedPins].reverse().find(pin => pin.id === id));
    assert.notEqual(manualSplitPins[0].organization.tripGroupId, manualSplitPins[1].organization.tripGroupId);
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="908"]').evaluate(row => (
        row.closest('.organization-group').querySelector('.organization-folder').textContent
      )),
      'Trip_2026-05-02_Seoul/2026-05-02_Seoul',
    );
    await page.evaluate(() => {
      replaceAllPins(window.__manualTripSavedPins);
      delete window.__manualTripSavedPins;
      renderOrganizationPreview();
    });
    for (let i = persistedPins.length - 1; i >= 0; i -= 1) {
      if ([907, 908].includes(persistedPins[i].id)) persistedPins.splice(i, 1);
    }
    assert.equal(await page.locator('#organization-preview .organization-original').innerText(), 'sample.jpg');
    assert.equal(await page.locator('#organization-preview .organization-filename').innerText(), 'sample.jpg');
    assert.match(await page.locator('#organization-preview .organization-meta').innerText(), /GPS/);
    assert.equal(await page.locator('#move-originals-btn').isDisabled(), true);
    assert.match(
      await page.locator('#original-move-panel').innerText(),
      /TripSort 밖의 파일/,
    );
    const originalSeedPlace = await page.locator('.pin-item .place').innerText();
    await page.locator('#organization-preview .organization-row[data-id="42"] .organization-place-input').fill('Seoul:Edited/Place');
    await page.locator('#organization-preview .organization-row[data-id="42"] .organization-place-form button').click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 42)?.organization?.candidatePlace !== 'Seoul_Edited_Place';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      [...persistedPins].reverse().find(pin => pin.id === 42).organization.candidatePlace,
      'Seoul_Edited_Place',
    );
    assert.match(
      await page.locator('#organization-preview .organization-folder').innerText(),
      /_Seoul_Edited_Place$/,
    );
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="42"] .organization-place-input').inputValue(),
      'Seoul_Edited_Place',
    );
    assert.match(
      await page.locator('#organization-preview .organization-row[data-id="42"] .organization-meta').innerText(),
      /manual.*manual/s,
    );
    restoreFromPersistedPins = true;
    await page.evaluate(async () => {
      replaceAllPins([]);
      document.querySelectorAll('.pin-item').forEach(el => el.remove());
      refreshListEmptyStates();
      await restoreSession();
    });
    await page.waitForFunction(() => {
      return document.querySelector('#organization-preview .organization-row[data-id="42"] .organization-place-input')
        ?.value === 'Seoul_Edited_Place';
    });
    restoreFromPersistedPins = false;
    await page.locator('#organization-preview .organization-row[data-id="42"] .organization-place-input').fill(originalSeedPlace);
    await page.locator('#organization-preview .organization-row[data-id="42"] .organization-place-form button').click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 42)?.organization?.candidatePlace !== originalSeedPlace;
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      [...persistedPins].reverse().find(pin => pin.id === 42).organization.candidatePlace,
      originalSeedPlace,
    );
    assert.equal(await page.locator('.pin-item .place').innerText(), originalSeedPlace);
    await page.evaluate(() => {
      const tempPin = {
        id: 41,
        lat: null,
        lng: null,
        place: 'Old Place',
        date: '2026-01-02',
        filename: 'sample.jpg',
        tags: [],
        regionScope: 'unknown',
        transportMode: 'unknown',
        sourcePhoto: {
          originalFilename: 'date-edit.jpg',
          storedFilename: 'sample.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12,
          importedAt: '2026-05-10T00:00:00Z',
        },
        organization: {
          tripId: 'date-edit-trip',
          candidateCaptureDate: '2026-01-02',
          candidatePlace: 'Old Place',
          confidence: 'high',
          reason: 'Seeded date edit test.',
          status: 'ready',
          outputPath: 'Trip_2026-01-02_Old Place/2026-01-02_Old Place/date-edit.jpg',
        },
      };
      addPin(tempPin);
      addSidebarItem(tempPin, true);
      updatePinCount();
      renderOrganizationPreview();
    });
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="41"] .organization-date-input').inputValue(),
      '2026-01-02',
    );
    await page.locator('#organization-preview .organization-row[data-id="41"] .organization-date-input').fill('2026-05-09');
    await page.locator('#organization-preview .organization-row[data-id="41"] .organization-date-form button').click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 41)?.organization?.candidateCaptureDate !== '2026-05-09';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      [...persistedPins].reverse().find(pin => pin.id === 41).organization.candidateCaptureDate,
      '2026-05-09',
    );
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="41"]').evaluate(row => (
        row.closest('.organization-group').querySelector('.organization-folder').textContent
      )),
      'Trip_2026-05-09_Old Place/2026-05-09_Old Place',
    );
    restoreFromPersistedPins = true;
    await page.evaluate(async () => {
      replaceAllPins([]);
      document.querySelectorAll('.pin-item').forEach(el => el.remove());
      refreshListEmptyStates();
      await restoreSession();
    });
    await page.waitForFunction(() => {
      return document.querySelector('#organization-preview .organization-row[data-id="41"] .organization-date-input')
        ?.value === '2026-05-09';
    });
    await page.locator('#organization-preview .organization-row[data-id="41"] .organization-date-input').fill('');
    await page.locator('#organization-preview .organization-row[data-id="41"] .organization-date-form button').click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 41)?.organization?.candidateCaptureDate !== 'Unknown Date';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      [...persistedPins].reverse().find(pin => pin.id === 41).organization.candidateCaptureDate,
      'Unknown Date',
    );
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="41"]').evaluate(row => (
        row.closest('.organization-group').querySelector('.organization-folder').textContent
      )),
      'Trip_Unknown Date_Old Place/Unknown Date_Old Place',
    );
    restoreFromPersistedPins = false;
    await page.evaluate(() => removePin(41));
    for (let i = 0; i < 20 && !deletedPinIds.includes(41); i += 1) {
      await page.waitForTimeout(100);
    }
    assert.equal(deletedPinIds.includes(41), true);
    await page.evaluate(async () => {
      const makePin = (id, originalFilename) => ({
        id,
        lat: null,
        lng: null,
        place: 'Old Place',
        date: '2026-01-02',
        filename: 'sample.jpg',
        tags: [],
        regionScope: 'unknown',
        transportMode: 'unknown',
        sourcePhoto: {
          originalFilename,
          storedFilename: 'sample.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12,
          importedAt: '2026-05-10T00:00:00Z',
        },
        organization: {
          tripId: 'filename-edit-trip',
          candidateCaptureDate: '2026-01-02',
          candidatePlace: 'Old Place',
          confidence: 'high',
          reason: 'Seeded filename edit test.',
          status: 'ready',
          outputPath: `Trip_2026-01-02_Old Place/2026-01-02_Old Place/${originalFilename}`,
        },
      });
      const duplicatePin = makePin(39, 'same-name.jpg');
      const targetPin = makePin(40, 'target.jpg');
      addPin(duplicatePin);
      addPin(targetPin);
      addSidebarItem(duplicatePin, true);
      addSidebarItem(targetPin, true);
      updatePinCount();
      renderOrganizationPreview();
      await persistPin({ ...duplicatePin, url: undefined });
      await persistPin({ ...targetPin, url: undefined });
    });
    await page.locator('#organization-preview .organization-row[data-id="40"] .organization-filename-input').fill('same-name');
    await page.locator('#organization-preview .organization-row[data-id="40"] .organization-filename-form button').click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 40)?.organization?.candidateFilename !== 'same-name.jpg';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      [...persistedPins].reverse().find(pin => pin.id === 40).organization.candidateFilename,
      'same-name.jpg',
    );
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="40"] .organization-filename').innerText(),
      'same-name-2.jpg',
    );
    restoreFromPersistedPins = true;
    await page.evaluate(async () => {
      replaceAllPins([]);
      document.querySelectorAll('.pin-item').forEach(el => el.remove());
      refreshListEmptyStates();
      await restoreSession();
    });
    await page.waitForFunction(() => {
      return document.querySelector('#organization-preview .organization-row[data-id="40"] .organization-filename')
        ?.textContent === 'same-name-2.jpg';
    });
    await page.locator('#organization-preview .organization-row[data-id="40"] .organization-filename-input').fill('custom.webp');
    await page.locator('#organization-preview .organization-row[data-id="40"] .organization-filename-form button').click();
    for (
      let i = 0;
      i < 20 && [...persistedPins].reverse().find(pin => pin.id === 40)?.organization?.candidateFilename !== 'custom.webp';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="40"] .organization-filename').innerText(),
      'custom.webp',
    );
    restoreFromPersistedPins = false;
    await page.evaluate(() => {
      removePin(40);
      removePin(39);
    });
    for (
      let i = 0;
      i < 20 && (!deletedPinIds.includes(40) || !deletedPinIds.includes(39));
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(deletedPinIds.includes(40), true);
    assert.equal(deletedPinIds.includes(39), true);
    assert.ok((await page.evaluate(() => {
      const savedPins = getAllPins();
      replaceAllPins([]);
      renderOrganizationPreview();
      const emptyText = document.querySelector('#organization-empty-state')?.textContent || '';
      replaceAllPins(savedPins);
      renderOrganizationPreview();
      return emptyText;
    })).length > 0);
    assert.deepEqual(await page.evaluate(() => {
      const savedPins = getAllPins();
      const manyPins = Array.from({ length: 130 }, (_, index) => ({
        id: 2000 + index,
        place: index < 70 ? 'Saanich' : 'Vancouver',
        date: index < 70 ? '2025년 7월 26일' : '2025년 7월 27일',
        filename: `bulk-${index}.jpg`,
        url: '',
        tags: [],
        sourcePhoto: {
          originalFilename: `bulk-${index}.jpg`,
          storedFilename: `bulk-${index}.jpg`,
        },
        organization: {
          tripId: 'large-preview',
          candidateCaptureDate: index < 70 ? '2025-07-26' : '2025-07-27',
          candidatePlace: index < 70 ? 'Saanich' : 'Vancouver',
          confidence: 'high',
          reason: 'Large preview fixture.',
          status: 'ready',
        },
      }));
      replaceAllPins(manyPins);
      renderOrganizationPreview();
      const result = {
        summaryCount: document.querySelectorAll('.organization-folder-summary').length,
        rowCount: document.querySelectorAll('.organization-row').length,
        hasCompactNote: Boolean(document.querySelector('.organization-compact-note')),
        firstCount: document.querySelector('.organization-folder-count')?.textContent || '',
      };
      replaceAllPins(savedPins);
      renderOrganizationPreview();
      return result;
    }), {
      summaryCount: 2,
      rowCount: 0,
      hasCompactNote: true,
      firstCount: '70개 사진',
    });
    assert.equal(await page.locator('#filter-bar .filter-chip', { hasText: '?꾩떆' }).count(), 1);
    assert.equal(await page.locator('#file-input').getAttribute('multiple'), '');
    assert.equal(await page.locator('#file-input').getAttribute('accept'), 'image/*');
    assert.equal(await page.locator('#folder-input').getAttribute('multiple'), '');
    assert.equal(await page.locator('#folder-input').getAttribute('webkitdirectory'), '');
    assert.equal(await page.locator('#folder-upload-btn').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => {
      const uploadZone = document.querySelector('#upload-zone');
      const fileInput = document.querySelector('#file-input');
      const originalClick = fileInput.click;
      let programmaticClicks = 0;
      fileInput.click = () => { programmaticClicks += 1; };
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      uploadZone.dispatchEvent(event);
      fileInput.click = originalClick;
      return {
        programmaticClicks,
        defaultPrevented: event.defaultPrevented,
      };
    }), {
      programmaticClicks: 1,
      defaultPrevented: true,
    });
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
      captureDate: '2026-05-05',
      dateSource: 'exif',
    });
    assert.deepEqual(await page.evaluate(() => ({
      city: pinColor(['?꾩떆']),
      night: pinColor(['?쇨꼍']),
      unknown: pinColor(['?녿뒗?쒓렇']),
      empty: pinColor([]),
    })), {
      city: '#5e6ad2',
      night: '#5e6ad2',
      unknown: '#5e6ad2',
      empty: '#5e6ad2',
    });
    assert.equal(await page.evaluate(() => reverseGeocode(37.5665, 126.978)), 'Seoul');
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
    await page.waitForFunction(() => (
      [43, 44, 45].every(id => document.querySelector(`.pin-item[data-id="${id}"]`))
    ));
    assert.equal(uploadRequests, 3);
    const noGpsIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(item => item.querySelector('.status')?.textContent === 'GPS 없음')
        .map(item => Number(item.dataset.id))
        .sort((a, b) => a - b);
    });
    assert.deepEqual(noGpsIds, [43, 44, 45]);
    assert.equal(inferPlaceRequests.length, 0);
    await page.evaluate(() => {
      aiStatus.vision = true;
      updateAiStatusPanel();
    });
    assert.equal(await page.locator('#ai-enrich-btn').isDisabled(), false);
    await page.locator('#ai-enrich-btn').click();
    for (let i = 0; i < 20 && inferPlaceRequests.length < 3; i += 1) {
      await page.waitForTimeout(100);
    }
    assert.deepEqual(inferPlaceRequests.map(request => request.originalFilename), [
      'no-gps-one.jpg',
      'no-gps-two.jpg',
      'dropped.jpg',
    ]);
    const latestPin = id => [...persistedPins].reverse().find(pin => pin.id === id);
    for (
      let i = 0;
      i < 20 && latestPin(43)?.organization?.status !== 'ready';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    for (
      let i = 0;
      i < 20 && latestPin(45)?.organization?.status !== 'fallback';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    assert.equal(latestPin(43).regionScope, 'unknown');
    assert.equal(latestPin(43).sourcePhoto.originalFilename, 'no-gps-one.jpg');
    assert.equal(latestPin(43).sourcePhoto.storedFilename, 'uploaded.jpg');
    assert.equal(latestPin(43).place, 'N Seoul Tower');
    assert.equal(latestPin(43).organization.candidatePlace, 'N Seoul Tower');
    assert.equal(latestPin(43).organization.confidence, 'medium');
    assert.equal(latestPin(43).organization.reason, 'Visible tower and skyline.');
    assert.equal(latestPin(44).place, 'Unknown Location');
    assert.equal(latestPin(44).organization.candidatePlace, 'Unknown Location');
    assert.equal(latestPin(44).organization.confidence, 'unavailable');
    assert.equal(latestPin(44).organization.status, 'fallback');
    assert.equal(latestPin(45).organization.candidatePlace, 'Unknown Location');
    assert.equal(latestPin(45).organization.confidence, 'low');
    assert.equal(latestPin(45).organization.status, 'fallback');
    await page.waitForFunction(() => {
      return document.querySelector('#organization-preview .organization-row[data-id="43"] .organization-original')
        ?.textContent === 'no-gps-one.jpg';
    });
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="43"] .organization-filename').innerText(),
      'no-gps-one.jpg',
    );
    assert.match(
      await page.locator('#organization-preview .organization-row[data-id="43"] .organization-meta').innerText(),
      /VLM.*medium/s,
    );
    assert.equal(
      await page.locator('#organization-preview .organization-row[data-id="43"] .organization-reason').innerText(),
      'Visible tower and skyline.',
    );
    assert.match(
      await page.locator('#organization-preview .organization-row[data-id="44"] .organization-meta').innerText(),
      /fallback.*unavailable/s,
    );
    restoreFromPersistedPins = true;
    await page.evaluate(async () => {
      replaceAllPins([]);
      document.querySelectorAll('.pin-item').forEach(el => el.remove());
      refreshListEmptyStates();
      await restoreSession();
    });
    await page.waitForFunction(() => (
      [43, 44, 45].every(id => document.querySelector(`.pin-item[data-id="${id}"]`))
    ));
    restoreFromPersistedPins = false;
    assert.match(await page.locator('#pin-count').innerText(), /4개의 사진/);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['plain text'], 'notes.txt', { type: 'text/plain' }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.querySelector('#upload-zone').dispatchEvent(event);
    });
    await page.locator('.toast', { hasText: '지원하지 않는 파일 형식' }).waitFor();
    assert.deepEqual(await page.evaluate(() => (
      [43, 44, 45].map(id => document.querySelector(`.pin-item[data-id="${id}"]`) != null)
    )), [true, true, true]);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      const bytes = new Uint8Array(31 * 1024 * 1024);
      transfer.items.add(new File([bytes], 'too-large.jpg', { type: 'image/jpeg' }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.querySelector('#upload-zone').dispatchEvent(event);
    });
    await page.locator('.toast', { hasText: '파일이 너무 큽니다' }).waitFor();
    assert.deepEqual(await page.evaluate(() => (
      [43, 44, 45].map(id => document.querySelector(`.pin-item[data-id="${id}"]`) != null)
    )), [true, true, true]);

    await page.locator('.pin-item', { hasText: 'Seoul City Hall' }).click();
    await page.waitForSelector('#popup.visible');
    assert.equal(await page.locator('#popup .place-name').innerText(), 'Seoul City Hall');
    assert.match(await page.locator('#popup .coords').innerText(), /37\.5665/);
    assert.match(await page.locator('#popup .popup-img').getAttribute('src'), /sample\.jpg/);
    assert.equal(await page.locator('#popup .popup-date').innerText(), '2026-04-30');
    assert.equal(await page.locator('#popup .popup-tags .tag', { hasText: '?꾩떆' }).count(), 1);
    assert.equal(await page.locator('#popup-caption').innerText(), '?쒖슱 ?꾩떖 ?쇨꼍 ?ъ쭊');

    await page.locator('#popup-delete').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item[data-id="42"]').length === 0);
    assert.equal(await page.locator('#popup.visible').count(), 0);
    assert.equal(deletedPinIds.includes(42), true);
    assert.deepEqual(await page.evaluate(async () => {
      const response = await fetch('/pins');
      return (await response.json()).map(pin => pin.id);
    }), []);
    assert.deepEqual(await page.evaluate(() => (
      [43, 44, 45].map(id => document.querySelector(`.pin-item[data-id="${id}"]`) != null)
    )), [true, true, true]);

    reverseGeocodeTimes.length = 0;
    const gpsIndexStart = indexRequests.length;
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
    for (let i = 0; i < 20 && indexRequests.slice(gpsIndexStart).length < 2; i += 1) {
      await page.waitForTimeout(100);
    }
    const gpsIndexRequests = indexRequests.slice(gpsIndexStart);
    assert.deepEqual(gpsIndexRequests.slice(0, 2).map(request => request.id), [46, 47]);
    assert.deepEqual(gpsIndexRequests.slice(0, 2).map(request => request.filename), ['uploaded.jpg', 'uploaded.jpg']);
    for (
      let i = 0;
      i < 50 && latestPin(47)?.organization?.candidatePlace !== 'Seoul';
      i += 1
    ) {
      await page.waitForTimeout(100);
    }
    const gpsPersistedPins = [46, 47].map(id => latestPin(id));
    assert.deepEqual(gpsPersistedPins.map(pin => ({
      id: pin.id,
      regionScope: pin.regionScope,
      transportMode: pin.transportMode,
    })), [
      { id: 46, regionScope: 'domestic', transportMode: 'unknown' },
      { id: 47, regionScope: 'international', transportMode: 'unknown' },
    ]);
    const firstUploadedPin = latestPin(46);
    assert.equal(firstUploadedPin.sourcePhoto.originalFilename, 'busan-one.jpg');
    assert.equal(firstUploadedPin.sourcePhoto.storedFilename, 'uploaded.jpg');
    assert.equal(firstUploadedPin.sourcePhoto.mimeType, 'image/jpeg');
    assert.equal(firstUploadedPin.sourcePhoto.fileSize, 'first gps image'.length);
    assert.match(firstUploadedPin.sourcePhoto.importedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(firstUploadedPin.organization.candidateCaptureDate, '2026-05-05');
    assert.equal(firstUploadedPin.organization.candidatePlace, 'Seoul');
    assert.equal(firstUploadedPin.organization.confidence, 'high');
    assert.equal(reverseGeocodeTimes.length, 2);
    assert.ok(
      reverseGeocodeTimes[1] - reverseGeocodeTimes[0] >= 1000,
      `Expected reverse geocode calls to be spaced, got ${reverseGeocodeTimes[1] - reverseGeocodeTimes[0]}ms`,
    );
    assert.match(await page.locator('#pin-count').innerText(), /5개의 사진/);
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
    await page.locator('#map-view-btn').click();
    await page.waitForFunction(() => document.querySelector('#globe')?.dataset.mapView === 'global');
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
    assert.equal((await page.locator('#transport-summary').innerText()).length > 0, true);
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
          place: 'Seoul City Hall',
          date: '2026-05-06',
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
          place: 'Jeju',
          date: '2026-05-07',
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
      const source = JSON.parse(document.querySelector('#globe .global-map-canvas').dataset.sourcetripsortroutes);
      return source.features.map(feature => feature.properties.label);
    }), ['이동', '이동']);
    assert.equal(await page.evaluate(() => {
      const source = JSON.parse(document.querySelector('#globe .global-map-canvas').dataset.sourcetripsortroutes);
      return source.features.length;
    }), 2);
    await page.locator('#arc-btn').click();
    assert.equal(await page.evaluate(() => {
      const source = JSON.parse(document.querySelector('#globe .global-map-canvas').dataset.sourcetripsortroutes);
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
        place: 'Jeju',
        date: '2026-05-08',
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
    assert.ok((await page.locator('#popup .loading-tags').innerText()).length > 0);
    const indexCountBeforeTags = indexRequests.length;
    await page.evaluate(() => {
      aiStatus.vision = true;
      fetchTags(46, 'uploaded.jpg');
    });
    await page.locator('#popup .popup-tags .tag', { hasText: '?뚯떇' }).waitFor();
    await page.locator('#popup-caption', { hasText: '遺?곗뿉??癒뱀? ?뚯떇 ?ъ쭊?낅땲??' }).waitFor();
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
    assert.equal(await page.locator('.pin-item[data-id="46"] .tag', { hasText: '?뚯떇' }).count(), 1);
    assert.equal(await page.locator('.pin-item[data-id="46"] .status').innerText(), '완료');
    await page.evaluate(() => {
      updatePin(47, { tags: ['?댁쇅'], caption: '?꾩퓙 ?쇨꼍' });
      updateSidebarItem(47, { tags: ['?댁쇅'], status: 'done' });
      updateFilterBar();
    });
    assert.equal(await page.locator('#overseas-list .pin-item[data-id="47"] .tag', { hasText: '?댁쇅' }).count(), 1);
    assert.equal(await page.evaluate(() => getPinById(47).caption), '?꾩퓙 ?쇨꼍');
    await page.locator('#overseas-list .pin-item[data-id="47"]').click();
    await page.waitForSelector('#popup.visible');
    assert.equal(await page.locator('#transport-field').isVisible(), false);
    assert.equal(await page.locator('#transport-summary').isVisible(), false);
    assert.match(await page.locator('#popup .coords').innerText(), /35\.6895/);
    assert.match(await page.locator('#popup .coords').innerText(), /139\.6917/);
    assert.match(await page.locator('#popup .popup-date').innerText(), /2026/);
    assert.equal(await page.locator('#popup .popup-tags .tag', { hasText: '?댁쇅' }).count(), 1);
    assert.equal(await page.locator('#popup-caption').innerText(), '?꾩퓙 ?쇨꼍');
    await page.locator('#popup-close').click();
    assert.equal(await page.locator('#filter-section').isVisible(), true);
    await page.locator('#scope-filter [data-scope="international"]').click();
    await page.locator('#filter-bar .filter-chip', { hasText: '?댁쇅' }).click();
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
    assert.equal(await page.locator('#filter-bar .filter-chip', { hasText: '?뚯떇' }).count(), 1);
    await page.locator('#filter-bar .filter-chip', { hasText: '?뚯떇' }).click();
    const foodFilteredIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.id);
    });
    assert.equal(foodFilteredIds.includes('46'), true);
    assert.equal(foodFilteredIds.includes('47'), false);
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 47).color;
    }), 'rgba(98,102,109,0.25)');
    await page.locator('#filter-bar .filter-chip', { hasText: '전체' }).click();
    assert.equal(await page.locator('.pin-item').count(), 5);
    await page.evaluate(() => {
      updatePin(47, { date: '2024-01-01' });
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
    }), 'rgba(98,102,109,0.25)');
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
    }), { color: '#5e6ad2', radius: 0.8 });
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 47).color;
    }), 'rgba(98,102,109,0.25)');
    await page.locator('#search-clear').click();
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .every(el => getComputedStyle(el).display !== 'none');
    });
    assert.equal(await page.evaluate(() => {
      const points = JSON.parse(document.querySelector('#globe').dataset.lastPoints);
      return points.find(point => point._id === 46).color;
    }), '#5e6ad2');
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
    }), { color: '#5e6ad2', radius: 0.8 });
    assert.equal(await page.locator('#globe .global-map-pin').count(), 2);
    await page.locator('#search-clear').click();
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.pin-item'))
        .every(el => getComputedStyle(el).display !== 'none');
    });
    searchMode = 'empty';
    await page.locator('#search-input').fill('missing memory');
    await page.locator('#search-btn').click();
    await page.locator('.toast').last().waitFor();
    assert.equal(await page.locator('#search-clear').isVisible(), false);
    searchMode = 'error';
    await page.locator('#search-input').fill('offline search');
    await page.locator('#search-btn').click();
    await page.locator('.toast', { hasText: 'local search unavailable' }).waitFor();
    await page.locator('#organizer-view-btn').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#zip-export-btn').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^tripsort-organized-\d{4}-\d{2}-\d{2}\.zip$/);
    assert.equal(fs.readFileSync(await download.path(), 'utf8'), 'fake zip bytes');
    assert.equal(zipExportRequests, 1);
    zipExportMode = 'error';
    await page.locator('#zip-export-btn').click();
    await page.locator('.toast', { hasText: 'ZIP export test failure' }).waitFor();
    assert.equal(zipExportRequests, 2);
    zipExportMode = 'success';
    await page.evaluate(() => {
      const pin = {
        id: 52,
        lat: 37.4563,
        lng: 126.7052,
        place: 'Incheon',
        date: '2026-05-09',
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
    assert.deepEqual(deletedPinIds.filter(id => ![39, 40, 41].includes(id)), [42, 52]);
    assert.equal(await page.evaluate(() => getPinById(52) == null), true);
    await page.locator('.pin-item[data-id="47"] .delete-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.pin-item[data-id="47"]').length === 0);
    assert.deepEqual(deletedPinIds.filter(id => ![39, 40, 41].includes(id)), [42, 52, 47]);
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
    }), '#5e6ad2');
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
    for (let i = 0; i < 30 && latestPin(48)?.place !== '0.000, 0.000'; i += 1) {
      await page.waitForTimeout(100);
    }
    const fallbackPin = latestPin(48);
    assert.equal(fallbackPin.place, '0.000, 0.000');
    assert.equal(fallbackPin.regionScope, 'international');
    const bulkResult = await page.evaluate(async () => {
      window.exifr.parse = async () => null;
      const originalSleep = window.sleep;
      const sleepCalls = [];
      window.sleep = async ms => { sleepCalls.push(ms); };
      const files = Array.from({ length: 12 }, (_, index) => (
        new File([`bulk image ${index}`], `bulk-${index}.jpg`, { type: 'image/jpeg' })
      ));
      await handleFiles(files);
      window.sleep = originalSleep;
      return {
        sleepCalls,
        added: getAllPins().filter(pin => pin.sourcePhoto?.originalFilename?.startsWith('bulk-')).length,
        progressText: document.querySelector('#upload-progress')?.textContent || '',
        resultStatus: document.querySelector('#organization-result-status')?.textContent || '',
        zipDisabled: document.querySelector('#zip-export-btn')?.disabled,
        organizerHidden: document.querySelector('#organizer-workspace')?.hidden,
        resultHighlighted: document.querySelector('#organization-section')?.classList.contains('result-ready'),
      };
    });
    assert.equal(bulkResult.sleepCalls.includes(1100), false);
    assert.equal(bulkResult.added, 12);
    assert.equal(bulkResult.progressText, '12개 사진 가져오기 완료');
    assert.match(bulkResult.resultStatus, /사진 정리/);
    assert.equal(bulkResult.zipDisabled, false);
    assert.equal(bulkResult.organizerHidden, false);
    assert.equal(bulkResult.resultHighlighted, true);
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
    assert.equal(await page.locator('#export-btn').isDisabled(), true);
    assert.equal(await page.locator('#zip-export-btn').isDisabled(), true);
    assert.deepEqual(
      browserErrors.filter(message => !message.includes('400 (Bad Request)')),
      [],
    );
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
