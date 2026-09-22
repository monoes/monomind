// packages/@monomind/cli/src/utils/resource-governor.ts
// monolean: single-module resource gate — upgrade path = cgroup integration

import { execSync } from 'node:child_process';
import { cpus, freemem, platform, totalmem } from 'node:os';

export interface ResourceLimits {
  /** Minimum free memory (bytes) required before spawning. Default: 15% of total. */
  minFreeMemBytes: number;
  /** Maximum concurrent claude-agent-sdk processes across all orgs. Default: cpus - 2, min 2. */
  maxSdkProcesses: number;
  /** Delay between sequential agent spawns (ms). Default: 2000. */
  spawnStaggerMs: number;
}

const defaults = (): ResourceLimits => ({
  minFreeMemBytes:
    parseInt(process.env.MONOMIND_MIN_FREE_MEM_MB || '0', 10) * 1024 * 1024 ||
    Math.floor(totalmem() * 0.15),
  maxSdkProcesses:
    parseInt(process.env.MONOMIND_MAX_SDK_PROCS || '0', 10) || Math.max(2, cpus().length - 2),
  spawnStaggerMs: parseInt(process.env.MONOMIND_SPAWN_STAGGER_MS || '0', 10) || 2000,
});

let overrides: Partial<ResourceLimits> = {};

export function configureResourceLimits(o: Partial<ResourceLimits>): void {
  overrides = { ...overrides, ...o };
}

export function getResourceLimits(): ResourceLimits {
  return { ...defaults(), ...overrides };
}

/** Available memory in bytes — free + reclaimable (inactive/speculative/purgeable on macOS).
 *  os.freemem() on macOS returns only wired-free pages, which is near-zero on
 *  a warm system even though GB of file-cache are instantly reclaimable. */
export function getAvailableMemBytes(): number {
  if (platform() === 'darwin') {
    try {
      const out = execSync('vm_stat', { encoding: 'utf8', timeout: 3000 });
      const page = (out.match(/page size of (\d+)/) ?? [])[1];
      const free = (out.match(/Pages free:\s+(\d+)/) ?? [])[1];
      const inactive = (out.match(/Pages inactive:\s+(\d+)/) ?? [])[1];
      const speculative = (out.match(/Pages speculative:\s+(\d+)/) ?? [])[1];
      const purgeable = (out.match(/Pages purgeable:\s+(\d+)/) ?? [])[1];
      if (page && free) {
        const ps = parseInt(page, 10);
        return (
          ps *
          (parseInt(free, 10) +
            parseInt(inactive || '0', 10) +
            parseInt(speculative || '0', 10) +
            parseInt(purgeable || '0', 10))
        );
      }
    } catch {
      /* fall through */
    }
  }
  return freemem();
}

export function countSdkProcesses(): number {
  // pgrep doesn't exist on native Windows — every call would fail (and, since
  // execSync inherits stderr by default, print "'pgrep' is not recognized..."
  // to the console on every lazy role spawn that hits this check). The
  // concurrency cap it feeds just isn't enforceable there; treat as unknown.
  if (platform() === 'win32') return 0;
  try {
    // Match only actual SDK agent binaries (have --output-format in argv),
    // not processes that merely reference the SDK package path.
    const out = execSync('pgrep -f "claude-agent-sdk.*--output-format"', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  } // pgrep exits 1 when no matches
}

export interface ResourceCheck {
  ok: boolean;
  freeMemMB: number;
  freeMemPct: number;
  sdkProcesses: number;
  maxSdkProcesses: number;
  reason?: string;
}

export function checkResources(): ResourceCheck {
  const limits = getResourceLimits();
  const free = getAvailableMemBytes();
  const total = totalmem();
  const freeMemMB = Math.round(free / 1024 / 1024);
  const freeMemPct = Math.round((free / total) * 100);
  const sdkProcesses = countSdkProcesses();

  if (free < limits.minFreeMemBytes) {
    return {
      ok: false,
      freeMemMB,
      freeMemPct,
      sdkProcesses,
      maxSdkProcesses: limits.maxSdkProcesses,
      reason: `low memory: ${freeMemMB}MB free (${freeMemPct}%), need ${Math.round(limits.minFreeMemBytes / 1024 / 1024)}MB`,
    };
  }
  if (sdkProcesses >= limits.maxSdkProcesses) {
    return {
      ok: false,
      freeMemMB,
      freeMemPct,
      sdkProcesses,
      maxSdkProcesses: limits.maxSdkProcesses,
      reason: `too many SDK processes: ${sdkProcesses}/${limits.maxSdkProcesses}`,
    };
  }
  return { ok: true, freeMemMB, freeMemPct, sdkProcesses, maxSdkProcesses: limits.maxSdkProcesses };
}

/** Wait until resources are available, with a timeout. Returns false if timed out. */
export async function waitForCapacity(timeoutMs = 60_000): Promise<ResourceCheck> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const check = checkResources();
    if (check.ok) return check;
    await new Promise((r) => {
      const t = setTimeout(r, 3000);
      (t as { unref?: () => void }).unref?.();
    });
  }
  return checkResources();
}

// Matches an init/subreaper process's OWN command line — used to confirm a
// parent is actually acting as a reaper before trusting it as proof of
// orphan-hood (see isInitSubreaperCmd below).
const INIT_SUBREAPER_RE = /(^|\/)systemd( --user)?$|\/sbin\/init|\/lib\/systemd\/systemd/;

function isInitSubreaperCmd(cmd: string | undefined): boolean {
  return !!cmd && INIT_SUBREAPER_RE.test(cmd);
}

/** Kill orphaned claude-agent-sdk processes.
 *  @param protectedPids PIDs to never kill (e.g. sibling org agents).
 *  @param ownerPid Only kill SDK processes whose parent is this PID.
 *    When undefined, only kills genuinely orphaned processes (ppid === 1 or
 *    parent is an init/subreaper like systemd --user). */
export function reapOrphanedSdkProcesses(protectedPids: Set<number>, ownerPid?: number): number {
  // ps doesn't exist on native Windows — same rationale as countSdkProcesses above.
  if (platform() === 'win32') return 0;
  try {
    const out = execSync('ps -eo pid,ppid,command', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Build pid→command map for parent lookup when detecting orphans
    const procMap = new Map<number, string>();
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      if (!Number.isNaN(pid) && parts.length >= 3) {
        procMap.set(pid, parts.slice(2).join(' '));
      }
    }

    let reaped = 0;
    for (const line of out.split('\n')) {
      if (!line.includes('claude-agent-sdk') || !line.includes('--output-format')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (Number.isNaN(pid) || protectedPids.has(pid)) continue;

      // When ownerPid is specified, only kill children of that owner.
      if (ownerPid != null) {
        if (ppid !== ownerPid) continue;
      } else {
        // When ownerPid is undefined, only kill genuinely orphaned processes:
        // - ppid === 1 (adopted by init), OR
        // - parent is an init/subreaper (systemd, systemd --user, /sbin/init, etc.)
        //
        // ppid === 1 alone is NOT sufficient proof of orphan-hood. Inside a
        // PID-namespace sandbox (e.g. `bwrap --unshare-pid`) or a container
        // with no init process, the invoking shell itself can BE pid 1 in
        // that namespace — so its own live, still-running children also
        // report ppid === 1, even though their real parent never died and
        // is not an init/subreaper at all. If pid 1 is visible in this `ps`
        // snapshot and its own command doesn't look like an init/subreaper,
        // don't trust the numeric ppid; leave the process alone. If pid 1
        // isn't in the snapshot (the common case on a real host, where the
        // true init is outside what a restricted `ps` can show), fall back
        // to treating ppid === 1 as adoption by init, as before.
        if (ppid !== 1) {
          const parentCmd = procMap.get(ppid);
          if (!isInitSubreaperCmd(parentCmd)) continue;
        } else {
          const pid1Cmd = procMap.get(1);
          if (pid1Cmd && !isInitSubreaperCmd(pid1Cmd)) continue;
        }
      }

      try {
        process.kill(pid, 'SIGTERM');
        reaped++;
      } catch {
        /* already dead */
      }
    }
    return reaped;
  } catch {
    return 0;
  }
}
