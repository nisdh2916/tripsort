const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_URL = 'http://127.0.0.1:5000';
const BACKEND_PING_URL = `${BACKEND_URL}/ping`;
let backendProcess = null;

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

async function waitForBackend() {
  for (let i = 0; i < 60; i++) {
    if (await requestOk(BACKEND_PING_URL)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

function pythonPath() {
  const local = process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  return fs.existsSync(local) ? local : 'python';
}

async function ensureBackend() {
  if (await requestOk(BACKEND_PING_URL)) return;

  backendProcess = spawn(pythonPath(), ['app.py'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PINDROP_HOST: process.env.PINDROP_HOST || '127.0.0.1',
      PINDROP_PORT: '5000',
      PINDROP_CORS_ORIGINS: 'http://localhost:5000,http://127.0.0.1:5000',
    },
    windowsHide: true,
    stdio: 'ignore',
  });

  const ready = await waitForBackend();
  if (!ready) {
    throw new Error('Flask backend did not start on port 5000.');
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'Pindrop',
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(BACKEND_URL);
}

app.whenReady().then(async () => {
  try {
    await ensureBackend();
    createWindow();
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Pindrop 실행 실패',
      message: 'Pindrop 서버를 시작하지 못했습니다.',
      detail: error.message,
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
