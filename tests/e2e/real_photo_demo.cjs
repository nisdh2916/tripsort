const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const demoPort = process.env.PINDROP_DEMO_PORT || String(5500 + Math.floor(Math.random() * 1000));
const baseUrl = process.env.PINDROP_DEMO_BASE_URL || `http://127.0.0.1:${demoPort}`;
const python = process.env.PYTHON || 'python';
const fixture = path.resolve(__dirname, '..', 'fixtures', 'gps_photo.jpg');

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
  for (let i = 0; i < attempts; i += 1) {
    if (await requestOk(url)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function startServer(tempRoot) {
  const url = new URL(baseUrl);
  const child = spawn(python, ['app.py'], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: {
      ...process.env,
      FLASK_ENV: 'production',
      PINDROP_HOST: url.hostname,
      PINDROP_PORT: url.port || demoPort,
      PINDROP_USE_RELOADER: '0',
      PINDROP_UPLOAD_FOLDER: path.join(tempRoot, 'uploads'),
      PINDROP_PINS_FILE: path.join(tempRoot, 'pins.json'),
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  if (!(await waitForServer(`${baseUrl}/ping`))) {
    child.kill();
    throw new Error('Flask demo server did not start');
  }

  return child;
}

async function main() {
  assert.ok(fs.existsSync(fixture), `Missing fixture: ${fixture}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pindrop-demo-'));
  const server = await startServer(tempRoot);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await page.route('**/globe.gl', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.Globe = function () {
            return function (el) {
              const canvas = document.createElement('canvas');
              canvas.width = 320;
              canvas.height = 180;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#0f4c81';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              el.appendChild(canvas);
              const controls = { autoRotate: false, autoRotateSpeed: 0 };
              const api = {
                controls: () => controls,
                pointOfView: () => api,
                globeImageUrl: () => api,
                bumpImageUrl: () => api,
                backgroundImageUrl: () => api,
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

    await page.route('**/exifr/dist/full.umd.js', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          function readAscii(view, offset, count) {
            let out = '';
            for (let i = 0; i < count; i += 1) {
              const code = view.getUint8(offset + i);
              if (code) out += String.fromCharCode(code);
            }
            return out;
          }

          function parseTiff(view, tiff) {
            const little = view.getUint16(tiff, false) === 0x4949;
            const read16 = offset => view.getUint16(offset, little);
            const read32 = offset => view.getUint32(offset, little);
            const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

            function valueOffset(entry, type, count) {
              return (typeSize[type] || 1) * count <= 4 ? entry + 8 : tiff + read32(entry + 8);
            }

            function parseIfd(offset) {
              const values = {};
              const entries = read16(offset);
              for (let i = 0; i < entries; i += 1) {
                const entry = offset + 2 + i * 12;
                const tag = read16(entry);
                const type = read16(entry + 2);
                const count = read32(entry + 4);
                values[tag] = { type, count, offset: valueOffset(entry, type, count) };
              }
              return values;
            }

            function rationalAt(offset) {
              const denominator = read32(offset + 4);
              return denominator ? read32(offset) / denominator : 0;
            }

            function gpsCoord(value, ref) {
              const deg = rationalAt(value.offset);
              const min = rationalAt(value.offset + 8);
              const sec = rationalAt(value.offset + 16);
              const sign = ref === 'S' || ref === 'W' ? -1 : 1;
              return sign * (deg + min / 60 + sec / 3600);
            }

            const ifd0 = parseIfd(tiff + read32(tiff + 4));
            const exif = ifd0[0x8769] ? parseIfd(tiff + read32(ifd0[0x8769].offset)) : {};
            const gps = ifd0[0x8825] ? parseIfd(tiff + read32(ifd0[0x8825].offset)) : {};
            const latRef = gps[1] ? readAscii(view, gps[1].offset, gps[1].count) : '';
            const lngRef = gps[3] ? readAscii(view, gps[3].offset, gps[3].count) : '';
            const dateTag = exif[0x9003] || ifd0[0x0132];
            return {
              latitude: gps[2] ? gpsCoord(gps[2], latRef) : null,
              longitude: gps[4] ? gpsCoord(gps[4], lngRef) : null,
              DateTimeOriginal: dateTag ? readAscii(view, dateTag.offset, dateTag.count) : null,
            };
          }

          window.exifr = {
            parse: async file => {
              const view = new DataView(await file.arrayBuffer());
              let offset = 2;
              while (offset + 4 < view.byteLength) {
                if (view.getUint8(offset) !== 0xff) break;
                const marker = view.getUint8(offset + 1);
                const size = view.getUint16(offset + 2, false);
                if (marker === 0xe1 && readAscii(view, offset + 4, 6) === 'Exif') {
                  return parseTiff(view, offset + 10);
                }
                offset += 2 + size;
              }
              return null;
            },
          };
        `,
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
              this._container.dataset.maplibreInitialized = 'true';
              this._container.dataset.maplibreStyle = options.style;
              this.loaded = () => true;
              this.on = (_event, cb) => { setTimeout(cb, 0); return this; };
              this.addControl = () => this;
              this.resize = () => this;
              this.flyTo = () => this;
              this.fitBounds = () => this;
              this.addSource = () => this;
              this.getSource = () => null;
              this.addLayer = () => this;
              this.getLayer = () => null;
            },
            Marker: function ({ element }) {
              this.setLngLat = lngLat => {
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
              this.extend = () => this;
            },
          };
        `,
      });
    });

    await page.route(`${baseUrl}/favicon.ico`, route => route.fulfill({ status: 204, body: '' }));
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
          ollama: false,
          models: [],
          indexed: 0,
          required_models: {
            rerank: { name: 'llama3.2', available: false },
            vision: { name: 'llama3.2-vision', available: false },
          },
        }),
      });
    });
    await page.route(`${baseUrl}/reverse-geocode**`, route => {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ place: '서울특별시' }) });
    });
    await page.route(`${baseUrl}/index`, route => {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'local search unavailable' }) });
    });
    await page.route(`${baseUrl}/search`, route => {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'local search unavailable' }) });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => window.exifr?.parse, undefined, { timeout: 5000 });
    } catch (error) {
      console.error('browserErrors:', browserErrors);
      console.error('scripts:', await page.evaluate(() => Array.from(document.scripts).map(script => script.src)));
      throw error;
    }
    await page.setInputFiles('#file-input', fixture);
    await page.waitForSelector('.pin-item[data-id="1"]');
    await page.locator('.pin-item[data-id="1"] .status', { hasText: '완료' }).waitFor();

    await page.waitForFunction(() => document.querySelector('#globe')?.dataset.mapView === 'global');
    assert.equal(await page.locator('#globe .korea-map-surface').count(), 0);
    assert.equal(await page.locator('#globe .global-map-canvas').count(), 1);
    assert.equal(await page.locator('#pin-list .pin-item[data-id="1"]').count(), 1);
    assert.equal(await page.locator('#overseas-empty-state').isVisible(), true);
    assert.equal(await page.locator('#ai-status-vision').innerText(), '모델 없음');
    assert.equal(await page.locator('#ai-status-rerank').innerText(), '모델 없음');
    assert.equal(await page.locator('.pin-item[data-id="1"] .place').innerText(), '서울특별시');
    assert.match(await page.locator('.pin-item[data-id="1"] .date').innerText(), /2026년 4월 30일/);
    assert.equal(await page.locator('#globe').getAttribute('data-point-count'), '1');
    assert.equal(await page.locator('#globe .global-map-pin').count(), 1);

    const point = await page.evaluate(() => JSON.parse(document.querySelector('#globe').dataset.lastPoints)[0]);
    assert.ok(Math.abs(point.lat - 37.5665) < 0.0001, `Unexpected latitude: ${point.lat}`);
    assert.ok(Math.abs(point.lng - 126.978) < 0.0001, `Unexpected longitude: ${point.lng}`);
    const lngLat = await page.evaluate(() => {
      const pin = document.querySelector('#globe .global-map-pin');
      return JSON.parse(pin.dataset.lngLat);
    });
    assert.ok(Math.abs(lngLat[0] - 126.978) < 0.0001, `Unexpected marker longitude: ${lngLat[0]}`);
    assert.ok(Math.abs(lngLat[1] - 37.5665) < 0.0001, `Unexpected marker latitude: ${lngLat[1]}`);

    await page.locator('.pin-item[data-id="1"]').click();
    await page.waitForSelector('#popup.visible');
    assert.match(await page.locator('#popup .coords').innerText(), /37\.5665/);

    await page.locator('#search-input').fill('서울 사진');
    await page.locator('#search-btn').click();
    await page.locator('.toast', { hasText: 'local search unavailable' }).waitFor();

    assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
