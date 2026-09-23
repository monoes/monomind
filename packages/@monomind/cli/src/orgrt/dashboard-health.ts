// packages/@monomind/cli/src/orgrt/dashboard-health.ts
// Is the dashboard control.json points at one this CLI should keep using?
// A live pid alone is not enough: on the 2.16.0 release run control.json named
// a pid whose server.mjs lived in a since-deleted worktree, so every org's
// events went to a server built from code that no longer existed. The
// forwarder (forwarder.ts) accepts a dashboard only if its pid is alive, the
// script it runs still exists and, when recorded, its version matches this
// CLI; a stale one it can prove is this project's own dashboard is stopped
// and replaced rather than left running beside the new one.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What control.json records about the dashboard server. */
export interface ControlRecord {
  pid?: number;
  port?: number;
  url?: string;
  /** Absolute path of the server script the dashboard runs. */
  server?: string;
  /** CLI version that started it. */
  version?: string;
  startedAt?: string;
}

export interface ProcInfo {
  argv: string[];
  cwd?: string;
}

export interface DashboardProbe {
  isPidAlive(pid: number): boolean;
  procInfo(pid: number): ProcInfo | null;
  exists(path: string): boolean;
  /** This CLI's version. */
  version: string;
}

export type DashboardVerdict =
  | { live: true; script?: string }
  | {
      live: false;
      reason: string;
      /** Set only for a dashboard proven to be this project's own. */
      stopPid?: number;
    };

/** The monomind dashboard script a process runs (`node …/ui/server.mjs` or
 *  `node …/monomind ui`), or null when it runs something else. */
export function dashboardScript(argv: string[]): string | null {
  const script = argv[1];
  if (!script || !isAbsolute(script)) return null;
  if (/(^|\/)ui\/server\.mjs$/.test(script)) return script;
  if (argv.includes('ui') && /(^|\/)(monomind|cli\.js)$/.test(script)) return script;
  return null;
}

export function assessDashboard(
  c: ControlRecord,
  projectDir: string,
  p: DashboardProbe,
): DashboardVerdict {
  const pid = c.pid;
  // 0/absent = unknown (control-start records pid 0 for a paired foreign
  // server it could not identify) — nothing to check, assume alive as before.
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return { live: true };
  if (!p.isPidAlive(pid)) return { live: false, reason: `pid ${pid} is gone` };
  const info = p.procInfo(pid);
  const running = info ? dashboardScript(info.argv) : null;
  if (info && !running && c.server)
    return { live: false, reason: `pid ${pid} no longer runs ${c.server}` };
  const ours = !!running && !!info?.cwd && resolve(info.cwd) === resolve(projectDir);
  const stop = ours ? { stopPid: pid } : {};
  const entry = c.server ?? running;
  if (entry && !p.exists(entry))
    return { live: false, reason: `its server entry ${entry} no longer exists`, ...stop };
  if (c.version && c.version !== p.version)
    return { live: false, reason: `it runs ${c.version}, this CLI is ${p.version}`, ...stop };
  return { live: true, ...(running ? { script: running } : {}) };
}

/** Find a dashboard already serving `projectDir` on 4242-4251 (the range
 *  server.mjs's bindServer walks), so a heal reuses it instead of starting
 *  another. A stale one of ours found on the way is stopped. */
export async function findProjectDashboard(
  projectDir: string,
  p: DashboardProbe,
  identity: (port: number) => Promise<{ pid?: number; dir?: string } | null>,
  stop: (pid: number) => void | Promise<void>,
): Promise<{ pid: number; port: number; server?: string } | null> {
  for (let port = 4242; port <= 4251; port++) {
    const id = await identity(port);
    if (!id || typeof id.pid !== 'number' || typeof id.dir !== 'string') continue;
    if (resolve(id.dir) !== resolve(projectDir)) continue;
    const v = assessDashboard({ pid: id.pid }, projectDir, p);
    if (v.live) return { pid: id.pid, port, ...(v.script ? { server: v.script } : {}) };
    if (v.stopPid) await stop(v.stopPid);
  }
  return null;
}

// ── Real-process implementations ───────────────────────────────────────────

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, no permission
  }
};

/** argv + cwd of a process: exact from /proc on Linux; elsewhere argv from
 *  `ps` (split on whitespace, best-effort) and no cwd — so a dashboard is
 *  never proven ours, and never stopped, where cwd cannot be read. */
const procInfo = (pid: number): ProcInfo | null => {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    let cwd: string | undefined;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      /* not ours to read */
    }
    return { argv, cwd };
  } catch {
    /* no procfs */
  }
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    return out ? { argv: out.split(/\s+/) } : null;
  } catch {
    return null;
  }
};

let cachedVersion: string | undefined;
/** Version of the package this module ships in. */
export function cliVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof pkg.version === 'string') return (cachedVersion = pkg.version as string);
    } catch {
      /* keep walking */
    }
  }
  return (cachedVersion = '');
}

export const realDashboardProbe = (): DashboardProbe => ({
  isPidAlive,
  procInfo,
  exists: existsSync,
  version: cliVersion(),
});

export async function fetchIdentity(port: number): Promise<{ pid?: number; dir?: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/identity`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!r.ok) {
      r.body?.cancel();
      return null;
    }
    return (await r.json()) as { pid?: number; dir?: string };
  } catch {
    return null;
  }
}
