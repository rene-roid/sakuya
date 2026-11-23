import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import { createUpdater, readDesktopSettings } from '../updates.js';

/** Stands in for electron-updater's autoUpdater: a check answers with whatever feed the test set up. */
function fakeAutoUpdater(feed) {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.installs = [];
  updater.checkForUpdates = async () => {
    updater.checks++;
    updater.emit('checking-for-update');
    if (feed.error) {
      updater.emit('error', new Error(feed.error));
      throw new Error(feed.error);
    }
    if (!feed.version) return updater.emit('update-not-available', {});
    updater.emit('update-available', { version: feed.version });
    for (const percent of [12.4, 57.8, 100]) updater.emit('download-progress', { percent });
    if (feed.downloadError) return updater.emit('error', new Error(feed.downloadError));
    updater.emit('update-downloaded', { version: feed.version });
  };
  updater.quitAndInstall = (...args) => updater.installs.push(args);
  return updater;
}

let dir;
let settingsFile;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-updates-'));
  settingsFile = path.join(dir, 'desktop.json');
});

function make(feed, extra = {}) {
  const autoUpdater = fakeAutoUpdater(feed);
  const states = [];
  const lines = [];
  const updater = createUpdater({
    autoUpdater,
    currentVersion: '1.7.0',
    settingsFile,
    log: (line) => lines.push(line),
    beforeInstall: async () => {},
    onChange: (state) => states.push(state),
    ...extra,
  });
  return { autoUpdater, updater, states, lines };
}

test('auto-update is on when desktop.json does not exist yet', () => {
  assert.deepEqual(readDesktopSettings(settingsFile), { autoUpdate: true });
  const { updater, autoUpdater } = make({});
  assert.equal(updater.getState().autoUpdate, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
});

test('a newer feed version reaches ready through checking and downloading', async () => {
  const { updater, states } = make({ version: '1.8.0' });
  await updater.check();
  assert.deepEqual(
    states.map((s) => [s.status, s.percent]),
    [
      ['checking', 0],
      ['downloading', 0],
      ['downloading', 12],
      ['downloading', 58],
      ['downloading', 100],
      ['ready', 100],
    ],
  );
  assert.equal(updater.getState().version, '1.8.0');
  assert.equal(readDesktopSettings(settingsFile).pendingVersion, '1.8.0');
});

test('no newer version leaves it idle with the check time recorded', async () => {
  const { updater } = make({});
  await updater.check();
  assert.equal(updater.getState().status, 'idle');
  assert.equal(typeof updater.getState().checkedAt, 'number');
});

test('with auto-update off it never checks on its own, but a manual check still runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  fs.writeFileSync(settingsFile, JSON.stringify({ autoUpdate: false }));
  const { updater, autoUpdater } = make({ version: '1.8.0' });
  updater.start();
  t.mock.timers.tick(7 * 60 * 60 * 1000);
  await updater.check();
  assert.equal(autoUpdater.checks, 0);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);

  await updater.check({ manual: true });
  assert.equal(autoUpdater.checks, 1);
  assert.equal(updater.getState().status, 'ready');
  updater.stop();
});

test('with auto-update on it checks 10 s after launch and every 6 hours', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { updater, autoUpdater } = make({});
  updater.start();
  t.mock.timers.tick(9_000);
  assert.equal(autoUpdater.checks, 0);
  t.mock.timers.tick(1_000);
  assert.equal(autoUpdater.checks, 1);
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  assert.equal(autoUpdater.checks, 2);
  updater.stop();
});

test('turning auto-update off is saved and stops install on quit', () => {
  const { updater, autoUpdater } = make({});
  updater.setAutoUpdate(false);
  assert.equal(readDesktopSettings(settingsFile).autoUpdate, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(updater.getState().autoUpdate, false);
});

test('a failed download ends in error with the reason logged, and a later check can retry', async () => {
  const feed = { version: '1.8.0', downloadError: 'sha512 checksum mismatch' };
  const { updater, autoUpdater, lines } = make(feed);
  await updater.check();
  assert.equal(updater.getState().status, 'error');
  assert.equal(updater.getState().error, 'sha512 checksum mismatch');
  assert.ok(lines.includes('[updates] sha512 checksum mismatch'));
  assert.equal(readDesktopSettings(settingsFile).pendingVersion, undefined);

  delete feed.downloadError;
  await updater.check();
  assert.equal(autoUpdater.checks, 2);
  assert.equal(updater.getState().status, 'ready');
});

test('an offline feed is an error state, not a crash', async () => {
  const { updater } = make({ error: 'net::ERR_CONNECTION_REFUSED' });
  await updater.check();
  assert.equal(updater.getState().status, 'error');
});

test('restart to update runs the backup step first, then quits and installs', async () => {
  const order = [];
  const { updater, autoUpdater, states } = make(
    { version: '1.8.0' },
    {
      beforeInstall: async () => {
        order.push('backup');
      },
    },
  );
  await updater.install(); // nothing downloaded yet
  assert.equal(autoUpdater.installs.length, 0);

  await updater.check();
  autoUpdater.quitAndInstall = (...args) => order.push(['quitAndInstall', ...args]);
  await updater.install();
  assert.deepEqual(order, ['backup', ['quitAndInstall', true, true]]);
  assert.equal(states.at(-1).status, 'installing');
});

test('a failing backup step does not block the update', async () => {
  const { updater, autoUpdater, lines } = make(
    { version: '1.8.0' },
    {
      beforeInstall: async () => {
        throw new Error('server unreachable');
      },
    },
  );
  await updater.check();
  await updater.install();
  assert.equal(autoUpdater.installs.length, 1);
  assert.ok(lines.some((l) => l.includes('server unreachable')));
});

test('an install that fails without quitting brings the server back and reports the error', async () => {
  let restarts = 0;
  const { updater, autoUpdater } = make({ version: '1.8.0' }, { afterFailedInstall: () => restarts++ });
  await updater.check();
  // What electron-updater does for an AppImage started without APPIMAGE: an error event, no quit.
  autoUpdater.quitAndInstall = () => autoUpdater.emit('error', new Error('APPIMAGE env is not defined'));
  await updater.install();
  assert.equal(restarts, 1);
  assert.equal(updater.getState().status, 'error');
  assert.equal(updater.getState().error, 'APPIMAGE env is not defined');
});

test('an install that throws brings the server back too', async () => {
  let restarts = 0;
  const { updater, autoUpdater } = make({ version: '1.8.0' }, { afterFailedInstall: () => restarts++ });
  await updater.check();
  autoUpdater.quitAndInstall = () => {
    throw new Error('EROFS: read-only file system');
  };
  await updater.install();
  assert.equal(restarts, 1);
  assert.equal(updater.getState().status, 'error');
});

test('the next start on the downloaded version reports it was updated, once', () => {
  fs.writeFileSync(settingsFile, JSON.stringify({ autoUpdate: true, pendingVersion: '1.7.0' }));
  const { updater } = make({});
  assert.equal(updater.getState().justUpdated, '1.7.0');
  assert.equal(readDesktopSettings(settingsFile).pendingVersion, undefined);
  updater.dismissUpdated();
  assert.equal(updater.getState().justUpdated, null);

  assert.equal(make({}).updater.getState().justUpdated, null);
});

test('a start on another version than the one downloaded does not claim an update', () => {
  fs.writeFileSync(settingsFile, JSON.stringify({ autoUpdate: true, pendingVersion: '1.9.0' }));
  const { updater } = make({});
  assert.equal(updater.getState().justUpdated, null);
  assert.equal(readDesktopSettings(settingsFile).pendingVersion, undefined);
});
