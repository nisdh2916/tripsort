const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.route('https://unpkg.com/globe.gl', route => {
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.Globe = function () {
            return function (el) {
              const controls = { autoRotate: false, autoRotateSpeed: 0 };
              const api = {
                controls: () => controls,
                pointOfView: () => api,
                pointsData: data => {
                  el.dataset.pointCount = String((data || []).length);
                  return api;
                }
              };
              [
                'globeImageUrl', 'bumpImageUrl', 'backgroundImageUrl',
                'pointLat', 'pointLng', 'pointColor', 'pointRadius',
                'pointAltitude', 'pointLabel', 'onPointClick', 'onPointHover'
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

    await page.route(`${baseUrl}/pins`, route => {
      if (route.request().method() !== 'GET') return route.continue();
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
          },
        ]),
      });
    });

    await page.route(`${baseUrl}/pins/42`, route => {
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

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pin-item');

    assert.equal(await page.locator('h1').innerText(), 'Pindrop');
    assert.match(await page.locator('#pin-count').innerText(), /1개의 핀/);
    assert.equal(await page.locator('.pin-item .place').innerText(), '서울특별시');
    assert.equal(await page.locator('.filter-chip', { hasText: '도시' }).count(), 1);

    await page.locator('.pin-item').click();
    await page.waitForSelector('#popup.visible');
    assert.equal(await page.locator('#popup .place-name').innerText(), '서울특별시');
    assert.match(await page.locator('#popup .coords').innerText(), /37\.5665/);

    await page.locator('#popup-delete').click();
    await page.waitForSelector('.empty-state');
    assert.equal(await page.locator('.pin-item').count(), 0);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
