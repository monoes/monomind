// packages/@monomind/cli/src/orgrt/broker.ts
// monolean: file-based local broker for cross-process org discovery (different
// `monomind org` processes / project directories, same machine). Upgrade path:
// a real network registry when cross-machine discovery is needed.
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface BrokerEntry { url: string; pid: number; updatedAt: number; }

const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const DEFAULT_STALE_MS = 90_000;

export function defaultRegistryDir(): string {
  return process.env.MONOMIND_ORGRT_BROKER_DIR || join(homedir(), '.monomind', 'orgrt-broker');
}

function entryPath(name: string, dir: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid org name for broker registry: ${name}`);
  return join(dir, `${name}.json`);
}

/** Publish that this process hosts org `name`, reachable via `url`. Call again periodically (heartbeat) — see BrokerLease. */
export function registerOrg(name: string, url: string, dir = defaultRegistryDir()): void {
  mkdirSync(dir, { recursive: true });
  const entry: BrokerEntry = { url, pid: process.pid, updatedAt: Date.now() };
  writeFileSync(entryPath(name, dir), JSON.stringify(entry));
}

/** Remove this process's registration for `name` (best effort). */
export function unregisterOrg(name: string, dir = defaultRegistryDir()): void {
  try { unlinkSync(entryPath(name, dir)); } catch { /* already gone */ }
}

/** Find which process (if any) currently hosts org `name`. Null if never registered or the registration is stale (owner crashed without cleanup). */
export function lookupOrg(name: string, dir = defaultRegistryDir(), staleMs = DEFAULT_STALE_MS): BrokerEntry | null {
  try {
    const entry = JSON.parse(readFileSync(entryPath(name, dir), 'utf8')) as BrokerEntry;
    if (Date.now() - entry.updatedAt > staleMs) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Keeps a broker registration alive with periodic heartbeats until stop() is called. */
export class BrokerLease {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private name: string,
    private url: string,
    private dir: string = defaultRegistryDir(),
    private intervalMs = 20_000,
  ) {}

  start(): void {
    registerOrg(this.name, this.url, this.dir);
    this.timer = setInterval(() => registerOrg(this.name, this.url, this.dir), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    unregisterOrg(this.name, this.dir);
  }
}
