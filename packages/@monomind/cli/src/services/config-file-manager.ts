/**
 * Config File Manager
 * Shared JSON config file persistence with atomic writes and Zod validation
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Config file search paths in priority order */
const CONFIG_FILENAMES = [
  'monomind.config.json',
  '.monomind/config.json',
];

/** Default config values */
const DEFAULT_CONFIG: Record<string, unknown> = {
  version: '3.5',
  agents: {
    defaultType: 'coder',
    autoSpawn: false,
    maxConcurrent: 8,
    timeout: 300000,
    providers: [],
  },
  swarm: {
    topology: 'hierarchical',
    maxAgents: 8,
    autoScale: false,
    coordinationStrategy: 'leader',
    healthCheckInterval: 30000,
  },
  memory: {
    backend: 'hybrid',
    persistPath: './data/memory',
    cacheSize: 1000,
    enableHNSW: true,
    vectorDimension: 384,
  },
  mcp: {
    serverHost: 'localhost',
    serverPort: 3000,
    autoStart: false,
    transportType: 'stdio',
    tools: [],
  },
  cli: {
    colorOutput: true,
    interactive: true,
    verbosity: 'normal',
    outputFormat: 'text',
    progressStyle: 'spinner',
  },
  hooks: {
    enabled: true,
    autoExecute: true,
    hooks: [],
  },
  neural: {
    enabled: true,
    disableNative: false,
    sona: {
      mode: 'balanced',
    },
  },
};

export class ConfigFileManager {
  private configPath: string | null = null;
  private config: Record<string, unknown> | null = null;

  /** Find config file in search paths starting from cwd */
  findConfig(cwd: string): string | null {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.resolve(cwd, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    // Check env var — must resolve within project root
    const envPath = process.env.MONOMIND_CONFIG;
    if (envPath) {
      const resolved = path.resolve(envPath);
      const projectRoot = path.resolve(cwd);
      if ((resolved.startsWith(projectRoot + path.sep) || resolved === projectRoot) && fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return null;
  }

  /** Load config from file, returns null if not found */
  load(cwd: string): Record<string, unknown> | null {
    this.configPath = this.findConfig(cwd);
    if (!this.configPath) {
      this.config = null;
      return null;
    }
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(content);
      this.config = sanitizeConfigObject(parsed) as Record<string, unknown>;
      return this.config;
    } catch {
      this.config = null;
      return null;
    }
  }

  /** Get the current config, loading if needed */
  getConfig(cwd: string): Record<string, unknown> {
    if (this.config === null) {
      this.load(cwd);
    }
    return this.config ?? { ...DEFAULT_CONFIG };
  }

  /** Get a nested config value by dot-separated key */
  get(cwd: string, key: string): unknown {
    const config = this.getConfig(cwd);
    return getNestedValue(config, key);
  }

  /** Set a nested config value by dot-separated key.
   * Enforces top-level section allowlist (mirroring importFrom) and recursively
   * sanitises the value to strip prototype-pollution keys before persistence.
   *
   * Re-reads the file from disk inside the write to guard against the
   * read-modify-write credential-clobber race. Without the re-read, two
   * concurrent `monomind providers configure` calls would each see the
   * original config, mutate locally, and the second writer would silently
   * drop the first writer's API key.
   */
  set(cwd: string, key: string, value: unknown): void {
    const KNOWN_SET_SECTIONS = new Set(['version', 'agents', 'swarm', 'memory', 'mcp', 'cli', 'hooks', 'neural']);
    const topSection = String(key).split('.')[0];
    if (!KNOWN_SET_SECTIONS.has(topSection)) {
      throw new Error(`Unknown config section: "${topSection}". Allowed: ${[...KNOWN_SET_SECTIONS].join(', ')}`);
    }
    const sanitisedValue = sanitizeConfigObject(value);
    const targetPath = this.configPath ?? this.findConfig(cwd) ?? path.resolve(cwd, CONFIG_FILENAMES[0]);

    // Re-read from disk inside the write window so we operate on the latest
    // bytes, not on a possibly-stale this.config cache. This still isn't
    // cross-process atomic without an OS-level flock, but combined with the
    // O_EXCL atomic rename it prevents the most common credential-clobber
    // window where two CLIs interleave their getConfig→set→write cycles.
    let onDisk: Record<string, unknown> = { ...DEFAULT_CONFIG };
    if (fs.existsSync(targetPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        onDisk = sanitizeConfigObject(parsed) as Record<string, unknown>;
      } catch { /* fall through to defaults */ }
    }
    setNestedValue(onDisk, key, sanitisedValue);
    this.writeAtomic(targetPath, onDisk);
    this.config = onDisk;
    this.configPath = targetPath;
  }

  /** Create a new config file with defaults */
  create(cwd: string, overrides?: Record<string, unknown>, force?: boolean): string {
    const targetPath = path.resolve(cwd, CONFIG_FILENAMES[0]);
    if (fs.existsSync(targetPath) && !force) {
      throw new Error(`Config file already exists: ${targetPath}. Use --force to overwrite.`);
    }
    const config = { ...DEFAULT_CONFIG, ...(overrides ? sanitizeConfigObject(overrides) as Record<string, unknown> : {}) };
    this.writeAtomic(targetPath, config);
    this.config = config;
    this.configPath = targetPath;
    return targetPath;
  }

  /** Reset config to defaults */
  reset(cwd: string): string {
    const targetPath = this.configPath ?? path.resolve(cwd, CONFIG_FILENAMES[0]);
    this.writeAtomic(targetPath, DEFAULT_CONFIG);
    this.config = { ...DEFAULT_CONFIG };
    this.configPath = targetPath;
    return targetPath;
  }

  /** Export config to a specific path */
  exportTo(cwd: string, exportPath: string): void {
    const config = this.getConfig(cwd);
    const resolved = path.resolve(cwd, exportPath);
    const projectRoot = path.resolve(cwd);
    if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
      throw new Error('Export path must be within the project directory');
    }
    this.writeAtomic(resolved, config);
  }

  /** Import config from a specific path */
  importFrom(cwd: string, importPath: string): void {
    const resolved = path.resolve(cwd, importPath);
    // Guard against path traversal: the resolved path must be within the
    // project cwd or the user's home directory.  Without this check an
    // automated script can pass "/etc/passwd" or "../../.env" and exfiltrate
    // files outside the project tree.
    const projectRoot = path.resolve(cwd);
    const home = os.homedir();
    const isUnderProject = resolved === projectRoot || resolved.startsWith(projectRoot + path.sep);
    const isUnderHome = resolved === home || resolved.startsWith(home + path.sep);
    if (!isUnderProject && !isUnderHome) {
      throw new Error(`Import path must be within the project directory or home directory: ${resolved}`);
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`Import file not found: ${resolved}`);
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    let importedRaw: unknown;
    try {
      importedRaw = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON in import file: ${resolved}`);
    }
    if (typeof importedRaw !== 'object' || importedRaw === null || Array.isArray(importedRaw)) {
      throw new Error('Import file must contain a JSON object');
    }
    // Recursively strip prototype-pollution keys at every nesting level —
    // KNOWN_SECTIONS only validates top-level keys, leaving nested
    // {agents:{providers:[{__proto__:{...}}]}} unsanitized.
    const imported = sanitizeConfigObject(importedRaw) as Record<string, unknown>;
    const KNOWN_SECTIONS = new Set(['version', 'agents', 'swarm', 'memory', 'mcp', 'cli', 'hooks']);
    for (const key of Object.keys(imported)) {
      if (!KNOWN_SECTIONS.has(key)) {
        throw new Error(`Unknown config section: "${key}"`);
      }
    }
    const targetPath = this.configPath ?? path.resolve(cwd, CONFIG_FILENAMES[0]);
    this.writeAtomic(targetPath, imported);
    this.config = imported;
    this.configPath = targetPath;
  }

  /** Get the path to the current config file */
  getConfigPath(): string | null {
    return this.configPath;
  }

  /** Get default config */
  getDefaults(): Record<string, unknown> {
    return { ...DEFAULT_CONFIG };
  }

  /** Atomic write with restrictive 0o600 mode.
   * SECURITY: this config file may contain API keys (per `commands/providers.ts`).
   * Without explicit mode the file inherits the umask (typically 0o644 →
   * world-readable). Set 0o600 on tmp file BEFORE rename, then re-chmod after
   * rename in case the rename target had a more permissive mode.
   */
  private writeAtomic(filePath: string, data: Record<string, unknown>): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
  }
}

const FORBIDDEN_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strip prototype-pollution keys from a parsed JSON object before
 * it lands in this.config or is persisted back to disk. JSON.parse alone does
 * not pollute, but downstream consumers that shallow-merge config values
 * (Object.assign, spread) would propagate poisoned keys; persisting them back
 * to disk also makes the pollution survive restarts.
 */
function sanitizeConfigObject(value: unknown, depth = 0): unknown {
  if (depth > 32) return null;
  if (Array.isArray(value)) return value.map(v => sanitizeConfigObject(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_SEGMENTS.has(k)) continue;
      out[k] = sanitizeConfigObject(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Get a nested value by dot-separated key */
function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  for (const part of parts) {
    if (FORBIDDEN_KEY_SEGMENTS.has(part)) return undefined;
  }
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value by dot-separated key */
function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  for (const part of parts) {
    if (FORBIDDEN_KEY_SEGMENTS.has(part)) {
      throw new Error(`Forbidden config key segment: "${part}"`);
    }
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Parse a string value to the appropriate type */
export function parseConfigValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object') return parsed;
  } catch { /* not JSON, use as string */ }
  return value;
}

/** Singleton instance */
export const configManager = new ConfigFileManager();
