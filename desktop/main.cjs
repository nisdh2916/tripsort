const { app, BrowserWindow, dialog, nativeTheme, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_HOST = '127.0.0.1';
const APP_ID = 'local.tripsort.app';
const WINDOW_ICON = path.join(ROOT, 'build', 'icon.ico');
let backendProcess = null;
let activeBackend = null;
let mainWindow = null;
let isQuitting = false;

function backendUrl(port) {
  return `http://${BACKEND_HOST}:${port}`;
}

function backendTarget(port) {
  const url = backendUrl(port);
  return {
    port,
    url,
    pingUrl: `${url}/ping`,
  };
}

function requestOk(url) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.get(url, res => {
      res.resume();
      finish(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => finish(false));
    req.setTimeout(1000, () => {
      req.destroy();
      finish(false);
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, BACKEND_HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForBackend(backend) {
  for (let i = 0; i < 80; i++) {
    if (await requestOk(backend.pingUrl)) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function pythonPath() {
  const local = process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  return fs.existsSync(local) ? local : 'python';
}

function desktopDataPaths() {
  const dataRoot = path.join(app.getPath('userData'), 'data');
  const uploadFolder = path.join(dataRoot, 'uploads');
  fs.mkdirSync(uploadFolder, { recursive: true });
  return {
    dataRoot,
    uploadFolder,
    pinsFile: path.join(dataRoot, 'pins.json'),
  };
}

function corsOrigins(port) {
  return [
    backendUrl(port),
    `http://localhost:${port}`,
  ].join(',');
}

async function resolveBackendTarget() {
  const requestedPort = Number.parseInt(process.env.PINDROP_PORT || '', 10);
  const port = Number.isInteger(requestedPort) && requestedPort > 0
    ? requestedPort
    : await findFreePort();
  return backendTarget(port);
}

function spawnBackend(backend) {
  const dataPaths = desktopDataPaths();
  backendProcess = spawn(pythonPath(), ['app.py'], {
    cwd: ROOT,
    env: {
      ...process.env,
      FLASK_ENV: 'production',
      PINDROP_HOST: BACKEND_HOST,
      PINDROP_PORT: String(backend.port),
      PINDROP_CORS_ORIGINS: corsOrigins(backend.port),
      PINDROP_UPLOAD_FOLDER: dataPaths.uploadFolder,
      PINDROP_PINS_FILE: dataPaths.pinsFile,
      PINDROP_USE_RELOADER: '0',
    },
    windowsHide: true,
    stdio: 'ignore',
  });

  backendProcess.on('exit', () => {
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('TripSort backend stopped', 'The local TripSort service stopped unexpectedly.');
    }
  });
}

async function ensureBackend() {
  const backend = await resolveBackendTarget();
  if (await requestOk(backend.pingUrl)) return backend;

  spawnBackend(backend);
  const ready = await waitForBackend(backend);
  if (!ready) {
    throw new Error(`Flask backend did not start on ${backend.url}.`);
  }
  return backend;
}

function isInternalUrl(url, backend) {
  try {
    return new URL(url).origin === backend.url;
  } catch {
    return false;
  }
}

function createWindow(backend) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'TripSort',
    icon: fs.existsSync(WINDOW_ICON) ? WINDOW_ICON : undefined,
    backgroundColor: '#010102',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url, backend)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, backend)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.loadURL(backend.url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    try {
      activeBackend = await ensureBackend();
      createWindow(activeBackend);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'TripSort 실행 실패',
        message: 'TripSort 앱 서비스를 시작하지 못했습니다.',
        detail: error.message,
      });
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && activeBackend) {
      createWindow(activeBackend);
    }
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
