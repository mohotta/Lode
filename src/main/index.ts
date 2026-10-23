import { join } from 'node:path';
import { app, BrowserWindow, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import { registerCaptureHandlers } from './ipc/capture';
import { registerGenerateHandlers } from './ipc/generate';
import { registerSettingsHandlers } from './ipc/settings';
import { KeyStore } from './KeyStore';
import { SettingsStore } from './SettingsStore';
import { VaultRegistry } from './VaultRegistry';
import { zoomFor } from './zoom';

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

/**
 * Ctrl/Cmd + "=" zooms in, "-" out, "0" resets (numpad keys too); the level is remembered in settings.
 * The saved level is applied at window creation (webPreferences.zoomFactor), not after load, so it can
 * never overwrite a zoom the user makes while the page is still loading.
 */
function enableZoom(win: BrowserWindow, settings: SettingsStore): void {
  const wc = win.webContents;
  wc.on('before-input-event', (event, input) => {
    const next = zoomFor(input, wc.getZoomLevel());
    if (next === null) return;
    event.preventDefault();
    wc.setZoomLevel(next);
    void settings.update((s) => ({ ...s, zoomLevel: next }));
  });
}

/** Right-click menu: spelling suggestions for a misspelled word, then the usual edit actions. */
function enableContextMenu(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false });
      items.push(
        {
          label: 'Add to dictionary',
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
        { type: 'separator' },
      );
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function createWindow(settings: SettingsStore, zoomLevel: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Lode - Mine what you learn',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    webPreferences: {
      // Chromium zoom levels are powers of 1.2.
      zoomFactor: Math.pow(1.2, zoomLevel),
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  enableZoom(win, settings);
  enableContextMenu(win);

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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  const settings = new SettingsStore(app.getPath('userData'));
  const registry = new VaultRegistry(settings);
  const keys = new KeyStore(app.getPath('userData'), async () => (await settings.get()).allowWeakKeyStorage);
  registerCaptureHandlers(registry);
  registerSettingsHandlers(settings, keys, app.isPackaged);
  registerGenerateHandlers(registry, settings, keys);

  const { zoomLevel } = await settings.get();
  createWindow(settings, zoomLevel);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void settings.get().then((s) => createWindow(settings, s.zoomLevel));
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
