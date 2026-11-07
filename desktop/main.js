/**
 * Desktop shell: runs the bundled server with the bundled Bun, shows the web UI in a window, and
 * keeps running in the tray when the window is closed. "Start at login" lives in the tray menu and
 * in the window's Sakuya menu, so turning it off is one click from either.
 */
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!app.requestSingleInstanceLock()) process.exit(0);

const appDir = app.isPackaged
  ? path.join(process.resourcesPath, 'sakuya')
  : path.join(import.meta.dirname, 'stage', 'sakuya');
const icon = nativeImage.createFromPath(path.join(appDir, 'apps/web/dist/icon.png'));

// The install folder is read-only (an AppImage mount) or replaced on update, so config and data
// live in ~/.sakuya — the same folder the server already prefers when it exists.
const dataDir = path.join(os.homedir(), '.sakuya');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, 'desktop.log');

let url = null;
let win = null;
let tray = null;
let wantWindow = !process.argv.includes('--hidden');
let quitting = false;
let server = null;

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
    win = new BrowserWindow({ width: 1400, height: 900, icon, autoHideMenuBar: true, show: false });
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

function sakuyaMenu() {
  return [
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
  const log = fs.createWriteStream(logFile);
  const bun = path.join(appDir, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
  server = spawn(bun, ['apps/server/src/launch.ts'], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production', SAKUYA_CONFIG: path.join(dataDir, 'sakuya.config.json') },
    windowsHide: true,
  });
  server.stderr.pipe(log);
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
  if (!server || server.exitCode !== null) return;
  // launch.ts forwards SIGTERM to the server, but Windows has no signals: kill the whole tree.
  if (process.platform !== 'win32') server.kill('SIGTERM');
  else
    try {
      execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    } catch {}
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
  refreshMenus();
  startServer();
});
