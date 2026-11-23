/**
 * Desktop shell: runs the bundled server with the bundled Bun, shows the web UI in a window, and
 * keeps running in the tray when the window is closed. "Start at login" lives in the tray menu and
 * in the window's Sakuya menu, so turning it off is one click from either.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import electronUpdater from 'electron-updater';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUpdater } from './updates.js';

// electron-updater runs the new AppImage once with this set after installing it on quit; the
// process it starts must not open a second Sakuya.
if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === 'true') process.exit(0);
// The new AppImage that "Restart to update" starts can come up before this one has let go of the
// lock, so it waits for it instead of exiting.
if (!(await singleInstanceLock(process.env.APPIMAGE_SILENT_INSTALL === 'true' ? 15_000 : 0))) process.exit(0);

async function singleInstanceLock(waitMs) {
  const deadline = Date.now() + waitMs;
  while (!app.requestSingleInstanceLock()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return true;
}

const appDir = app.isPackaged
  ? path.join(process.resourcesPath, 'sakuya')
  : path.join(import.meta.dirname, 'stage', 'sakuya');
const icon = nativeImage.createFromPath(path.join(appDir, 'apps/web/dist/icon.png'));

// The install folder is read-only (an AppImage mount) or replaced on update, so config and data
// live in ~/.sakuya — the same folder the server already prefers when it exists.
const dataDir = path.join(os.homedir(), '.sakuya');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, 'desktop.log');
const log = fs.createWriteStream(logFile);
const logLine = (line) => log.write(`${new Date().toISOString()} ${line}\n`);
// Lets this process call its own server's API when auth is on; it never leaves this machine.
const desktopToken = crypto.randomBytes(32).toString('hex');

let url = null;
let win = null;
let tray = null;
let wantWindow = !process.argv.includes('--hidden');
let quitting = false;
let server = null;
let updater = null;

// --- Start at login ---------------------------------------------------------------------------

// Linux has no login-item API; the XDG autostart folder is what every desktop reads.
const autostartFile = path.join(app.getPath('appData'), 'autostart', 'sakuya.desktop');

function autostartEnabled() {
  if (process.platform === 'linux') return fs.existsSync(autostartFile);
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}

function setAutostart(on) {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  } else if (on) {
    fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
    fs.writeFileSync(
      autostartFile,
      `[Desktop Entry]\nType=Application\nName=Sakuya\nExec="${process.env.APPIMAGE}" --hidden\nTerminal=false\n`,
    );
  } else {
    fs.rmSync(autostartFile, { force: true });
  }
  refreshMenus();
}

// --- Window and menus -------------------------------------------------------------------------

function show() {
  if (!url) {
    wantWindow = true; // still starting; opens once the server is up
    return;
  }
  if (!win) {
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      icon,
      autoHideMenuBar: true,
      show: false,
      webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true },
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      shell.openExternal(target);
      return { action: 'deny' };
    });
    win.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      win.hide();
    });
    win.loadURL(url);
  }
  win.show();
  win.focus();
}

function updateMenuItem() {
  const state = updater?.getState();
  if (!state) return { label: 'Check for Updates', enabled: false };
  if (state.status === 'ready')
    return { label: `Restart to Update (${state.version})`, click: () => updater.install() };
  if (state.status === 'downloading') return { label: `Downloading Update… ${state.percent}%`, enabled: false };
  if (state.status === 'installing') return { label: 'Installing Update…', enabled: false };
  if (state.status === 'checking') return { label: 'Checking for Updates…', enabled: false };
  return { label: 'Check for Updates', click: () => updater.check({ manual: true }) };
}

function sakuyaMenu() {
  return [
    { label: `Sakuya ${app.getVersion()}`, enabled: false },
    { label: 'Open Sakuya', click: show },
    { label: 'Open in Browser', enabled: !!url, click: () => shell.openExternal(url) },
    { type: 'separator' },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: autostartEnabled(),
      // Outside an AppImage there is no stable path to start (a dev run, an extracted AppImage).
      enabled: process.platform !== 'linux' || !!process.env.APPIMAGE,
      click: (item) => setAutostart(item.checked),
    },
    { type: 'separator' },
    updateMenuItem(),
    {
      label: 'Update Automatically',
      type: 'checkbox',
      checked: updater?.getState().autoUpdate ?? true,
      enabled: !!updater,
      click: (item) => updater.setAutoUpdate(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit Sakuya', click: () => app.quit() },
  ];
}

function refreshMenus() {
  tray?.setContextMenu(Menu.buildFromTemplate(sakuyaMenu()));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ label: 'Sakuya', submenu: sakuyaMenu() }, { role: 'editMenu' }, { role: 'viewMenu' }]),
  );
}

// --- Server -----------------------------------------------------------------------------------

function startServer() {
  const bun = path.join(appDir, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  server = spawn(bun, ['apps/server/src/launch.ts'], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SAKUYA_CONFIG: path.join(dataDir, 'sakuya.config.json'),
      SAKUYA_DESKTOP: '1',
      SAKUYA_DESKTOP_TOKEN: desktopToken,
    },
    windowsHide: true,
  });
  server.stderr.pipe(log, { end: false });
  server.stdout.on('data', (chunk) => {
    log.write(chunk);
    const match = !url && /listening on (http:\/\/\S+)/.exec(chunk.toString());
    if (!match) return;
    url = match[1];
    refreshMenus();
    if (wantWindow) show();
  });
  server.on('exit', (code) => {
    if (quitting) return;
    dialog.showErrorBox('Sakuya stopped', `The Sakuya server exited (code ${code}). Details are in ${logFile}`);
    app.quit();
  });
}

function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  // launch.ts forwards SIGTERM to the server, but Windows has no signals: kill the whole tree.
  if (process.platform !== 'win32') server.kill('SIGTERM');
  else
    try {
      execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    } catch {}
}

// --- Updates ----------------------------------------------------------------------------------

async function api(pathname, init) {
  const res = await fetch(new URL(pathname, url), {
    ...init,
    headers: { 'X-Sakuya-Desktop-Token': desktopToken },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${pathname} answered ${res.status}`);
  return res.json();
}

/** Back up the database through the server, then stop it, so the new version starts from a quiet, saved state. */
async function beforeInstall() {
  try {
    if (!url) throw new Error('the server is not running');
    const job = await api('/api/backups', { method: 'POST' });
    const deadline = Date.now() + 120_000;
    for (;;) {
      const row = (await api('/api/jobs')).find((j) => j.id === job.id);
      if (row?.status === 'done' || row?.status === 'error') {
        logLine(`[updates] pre-update backup ${row.status}: ${row.log}`);
        break;
      }
      if (Date.now() > deadline) throw new Error('the backup did not finish in 2 minutes');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (err) {
    logLine(`[updates] pre-update backup skipped: ${err.message}`);
  }
  quitting = true;
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  stopServer();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
}

function broadcastUpdate(state) {
  refreshMenus();
  win?.webContents.send('update:changed', state);
}

function startUpdater() {
  const { autoUpdater } = electronUpdater;
  // A local feed for trying a release before it is published (and for the update tests).
  if (process.env.SAKUYA_UPDATE_FEED) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.SAKUYA_UPDATE_FEED });
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  } else if (!app.isPackaged) {
    return; // a dev run has no feed to update from
  }
  updater = createUpdater({
    autoUpdater,
    currentVersion: app.getVersion(),
    settingsFile: path.join(dataDir, 'desktop.json'),
    log: logLine,
    beforeInstall,
    onChange: broadcastUpdate,
  });
  // The page only gets these calls if it was served by our own server.
  const fromApp = (event) => !!url && new URL(event.senderFrame?.url ?? 'about:blank').origin === new URL(url).origin;
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => (fromApp(event) ? fn(...args) : null));
  handle('update:state', () => updater.getState());
  handle('update:check', () => updater.check({ manual: true }));
  handle('update:install', () => updater.install());
  handle('update:auto', (on) => updater.setAutoUpdate(on));
  handle('update:dismiss', () => updater.dismissUpdated());
  updater.start();
}

app.on('second-instance', show);
app.on('window-all-closed', () => {}); // the window only hides; quitting is explicit
app.on('before-quit', () => {
  quitting = true;
  stopServer();
});

app.whenReady().then(() => {
  tray = new Tray(icon.resize({ width: 24 }));
  tray.setToolTip('Sakuya');
  tray.on('click', show);
  // A new release is a new AppImage file; point the login entry at the one running now.
  if (process.platform === 'linux' && process.env.APPIMAGE && autostartEnabled()) setAutostart(true);
  startUpdater();
  refreshMenus();
  startServer();
});
