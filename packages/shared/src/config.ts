/**
 * sakuya.config.json: the one place Sakuya is configured.
 *
 * Read by the server, by its launcher (for the hard resource limits) and by the Vite dev server
 * (port, bind address, where to proxy /api), so a value changed there reaches everything that
 * depends on it. It used to be spread across a root .env that the server never actually loaded
 * (Bun reads .env from the working directory, and the server runs from apps/server), a second
 * apps/server/.env, and constants hardcoded in vite.config.ts.
 *
 * Environment variables are deliberately NOT a second source outside Docker: two places to set the
 * same thing is how the old setup ended up with a value that looked set and wasn't. Inside the
 * container they are the override mechanism, because compose has to pin things the file can't know
 * — the bind address, the port nginx proxies to, the data dir as mounted — see DOCKER_OVERRIDES.
 *
 * Runs under Node as well as Bun (Vite loads its config with Node), so: node: builtins only, and no
 * dependencies — the web workspace doesn't have zod.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SakuyaConfig {
  server: {
    port: number;
    /** Interface to bind. Loopback by default: the API serves the whole library and can open a file manager on the host. */
    host: string;
    /** Absolute path, or null to autodetect (~/.sakuya if it exists, else apps/server/data). */
    dataDir: string | null;
    /** Marks the auth cookie Secure. Only behind HTTPS — browsers drop Secure cookies over plain HTTP. */
    https: boolean;
  };
  web: {
    /** Vite dev server port. Docker serves the web app through nginx instead; publish that in compose. */
    port: number;
  };
  auth: {
    enabled: boolean;
    /** The login password. Changing it signs every session out. */
    secret: string;
  };
  limits: {
    /** CPU budget in cores, fractions allowed. null = no limit. */
    cpus: number | null;
    /** Memory ceiling in bytes (parsed from "2g" / "512m" / a byte count). null = no limit. */
    memory: number | null;
  };
}

type Env = Record<string, string | undefined>;

export const CONFIG_FILE_NAME = 'sakuya.config.json';

/** packages/shared/src -> repo root. Also right inside the Docker image, which mirrors the layout under /app. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const DEFAULT_CONFIG: SakuyaConfig = {
  server: { port: 3777, host: '127.0.0.1', dataDir: null, https: false },
  web: { port: 5173 },
  auth: { enabled: false, secret: '' },
  limits: { cpus: null, memory: null },
};

export class ConfigError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'ConfigError';
  }
}

const MEMORY_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};

/** Accepts what Docker's mem_limit accepts — "2g", "512m", "1.5G" — plus a bare byte count. */
export function parseMemory(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
  if (!raw) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === '' ? 1 : MEMORY_UNITS[unit];
  if (!multiplier || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value * multiplier);
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${Math.round(bytes / 1024 ** 2)} MiB`;
}

// --- Validation ------------------------------------------------------------------------------
//
// A malformed value is an error, not a silent fallback: this file is the only knob, and a typo that
// quietly reverted to the default would look exactly like a setting that works.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const KNOWN_KEYS: Record<string, string[]> = {
  '': ['$schema', 'server', 'web', 'auth', 'limits'],
  server: ['port', 'host', 'dataDir', 'https'],
  web: ['port'],
  auth: ['enabled', 'secret'],
  limits: ['cpus', 'memory'],
};

/**
 * Pure: validate parsed JSON into a full config, filling defaults for anything absent. Returns
 * warnings for unknown keys rather than failing on them — most likely a typo, worth saying out loud.
 */
export function parseConfig(raw: unknown, file: string, baseDir: string): { config: SakuyaConfig; warnings: string[] } {
  if (!isObject(raw)) throw new ConfigError(file, 'must contain a JSON object');
  const warnings: string[] = [];
  const section = (name: keyof SakuyaConfig): Record<string, unknown> => {
    const value = raw[name];
    if (value === undefined) return {};
    if (!isObject(value)) throw new ConfigError(file, `"${name}" must be an object`);
    return value;
  };
  for (const [prefix, keys] of Object.entries(KNOWN_KEYS)) {
    const obj = prefix ? raw[prefix] : raw;
    if (!isObject(obj)) continue;
    for (const key of Object.keys(obj)) {
      if (!keys.includes(key))
        warnings.push(`unknown setting "${prefix ? `${prefix}.` : ''}${key}" in ${file} is ignored`);
    }
  }

  const port = (obj: Record<string, unknown>, key: string, name: string, fallback: number): number => {
    const value = obj[key];
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
      throw new ConfigError(file, `"${name}" must be a port number (1-65535)`);
    }
    return value as number;
  };
  const bool = (obj: Record<string, unknown>, key: string, name: string, fallback: boolean): boolean => {
    const value = obj[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new ConfigError(file, `"${name}" must be true or false`);
    return value;
  };
  const string = (obj: Record<string, unknown>, key: string, name: string, fallback: string): string => {
    const value = obj[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string') throw new ConfigError(file, `"${name}" must be a string`);
    return value;
  };

  const server = section('server');
  const web = section('web');
  const auth = section('auth');
  const limits = section('limits');

  const host = string(server, 'host', 'server.host', DEFAULT_CONFIG.server.host).trim();
  if (!host) throw new ConfigError(file, '"server.host" must not be empty');

  const rawDataDir = server.dataDir;
  if (rawDataDir !== undefined && rawDataDir !== null && (typeof rawDataDir !== 'string' || !rawDataDir.trim())) {
    throw new ConfigError(file, '"server.dataDir" must be a path, or null to autodetect');
  }
  // Relative to the config file, not to wherever the process happened to start — that ambiguity
  // is exactly what the old cwd-relative .env got wrong.
  const dataDir = typeof rawDataDir === 'string' ? path.resolve(baseDir, rawDataDir.trim()) : null;

  const rawCpus = limits.cpus;
  if (
    rawCpus !== undefined &&
    rawCpus !== null &&
    (typeof rawCpus !== 'number' || !Number.isFinite(rawCpus) || rawCpus <= 0)
  ) {
    throw new ConfigError(file, '"limits.cpus" must be a positive number of cores (e.g. 2 or 1.5), or null');
  }

  const rawMemory = limits.memory;
  let memory: number | null = null;
  if (rawMemory !== undefined && rawMemory !== null) {
    memory = typeof rawMemory === 'string' || typeof rawMemory === 'number' ? parseMemory(rawMemory) : null;
    if (memory === null) throw new ConfigError(file, '"limits.memory" must be a size like "2g" or "512m", or null');
  }

  return {
    config: {
      server: {
        port: port(server, 'port', 'server.port', DEFAULT_CONFIG.server.port),
        host,
        dataDir,
        https: bool(server, 'https', 'server.https', DEFAULT_CONFIG.server.https),
      },
      web: { port: port(web, 'port', 'web.port', DEFAULT_CONFIG.web.port) },
      auth: {
        enabled: bool(auth, 'enabled', 'auth.enabled', DEFAULT_CONFIG.auth.enabled),
        secret: string(auth, 'secret', 'auth.secret', DEFAULT_CONFIG.auth.secret),
      },
      limits: { cpus: (rawCpus as number | null | undefined) ?? null, memory },
    },
    warnings,
  };
}

// --- Docker overrides ------------------------------------------------------------------------

/**
 * The only way to override the file, and only inside the image (the Dockerfile sets SAKUYA_DOCKER).
 * The image pins host, port and dataDir itself: the container must bind 0.0.0.0, nginx proxies to
 * a fixed port, and the host's dataDir path means nothing inside the container.
 */
export const DOCKER_OVERRIDES = {
  SAKUYA_PORT: 'server.port',
  SAKUYA_HOST: 'server.host',
  SAKUYA_DATA_DIR: 'server.dataDir',
  SAKUYA_HTTPS: 'server.https',
  SAKUYA_AUTH_ENABLED: 'auth.enabled',
  SAKUYA_AUTH_SECRET: 'auth.secret',
  SAKUYA_MAX_CPUS: 'limits.cpus',
  SAKUYA_MAX_MEMORY: 'limits.memory',
} as const;

/** Pre-config-file names, recognised only to migrate them into a new file and to warn when set. */
const LEGACY_ENV: Record<string, string> = {
  PORT: 'server.port',
  SAKUYA_HOST: 'server.host',
  SAKUYA_DATA_DIR: 'server.dataDir',
  SAKUYA_HTTPS: 'server.https',
  AUTH_ENABLED: 'auth.enabled',
  AUTH_SECRET: 'auth.secret',
  SAKUYA_MAX_CPUS: 'limits.cpus',
  SAKUYA_MAX_MEMORY: 'limits.memory',
};

/** Env vars from the old setup that no longer do anything; only mentioned so nobody keeps tuning them. */
const RETIRED_ENV = [
  'SAKUYA_HARD_LIMIT',
  'SAKUYA_JOB_CONCURRENCY',
  'SAKUYA_FFMPEG_THREADS',
  'SAKUYA_ONNX_THREADS',
  'SAKUYA_SHARP_CONCURRENCY',
];

/** Coerce an env string into the JSON value the file would hold, for the given setting path. */
function envValue(setting: string, raw: string): unknown {
  if (setting === 'server.port') return /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  if (setting === 'server.https' || setting === 'auth.enabled') return raw.trim() === 'true';
  if (setting === 'limits.cpus') return raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  return raw;
}

function setPath(target: Record<string, Record<string, unknown>>, setting: string, value: unknown): void {
  const [section, key] = setting.split('.');
  (target[section] ??= {})[key] = value;
}

// --- Legacy .env migration -------------------------------------------------------------------

/** KEY=value lines. Not `source`d or evaluated — data only. */
function readDotenv(file: string): Env {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const out: Env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Seed a first config file from whatever the old setup had, so upgrading keeps the port, the data
 * dir and — most importantly — a login that was switched on. Later sources win: root .env, then
 * apps/server/.env (the one Bun actually loaded), then the real environment.
 */
function legacySeed(dir: string, env: Env): { values: Record<string, Record<string, unknown>>; sources: string[] } {
  const values: Record<string, Record<string, unknown>> = {};
  const sources: string[] = [];
  const layers: [string, Env][] = [
    ['.env', readDotenv(path.join(dir, '.env'))],
    [path.join('apps', 'server', '.env'), readDotenv(path.join(dir, 'apps', 'server', '.env'))],
    ['environment', env],
  ];
  for (const [label, layer] of layers) {
    let used = false;
    for (const [name, setting] of Object.entries(LEGACY_ENV)) {
      const raw = layer[name];
      if (raw === undefined || raw === '') continue;
      setPath(values, setting, envValue(setting, raw));
      used = true;
    }
    if (used) sources.push(label);
  }
  return { values, sources };
}

function initialFile(seed: Record<string, Record<string, unknown>>): string {
  const content = {
    $schema: './packages/shared/sakuya.config.schema.json',
    server: { ...DEFAULT_CONFIG.server, ...seed.server },
    web: { ...DEFAULT_CONFIG.web },
    auth: { ...DEFAULT_CONFIG.auth, ...seed.auth },
    limits: { cpus: null, memory: null, ...seed.limits },
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}

// --- Loading ---------------------------------------------------------------------------------

export interface LoadedConfig {
  config: SakuyaConfig;
  file: string;
  /** Running inside the Docker image, where env overrides apply. */
  docker: boolean;
  /** Set when this call wrote a fresh file — the caller should say so once. */
  created: string | null;
  warnings: string[];
}

export interface LoadOptions {
  env?: Env;
  /** Write a default file (migrating any old .env) when none exists. The server side does; Vite only reads. */
  create?: boolean;
}

export function configFilePath(env: Env = process.env): string {
  // SAKUYA_CONFIG picks a different *file*; it overrides no values. The test suite points it at
  // throwaway files so tests never read or create the real one.
  return env.SAKUYA_CONFIG ? path.resolve(env.SAKUYA_CONFIG) : path.join(REPO_ROOT, CONFIG_FILE_NAME);
}

export function loadConfig({ env = process.env, create = false }: LoadOptions = {}): LoadedConfig {
  const file = configFilePath(env);
  const dir = path.dirname(file);
  const docker = env.SAKUYA_DOCKER === '1';
  let created: string | null = null;

  let text: string | null = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (text === null && create && !docker) {
    const { values, sources } = legacySeed(dir, env);
    const initial = initialFile(values);
    try {
      // wx: the server and Vite start in parallel; whoever loses the race just reads the winner's file.
      fs.writeFileSync(file, initial, { flag: 'wx' });
      text = initial;
      created = sources.length
        ? `Created ${file} from your old settings (${sources.join(', ')}). Those are no longer read — ` +
          'edit this file instead, and delete any .env files.'
        : `Created ${file} with the defaults. Edit it to configure Sakuya.`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      text = fs.readFileSync(file, 'utf8');
    }
  }

  let raw: unknown = {};
  if (text !== null) {
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new ConfigError(file, `is not valid JSON (${(err as Error).message})`);
    }
  }

  const parsed = parseConfig(raw, file, dir);
  const warnings = parsed.warnings;
  let config = parsed.config;

  if (docker) {
    const overrides: Record<string, Record<string, unknown>> = {};
    for (const [name, setting] of Object.entries(DOCKER_OVERRIDES)) {
      const value = env[name];
      if (value !== undefined && value !== '') setPath(overrides, setting, envValue(setting, value));
    }
    // Re-validated as a whole so an override gets the same checks as the file.
    const merged = {
      server: { ...config.server, ...overrides.server },
      web: config.web,
      auth: { ...config.auth, ...overrides.auth },
      limits: { ...config.limits, ...overrides.limits },
    };
    config = parseConfig(merged, `${file} + environment overrides`, dir).config;
  } else {
    const ignored = [...new Set([...Object.keys(LEGACY_ENV), ...Object.keys(DOCKER_OVERRIDES)])].filter(
      (name) => env[name] !== undefined && env[name] !== '',
    );
    if (ignored.length) {
      warnings.push(
        `ignoring ${ignored.join(', ')} from the environment — outside Docker, settings are only read from ${file}`,
      );
    }
  }
  const retired = RETIRED_ENV.filter((name) => env[name] !== undefined && env[name] !== '');
  if (retired.length) {
    warnings.push(`${retired.join(', ')} no longer exist; limits.cpus in ${file} derives all of them`);
  }

  // The one ignored variable that must not just be a warning: someone who turned login on the old
  // way would otherwise upgrade into a server that is silently open.
  const wantsAuth = env.AUTH_ENABLED === 'true' || (!docker && env.SAKUYA_AUTH_ENABLED === 'true');
  if (wantsAuth && !config.auth.enabled) {
    throw new ConfigError(
      file,
      'login is enabled in your environment or .env (AUTH_ENABLED=true) but "auth.enabled" is false here. ' +
        'Environment variables are no longer read' +
        (docker
          ? ' under their old names — use SAKUYA_AUTH_ENABLED / SAKUYA_AUTH_SECRET.'
          : '; set auth.enabled and auth.secret in this file.'),
    );
  }

  return { config, file, docker, created, warnings };
}
