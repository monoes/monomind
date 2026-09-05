// packages/@monomind/cli/src/orgrt/broker.ts
// monolean: file-based local broker for cross-process org discovery (different
// `monomind org` processes / project directories, same machine). Upgrade path:
// a real network registry when cross-machine discovery is needed.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BrokerEntry {
  url: string;
  pid: number;
  updatedAt: number;
  credential?: string;
}

// DNS label limits: 1-63 chars, must start alphanumerically (RFC 1034 + RFC 1123)
// Requires at least 2 chars total (backward compatibility with original regex)
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const DEFAULT_STALE_MS = 90_000;

/** Normalize credential: trim whitespace, reject empty/oversized values. */
export function normalizeCredential(cred: string | undefined): string | undefined {
  if (cred === undefined || cred === null) return undefined;
  if (typeof cred !== 'string') return undefined;
  const trimmed = cred.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return undefined;
  return trimmed;
}

export function defaultRegistryDir(): string {
  return process.env.MONOMIND_ORGRT_BROKER_DIR || join(homedir(), '.monomind', 'orgrt-broker');
}

function entryPath(name: string, dir: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid org name for broker registry: ${name}`);
  return join(dir, `${name}.json`);
}

/** Publish that this process hosts org `name`, reachable via `url`. Call again periodically (heartbeat) — see BrokerLease.
 *  Writes via tmp+rename (same-directory rename is atomic on POSIX/NTFS) so a concurrent lookupOrg() never observes a
 *  partially-written entry — this file is rewritten every heartbeat (default 20s) while other processes may read it. */
export function registerOrg(
  name: string,
  url: string,
  dir = defaultRegistryDir(),
  credential?: string,
): void {
  mkdirSync(dir, { recursive: true });
  const normalizedCred = normalizeCredential(credential);
  const entry: BrokerEntry = {
    url,
    pid: process.pid,
    updatedAt: Date.now(),
    ...(normalizedCred ? { credential: normalizedCred } : {}),
  };
  const dest = entryPath(name, dir);
  const tmp = `${dest}.${process.pid}.tmp`;
  // SEC: the entry may carry the daemon's auth credential in plaintext —
  // restrict to owner-only so other local users can't read it off disk.
  writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  renameSync(tmp, dest);
}

/** Remove this process's registration for `name` (best effort). */
export function unregisterOrg(name: string, dir = defaultRegistryDir()): void {
  try {
    unlinkSync(entryPath(name, dir));
  } catch {
    /* already gone */
  }
}

/** Find which process (if any) currently hosts org `name`. Null if never registered or the registration is stale (owner crashed without cleanup). */
export function lookupOrg(
  name: string,
  dir = defaultRegistryDir(),
  staleMs = DEFAULT_STALE_MS,
): BrokerEntry | null {
  try {
    const entry = JSON.parse(readFileSync(entryPath(name, dir), 'utf8')) as BrokerEntry;
    if (Date.now() - entry.updatedAt >= staleMs) return null;
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
    private credential?: string,
  ) {}

  start(): void {
    registerOrg(this.name, this.url, this.dir, this.credential);
    this.timer = setInterval(
      () => registerOrg(this.name, this.url, this.dir, this.credential),
      this.intervalMs,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    unregisterOrg(this.name, this.dir);
  }
}
