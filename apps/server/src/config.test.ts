import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, DEFAULT_CONFIG, REPO_ROOT, loadConfig, parseMemory } from '@sakuya/shared/config';

/**
 * loadConfig takes its environment as an argument and SAKUYA_CONFIG points it at a throwaway file,
 * so none of this touches the real sakuya.config.json or process.env.
 */
function scratch(files: Record<string, string> = {}): { dir: string; env: Record<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-config-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return { dir, env: { SAKUYA_CONFIG: path.join(dir, 'sakuya.config.json') } };
}

const withFile = (config: unknown) => scratch({ 'sakuya.config.json': JSON.stringify(config) });

describe('loading', () => {
  test('a missing file reads as the defaults, and is only created when asked', () => {
    const { dir, env } = scratch();
    expect(loadConfig({ env }).config).toEqual(DEFAULT_CONFIG);
    expect(fs.existsSync(path.join(dir, 'sakuya.config.json'))).toBe(false);

    const created = loadConfig({ env, create: true });
    expect(created.created).toContain('with the defaults');
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'sakuya.config.json'), 'utf8'));
    // Every setting is spelled out, so the file doubles as the list of what can be changed.
    expect(written.server).toEqual(DEFAULT_CONFIG.server);
    expect(written.limits).toEqual({ cpus: null, memory: null });

    // Second start: nothing new to announce.
    expect(loadConfig({ env, create: true }).created).toBeNull();
  });

  /** The committed example is the reference for every setting; it must not drift from a real first run. */
  test('sakuya.config.example.json is exactly what a first run writes', () => {
    const { dir, env } = scratch();
    loadConfig({ env, create: true });
    expect(fs.readFileSync(path.join(dir, 'sakuya.config.json'), 'utf8')).toBe(
      fs.readFileSync(path.join(REPO_ROOT, 'sakuya.config.example.json'), 'utf8'),
    );
  });

  test('a partial file keeps the defaults for everything it leaves out', () => {
    const { env } = withFile({ server: { port: 4000 }, limits: { memory: '1.5g' } });
    const { config } = loadConfig({ env });
    expect(config.server.port).toBe(4000);
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.limits.memory).toBe(Math.floor(1.5 * 1024 ** 3));
  });

  test('a relative dataDir is relative to the config file, not the working directory', () => {
    const { dir, env } = withFile({ server: { dataDir: 'my-data' } });
    expect(loadConfig({ env }).config.server.dataDir).toBe(path.join(dir, 'my-data'));
  });

  /** One file is the only knob, so a typo must not quietly revert to a default. */
  test('malformed values are errors that name the setting', () => {
    const cases: [unknown, string][] = [
      [{ server: { port: 'eighty' } }, 'server.port'],
      [{ server: { port: 70000 } }, 'server.port'],
      [{ auth: { enabled: 'yes' } }, 'auth.enabled'],
      [{ limits: { cpus: 0 } }, 'limits.cpus'],
      [{ limits: { memory: 'lots' } }, 'limits.memory'],
      [{ server: 'nope' }, 'server'],
    ];
    for (const [config, key] of cases) {
      const { env } = withFile(config);
      expect(() => loadConfig({ env })).toThrow(key);
    }
  });

  test('invalid JSON is a ConfigError naming the file', () => {
    const { env } = scratch({ 'sakuya.config.json': '{ "server": { "port": 3777, } }' });
    expect(() => loadConfig({ env })).toThrow(ConfigError);
    expect(() => loadConfig({ env })).toThrow('sakuya.config.json');
  });

  test('unknown keys warn instead of failing', () => {
    const { env } = withFile({ $schema: 'x', server: { prot: 1 }, extra: true });
    const { warnings } = loadConfig({ env });
    expect(warnings.some((w) => w.includes('"server.prot"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"extra"'))).toBe(true);
    expect(warnings.some((w) => w.includes('$schema'))).toBe(false);
  });
});

describe('environment variables', () => {
  test('outside Docker they are ignored, and said to be', () => {
    const { env } = withFile({ server: { port: 4000 } });
    const loaded = loadConfig({ env: { ...env, SAKUYA_PORT: '5000', PORT: '6000', SAKUYA_MAX_CPUS: '1' } });
    expect(loaded.config.server.port).toBe(4000);
    expect(loaded.config.limits.cpus).toBeNull();
    expect(loaded.warnings.join()).toContain('SAKUYA_PORT');
    expect(loaded.warnings.join()).toContain('PORT');
  });

  test('inside the Docker image they override the file', () => {
    const { env } = withFile({
      server: { port: 4000, host: '127.0.0.1', dataDir: '/home/me/.sakuya' },
      auth: { secret: 'pw' },
    });
    const { config, warnings } = loadConfig({
      env: {
        ...env,
        SAKUYA_DOCKER: '1',
        SAKUYA_PORT: '3777',
        SAKUYA_HOST: '0.0.0.0',
        SAKUYA_DATA_DIR: '/data',
        SAKUYA_AUTH_ENABLED: 'true',
      },
    });
    expect(config.server).toEqual({ port: 3777, host: '0.0.0.0', dataDir: '/data', https: false });
    expect(config.auth).toEqual({ enabled: true, secret: 'pw' });
    expect(warnings).toEqual([]);
  });

  test('a bad override gets the same validation as the file', () => {
    const { env } = withFile({});
    expect(() => loadConfig({ env: { ...env, SAKUYA_DOCKER: '1', SAKUYA_MAX_MEMORY: 'lots' } })).toThrow(
      'limits.memory',
    );
  });

  test('the Docker image never writes a config file', () => {
    const { dir, env } = scratch();
    loadConfig({ env: { ...env, SAKUYA_DOCKER: '1' }, create: true });
    expect(fs.existsSync(path.join(dir, 'sakuya.config.json'))).toBe(false);
  });

  /**
   * The one ignored variable that can't just be a warning: a login switched on the old way must not
   * upgrade into a server that is silently open.
   */
  test('an old AUTH_ENABLED=true with auth off in the file refuses to start', () => {
    const { env } = withFile({});
    expect(() => loadConfig({ env: { ...env, AUTH_ENABLED: 'true' } })).toThrow('auth.enabled');
    expect(() => loadConfig({ env: { ...env, SAKUYA_DOCKER: '1', AUTH_ENABLED: 'true' } })).toThrow(
      'SAKUYA_AUTH_ENABLED',
    );
    // Agreeing is fine.
    const agreed = withFile({ auth: { enabled: true, secret: 'pw' } });
    expect(loadConfig({ env: { ...agreed.env, AUTH_ENABLED: 'true' } }).config.auth.enabled).toBe(true);
  });
});

describe('migrating from .env', () => {
  test('a first start carries old .env settings into the new file', () => {
    const { dir, env } = scratch({
      '.env': 'PORT=4000\nSAKUYA_MAX_CPUS=2\n',
      // apps/server/.env is the one Bun actually loaded, so it wins over the root one.
      'apps/server/.env': 'AUTH_ENABLED=true\nAUTH_SECRET="hunter2"\nPORT=4100\n',
    });
    const loaded = loadConfig({ env, create: true });
    expect(loaded.created).toContain('.env');
    expect(loaded.config.server.port).toBe(4100);
    expect(loaded.config.auth).toEqual({ enabled: true, secret: 'hunter2' });
    expect(loaded.config.limits.cpus).toBe(2);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'sakuya.config.json'), 'utf8'));
    expect(written.auth).toEqual({ enabled: true, secret: 'hunter2' });
  });

  test('an existing file is never rewritten from .env', () => {
    const { env } = scratch({ 'sakuya.config.json': '{}', '.env': 'PORT=4000\n' });
    const loaded = loadConfig({ env, create: true });
    expect(loaded.created).toBeNull();
    expect(loaded.config.server.port).toBe(3777);
  });
});

describe('parseMemory', () => {
  test("accepts the suffixes Docker's mem_limit accepts", () => {
    expect(parseMemory('2g')).toBe(2 * 1024 ** 3);
    expect(parseMemory('2G')).toBe(2 * 1024 ** 3);
    expect(parseMemory('2gb')).toBe(2 * 1024 ** 3);
    expect(parseMemory('512m')).toBe(512 * 1024 ** 2);
    expect(parseMemory('1.5G')).toBe(Math.floor(1.5 * 1024 ** 3));
    expect(parseMemory('1024')).toBe(1024);
    expect(parseMemory(1024)).toBe(1024);
  });

  test('rejects junk', () => {
    expect(parseMemory(undefined)).toBeNull();
    expect(parseMemory('')).toBeNull();
    expect(parseMemory('lots')).toBeNull();
    expect(parseMemory('2x')).toBeNull();
    expect(parseMemory('-2g')).toBeNull();
    expect(parseMemory(0)).toBeNull();
  });
});
