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

/** Where the OPERATOR credential lives — deliberately not the broker registry.
 *  The registry entry is the agent-facing credential: every org process on the
 *  machine reads it to deliver messages, so anything in it must be assumed
 *  visible to agents. The operator credential authorizes human decisions
 *  (approvals, gates, answers) and is only read by the `org` CLI. */
export function defaultOperatorDir(): string {
  return process.env.MONOMIND_ORGRT_OPERATOR_DIR || join(homedir(), '.monomind', 'orgrt-operator');
}

function entryPath(name: string, dir: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid org name for broker registry: ${name}`);
  return join(dir, `${name}.json`);
}

/** Atomic owner-only write (tmp + same-directory rename) shared by both registries. */
function writeEntry(dest: string, data: unknown): void {
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, dest);
}

/** Publish the operator credential for org `name` so `org approve/deny/answer/gate-*`
 *  can authenticate to the hosting daemon's human-decision routes. */
export function writeOperatorCredential(
  name: string,
  credential: string,
  dir = defaultOperatorDir(),
): void {
  mkdirSync(dir, { recursive: true });
  writeEntry(entryPath(name, dir), { credential, pid: process.pid, updatedAt: Date.now() });
}

export function readOperatorCredential(
  name: string,
  dir = defaultOperatorDir(),
): string | undefined {
  try {
    const entry = JSON.parse(readFileSync(entryPath(name, dir), 'utf8')) as { credential?: string };
    return normalizeCredential(entry.credential);
  } catch {
    return undefined;
  }
}

export function removeOperatorCredential(name: string, dir = defaultOperatorDir()): void {
  try {
    unlinkSync(entryPath(name, dir));
  } catch {
    /* already gone */
  }
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
  // SEC: the entry carries this org's agent credential in plaintext —
  // restrict to owner-only so other local users can't read it off disk.
  writeEntry(entryPath(name, dir), entry);
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

/** Keeps a broker registration alive with periodic heartbeats until stop() is called.
 *  `credential` is the org's AGENT credential (published in the registry entry);
 *  `operator` is the daemon's operator credential, written to its own directory
 *  and never into the registry entry. */
export class BrokerLease {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private name: string,
    private url: string,
    private dir: string = defaultRegistryDir(),
    private intervalMs = 20_000,
    private credential?: string,
    private operator?: { credential: string; dir?: string },
  ) {}

  private publish(): void {
    registerOrg(this.name, this.url, this.dir, this.credential);
    if (this.operator)
      writeOperatorCredential(this.name, this.operator.credential, this.operator.dir);
  }

  start(): void {
    this.publish();
    this.timer = setInterval(() => this.publish(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    unregisterOrg(this.name, this.dir);
    if (this.operator) removeOperatorCredential(this.name, this.operator.dir);
  }
}
