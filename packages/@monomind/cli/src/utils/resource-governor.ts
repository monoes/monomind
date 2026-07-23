// packages/@monomind/cli/src/utils/resource-governor.ts
// monolean: single-module resource gate — upgrade path = cgroup integration
import { freemem, totalmem, cpus, platform } from 'node:os';
import { execSync } from 'node:child_process';

export interface ResourceLimits {
  /** Minimum free memory (bytes) required before spawning. Default: 15% of total. */
  minFreeMemBytes: number;
  /** Maximum concurrent claude-agent-sdk processes across all orgs. Default: cpus - 2, min 2. */
  maxSdkProcesses: number;
  /** Delay between sequential agent spawns (ms). Default: 2000. */
  spawnStaggerMs: number;
}

const defaults = (): ResourceLimits => ({
  minFreeMemBytes: parseInt(process.env.MONOMIND_MIN_FREE_MEM_MB || '0', 10) * 1024 * 1024
    || Math.floor(totalmem() * 0.15),
  maxSdkProcesses: parseInt(process.env.MONOMIND_MAX_SDK_PROCS || '0', 10)
    || Math.max(2, cpus().length - 2),
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
        return ps * (parseInt(free, 10) + parseInt(inactive || '0', 10) + parseInt(speculative || '0', 10) + parseInt(purgeable || '0', 10));
      }
    } catch { /* fall through */ }
  }
  return freemem();
}

export function countSdkProcesses(): number {
  try {
    // Match only actual SDK agent binaries (have --output-format in argv),
    // not processes that merely reference the SDK package path.
    const out = execSync('pgrep -f "claude-agent-sdk.*--output-format"', { encoding: 'utf8', timeout: 5000 });
    return out.trim().split('\n').filter(Boolean).length;
  } catch { return 0; } // pgrep exits 1 when no matches
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
      ok: false, freeMemMB, freeMemPct, sdkProcesses,
      maxSdkProcesses: limits.maxSdkProcesses,
      reason: `low memory: ${freeMemMB}MB free (${freeMemPct}%), need ${Math.round(limits.minFreeMemBytes / 1024 / 1024)}MB`,
    };
  }
  if (sdkProcesses >= limits.maxSdkProcesses) {
    return {
      ok: false, freeMemMB, freeMemPct, sdkProcesses,
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
    await new Promise(r => { const t = setTimeout(r, 3000); (t as { unref?: () => void }).unref?.(); });
  }
  return checkResources();
}

/** Kill orphaned claude-agent-sdk processes.
 *  @param protectedPids PIDs to never kill (e.g. sibling org agents).
 *  @param ownerPid Only kill SDK processes whose parent is this PID.
 *    Prevents killing agents from OTHER monomind org processes. */
export function reapOrphanedSdkProcesses(protectedPids: Set<number>, ownerPid?: number): number {
  try {
    const out = execSync('ps -eo pid,ppid,command', { encoding: 'utf8', timeout: 5000 });
    let reaped = 0;
    for (const line of out.split('\n')) {
      if (!line.includes('claude-agent-sdk') || !line.includes('--output-format')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid) || protectedPids.has(pid)) continue;
      if (ownerPid != null && ppid !== ownerPid) continue;
      try {
        process.kill(pid, 'SIGTERM');
        reaped++;
      } catch { /* already dead */ }
    }
    return reaped;
  } catch { return 0; }
}
