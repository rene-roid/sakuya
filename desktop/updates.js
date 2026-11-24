/**
 * The desktop app's update state machine, driven by electron-updater's autoUpdater events:
 *
 *   idle ──check──▶ checking ──available──▶ downloading ──downloaded──▶ ready ──install──▶ installing
 *                      │                         │
 *                      └──not available / error──┴──▶ idle (up to date) or error
 *
 * No Electron import, so it runs under plain node with a fake autoUpdater (test/updates.test.js).
 * The settings live in ~/.sakuya/desktop.json next to the server's own config.
 */
import fs from 'node:fs';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 10_000;

export function readDesktopSettings(file) {
  try {
    return { autoUpdate: true, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { autoUpdate: true };
  }
}

function writeDesktopSettings(file, settings) {
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * @param {object} opts
 * @param {import('electron-updater').AppUpdater} opts.autoUpdater
 * @param {string} opts.currentVersion the running app's version
 * @param {string} opts.settingsFile path of desktop.json
 * @param {(line: string) => void} opts.log
 * @param {() => Promise<void>} opts.beforeInstall backs up and stops the server; may throw
 * @param {(state: object) => void} opts.onChange
 * @param {() => void} [opts.afterFailedInstall] undoes beforeInstall when the install did not quit the app
 */
export function createUpdater({
  autoUpdater,
  currentVersion,
  settingsFile,
  log,
  beforeInstall,
  onChange,
  afterFailedInstall = () => {},
}) {
  let settings = readDesktopSettings(settingsFile);
  let timer = null;
  let firstCheck = null;

  // A version recorded as downloaded last run and now running means the install on quit happened.
  let justUpdated = null;
  if (settings.pendingVersion) {
    if (settings.pendingVersion === currentVersion) justUpdated = currentVersion;
    settings = { ...settings, pendingVersion: undefined };
    writeDesktopSettings(settingsFile, settings);
  }

  let state = {
    status: 'idle',
    currentVersion,
    version: null,
    percent: 0,
    error: null,
    checkedAt: null,
    justUpdated,
    autoUpdate: settings.autoUpdate,
  };

  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = settings.autoUpdate;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'idle', version: null, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (progress) => {
    if (state.status === 'downloading') set({ percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    settings = { ...settings, pendingVersion: info.version };
    writeDesktopSettings(settingsFile, settings);
    set({ status: 'ready', version: info.version, percent: 100, checkedAt: Date.now() });
  });
  // electron-updater reports a failed quitAndInstall (an AppImage run without APPIMAGE, an
  // unwritable install folder) as an error event and leaves the app running, server stopped.
  const installFailed = (message) => {
    set({ status: 'error', error: message.split('\n')[0], checkedAt: Date.now() });
    afterFailedInstall();
  };

  autoUpdater.on('error', (err) => {
    const message = err?.message ?? String(err);
    log(`[updates] ${message}`);
    if (state.status === 'installing') return installFailed(message);
    // Back to where a retry makes sense; the next periodic check tries again.
    if (state.status !== 'ready') set({ status: 'error', error: message.split('\n')[0], checkedAt: Date.now() });
  });

  /** A manual check runs even with automatic updates off: the user asked for it. */
  async function check({ manual = false } = {}) {
    if (!manual && !settings.autoUpdate) return;
    if (['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // Already reported through the 'error' event.
    }
  }

  function schedule() {
    clearTimeout(firstCheck);
    clearInterval(timer);
    firstCheck = timer = null;
    if (!settings.autoUpdate) return;
    firstCheck = setTimeout(() => check(), FIRST_CHECK_MS);
    timer = setInterval(() => check(), CHECK_EVERY_MS);
  }

  async function install() {
    if (state.status !== 'ready') return;
    set({ status: 'installing' });
    try {
      await beforeInstall();
    } catch (err) {
      log(`[updates] pre-update step failed, installing anyway: ${err?.message ?? err}`);
    }
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      const message = err?.message ?? String(err);
      log(`[updates] install failed: ${message}`);
      if (state.status === 'installing') installFailed(message);
    }
  }

  function setAutoUpdate(on) {
    settings = { ...settings, autoUpdate: !!on };
    writeDesktopSettings(settingsFile, settings);
    autoUpdater.autoInstallOnAppQuit = settings.autoUpdate;
    set({ autoUpdate: settings.autoUpdate });
    schedule();
  }

  return {
    start: schedule,
    stop() {
      clearTimeout(firstCheck);
      clearInterval(timer);
    },
    check,
    install,
    setAutoUpdate,
    dismissUpdated: () => set({ justUpdated: null }),
    getState: () => state,
  };
}
