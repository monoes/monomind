/**
 * Opt-in, local-only usage counters (stage 0 of
 * docs/mastermind/plans/2026-11-surface-reduction.md).
 *
 * Off by default. On only when `MONOMIND_USAGE_COUNTERS=1` is set or the
 * project config has `cli.usageCounters: true`; an off value in the env
 * (`0`/`off`/`false`/`no`) wins over the config.
 *
 * What is stored, in `$MONOMIND_HOME/usage-counters.json` (default
 * `~/.monomind/usage-counters.json`): for each CLI command path
 * (`cli:memory store`) or MCP tool name (`mcp:memory_store`), a count and the
 * first and last day it was seen. Never arguments, flags, paths, prompts or
 * output. The callers pass names resolved from the command tree and the tool
 * registry, and this module rejects anything that does not look like one.
 *
 * Nothing here talks to the network. There is no upload code.
 *
 * Writes are fire-and-forget: a failure is swallowed, the file is capped at
 * MAX_USAGE_ENTRIES names, and an oversized or corrupt file is replaced.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigFileManager } from './config-file-manager.js';

export const USAGE_COUNTERS_ENV = 'MONOMIND_USAGE_COUNTERS';
export const USAGE_COUNTERS_CONFIG_KEY = 'cli.usageCounters';
export const MAX_USAGE_ENTRIES = 1000;
const MAX_FILE_BYTES = 256 * 1024;

export type UsageKind = 'cli' | 'mcp';

export interface UsageEntry {
  count: number;
  /** YYYY-MM-DD (UTC). */
  firstSeen: string;
  /** YYYY-MM-DD (UTC). */
  lastSeen: string;
}

export interface UsageCounters {
  version: 1;
  entries: Record<string, UsageEntry>;
}

export interface UsageOptions {
  env?: NodeJS.ProcessEnv;
  /** Already-loaded project config; `null` means "none". Omitted: read from `cwd`. */
  config?: unknown;
  cwd?: string;
  /** Skip the enabled check (tests, or a caller that already checked). */
  enabled?: boolean;
  now?: Date;
}

const ON = new Set(['1', 'on', 'true', 'yes']);
const OFF = new Set(['0', 'off', 'false', 'no']);
/** One to six name tokens: command path segments or a tool name. */
const NAME = /^[a-z0-9][a-z0-9_.-]{0,63}( [a-z0-9][a-z0-9_.-]{0,63}){0,5}$/i;

export function usageCountersPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.MONOMIND_HOME || join(homedir(), '.monomind');
  return join(base, 'usage-counters.json');
}

function configOptIn(config: unknown): boolean {
  const cli = (config as { cli?: { usageCounters?: unknown } } | null | undefined)?.cli;
  return cli?.usageCounters === true;
}

export function usageCountersEnabled(opts: UsageOptions = {}): boolean {
  try {
    const value = (opts.env ?? process.env)[USAGE_COUNTERS_ENV]?.trim().toLowerCase();
    if (value && OFF.has(value)) return false;
    if (value && ON.has(value)) return true;
    const config =
      opts.config !== undefined
        ? opts.config
        : new ConfigFileManager().load(opts.cwd ?? process.cwd());
    return configOptIn(config);
  } catch {
    return false;
  }
}

// Long-lived processes (the MCP server) check once, not on every tool call.
let cachedEnabled: boolean | undefined;
let queue: Promise<void> = Promise.resolve();

export function resetUsageCountersCache(): void {
  cachedEnabled = undefined;
}

/** Resolves once every write queued so far has finished (or failed). */
export function usageCountersIdle(): Promise<void> {
  return queue;
}

function isEntry(v: unknown): v is UsageEntry {
  const e = v as UsageEntry;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.count === 'number' &&
    typeof e.firstSeen === 'string' &&
    typeof e.lastSeen === 'string'
  );
}

function parse(raw: string): UsageCounters {
  const empty: UsageCounters = { version: 1, entries: {} };
  try {
    const data = JSON.parse(raw) as Partial<UsageCounters>;
    if (typeof data?.entries !== 'object' || data.entries === null) return empty;
    const entries: Record<string, UsageEntry> = {};
    for (const [k, v] of Object.entries(data.entries)) if (isEntry(v)) entries[k] = v;
    return { version: 1, entries };
  } catch {
    return empty;
  }
}

/** Reads the counters file; an absent, oversized or corrupt file reads as empty. */
export function readUsageCounters(env: NodeJS.ProcessEnv = process.env): UsageCounters {
  try {
    const file = usageCountersPath(env);
    if (!existsSync(file)) return { version: 1, entries: {} };
    const raw = readFileSync(file, 'utf-8');
    return raw.length > MAX_FILE_BYTES ? { version: 1, entries: {} } : parse(raw);
  } catch {
    return { version: 1, entries: {} };
  }
}

async function increment(file: string, key: string, day: string): Promise<void> {
  let raw = '';
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    /* no file yet */
  }
  const data = raw.length > MAX_FILE_BYTES ? parse('') : parse(raw);
  const entry = data.entries[key];
  if (entry) {
    entry.count += 1;
    if (day > entry.lastSeen) entry.lastSeen = day;
    if (day < entry.firstSeen) entry.firstSeen = day;
  } else {
    if (Object.keys(data.entries).length >= MAX_USAGE_ENTRIES) return;
    data.entries[key] = { count: 1, firstSeen: day, lastSeen: day };
  }
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
  await rename(tmp, file);
}

/**
 * Count one use of a CLI command path or MCP tool name. Fire-and-forget:
 * never throws, never rejects; callers do not await it. The returned promise
 * exists only so tests can wait for the write.
 */
export function recordUsage(kind: UsageKind, name: string, opts: UsageOptions = {}): Promise<void> {
  try {
    let enabled = opts.enabled;
    if (enabled === undefined) {
      const injected =
        opts.env !== undefined || opts.config !== undefined || opts.cwd !== undefined;
      if (injected) enabled = usageCountersEnabled(opts);
      else enabled = cachedEnabled ??= usageCountersEnabled();
    }
    if (!enabled || typeof name !== 'string' || !NAME.test(name)) return Promise.resolve();
    const file = usageCountersPath(opts.env);
    const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
    queue = queue.then(() => increment(file, `${kind}:${name}`, day)).catch(() => {});
    return queue;
  } catch {
    return Promise.resolve();
  }
}
