import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { registerCaptureHandlers } from './ipc/capture';
import { registerGenerateHandlers } from './ipc/generate';
import { registerSettingsHandlers } from './ipc/settings';
import { KeyStore } from './KeyStore';
import { SettingsStore } from './SettingsStore';
import { VaultRegistry } from './VaultRegistry';

// Tests point userData at a temp dir so they never touch a real profile.
if (process.env.LODE_USER_DATA) app.setPath('userData', process.env.LODE_USER_DATA);

function isHttp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Lode — Mine what you learn',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // No in-app navigation or popups: links go to the system browser, http/https only.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  const settings = new SettingsStore(app.getPath('userData'));
  const registry = new VaultRegistry(settings);
  const keys = new KeyStore(app.getPath('userData'), async () => (await settings.get()).allowWeakKeyStorage);
  registerCaptureHandlers(registry);
  registerSettingsHandlers(settings, keys, app.isPackaged);
  registerGenerateHandlers(registry, settings, keys);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
