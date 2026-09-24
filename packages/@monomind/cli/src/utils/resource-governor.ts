// packages/@monomind/cli/src/utils/resource-governor.ts
// monolean: single-module resource gate — upgrade path = cgroup integration

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

/** One row of the process table: identity plus the ownership fields reaping needs. */
export interface ProcEntry {
  pid: number;
  ppid: number;
  /** Process group id. */
  pgrp?: number;
  /** Session id. Only known from /proc (Linux). */
  sid?: number;
  /** Start time in clock ticks since boot (/proc stat field 22) — guards PID reuse. */
  start?: number;
  cmd: string;
}

const SDK_CMD_RE = /claude-agent-sdk[\s\S]*--output-format|--output-format[\s\S]*claude-agent-sdk/;
// A still-running claude/monomind session anywhere up a process's parent
// chain owns it: Claude Code itself, an SDK process, or a monomind daemon.
// This is decided by the EXECUTABLE NAME (the basename of the program the
// command line runs, see programOf below) — never a substring match against the
// whole command text. A wrapped shell script can legitimately mention
// ".claude"-prefixed paths (Claude Code's own shell-snapshot sourcing) or a
// "claude-http-*.sock" name for reasons unrelated to being a live session;
// a loose `/\bclaude\b|monomind/i` test against the full multi-line script
// body matches those incidental mentions and wrongly shields every orphan
// under that ancestor.
const LIVE_SESSION_EXEC_RE = /^(claude|monomind)$/i;
// bwrap (the sandbox every org role's actual runtime is confined by) keeps
// the bind-mount arguments it was invoked with in ITS OWN cmdline, e.g.
// `bwrap --ro-bind /home/user/.claude /home/user/.claude -- <command>`.
// Those are sandbox plumbing, not evidence of a live session, and every
// orphan's parent chain inside the sandbox terminates at this same wrapper.
// bwrap always separates its own options from the wrapped command with a
// literal ` -- `, so only the wrapped-command portion (if any) is real
// evidence; the bind-mount flags before it are not.
const BWRAP_RE = /(^|\/)bwrap\b/;
const liveSessionCmd = (cmd: string): string => {
  if (!BWRAP_RE.test(cmd)) return cmd;
  const sep = cmd.indexOf(' -- ');
  return sep < 0 ? '' : cmd.slice(sep + 4);
};
// Only the PROGRAM a command line runs can make it a live session: its
// first token, or for a node/bun interpreter the first non-flag token after
// it (the script). Every later token is an argument, and a wrapped shell's
// `-c` script is free text that can say anything — an audit-logged copy of a
// past command, `echo claude-agent-sdk --output-format`, or the very
// `monomind cleanup --force` that is doing the reaping (issue #333: the
// bwrap pid 1 keeps that whole script in its own cmdline). A shell is never
// itself a live session; a claude/monomind/SDK process it starts is its own
// process, and so its own entry in any descendant's parent chain.
const SDK_PATH_TOKEN_RE = /(^|[\\/])claude-agent-sdk([\\/]|$)/;
const OUTPUT_FORMAT_TOKEN_RE = /^--output-format(=|$)/;
const INTERPRETER_RE = /^(node|nodejs|bun)$/;
const baseName = (tok: string): string => tok.split('/').pop() ?? tok;
const programOf = (tokens: string[]): string => {
  const [first = '', ...rest] = tokens;
  if (!INTERPRETER_RE.test(baseName(first))) return first;
  return rest.find((tok) => !tok.startsWith('-')) ?? first;
};
// True when `cmd` (after unwrapping bwrap's own args above) is ITSELF a
// claude-agent-sdk, Claude Code or monomind process — judged by the program
// it runs, not by whether some argument or path elsewhere on the line
// happens to contain those words.
const isLiveSessionCmd = (cmd: string): boolean => {
  const tokens = liveSessionCmd(cmd).split(/\s+/).filter(Boolean);
  const program = programOf(tokens);
  if (LIVE_SESSION_EXEC_RE.test(baseName(program))) return true;
  return SDK_PATH_TOKEN_RE.test(program) && tokens.some((tok) => OUTPUT_FORMAT_TOKEN_RE.test(tok));
};
// Fallback-only (no session ids, e.g. macOS `ps`): a parent other than pid 1
// counts as a subreaper only if it is an init/systemd by name.
const INIT_SUBREAPER_RE = /(^|\/)systemd( --user)?$|\/sbin\/init|\/lib\/systemd\/systemd/;
const MAX_CHAIN = 64;

/**
 * Parse /proc/<pid>/stat. `comm` (field 2) may contain spaces and parens, so
 * fields are counted from the LAST ')'.
 */
export function parseProcStat(
  stat: string,
): Pick<ProcEntry, 'pid' | 'ppid' | 'pgrp' | 'sid' | 'start'> | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const pid = parseInt(stat, 10);
  // After ')': state(3) ppid(4) pgrp(5) session(6) ... starttime(22)
  const f = stat.slice(close + 2).split(' ');
  const [ppid, pgrp, sid, start] = [f[1], f[2], f[3], f[19]].map((v) => parseInt(v ?? '', 10));
  if ([pid, ppid, pgrp, sid].some((n) => Number.isNaN(n))) return null;
  return { pid, ppid, pgrp, sid, start: Number.isNaN(start) ? undefined : start };
}

function readProcStat(pid: number): ReturnType<typeof parseProcStat> {
  try {
    return parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

/** Linux: the whole process table from /proc, with session ids. Null without /proc. */
function readProcTable(): ProcEntry[] | null {
  let names: string[];
  try {
    names = readdirSync('/proc');
  } catch {
    return null;
  }
  const out: ProcEntry[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const st = readProcStat(Number(name));
    if (!st) continue; // exited while we looked
    let cmd = '';
    try {
      cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8').replace(/\0+$/, '').replace(/\0/g, ' ');
    } catch {
      /* exited */
    }
    out.push({ ...st, cmd });
  }
  return out.length > 0 ? out : null;
}

/** macOS / no-/proc fallback: `ps` gives pid, ppid and process group, not sessions. */
function readPsTable(): ProcEntry[] {
  const out = execSync('ps -eo pid,ppid,pgid,command', {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const rows: ProcEntry[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m)
      rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgrp: Number(m[3]), cmd: m[4] ?? '' });
  }
  return rows;
}

/**
 * Decide which claude-agent-sdk processes are reapable. Pure — the process
 * table and the invoking pid are inputs — so every ownership rule is testable.
 *
 * With `ownerPid`, only that owner's direct SDK children are selected (the
 * org daemon reaping its own agents).
 *
 * Without it (`cleanup --force`), a process is an orphan only when ownership
 * says so, never by the name of pid 1:
 *  - it is not the invoking process, one of its ancestors, or a descendant;
 *  - it shares neither the invoking process's session nor its process group
 *    (a dummy whose parent reads as pid 1 but which belongs to the invoking
 *    session is still the invoker's);
 *  - no process up its parent chain is a still-running claude/monomind
 *    session (Claude Code running as a container's pid 1 keeps its SDK
 *    children, whose ppid is 1);
 *  - it is not in its live parent's session: a spawned child stays in its
 *    parent's session, while an orphan adopted by init, systemd --user,
 *    tini, bwrap or any other subreaper does not. A parent that is not
 *    visible counts as adoption only for ppid 1 (the true init outside a
 *    PID namespace's view).
 * Without session ids (macOS `ps`), the last rule falls back to "ppid is 1 or
 * the parent is an init/systemd", as before.
 */
export function selectOrphanedSdkPids(
  table: ProcEntry[],
  selfPid: number,
  protectedPids: Set<number>,
  ownerPid?: number,
): number[] {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const chainOf = (p: ProcEntry): ProcEntry[] => {
    const chain: ProcEntry[] = [];
    const seen = new Set([p.pid]);
    for (let cur = byPid.get(p.ppid); cur && !seen.has(cur.pid) && chain.length < MAX_CHAIN; ) {
      chain.push(cur);
      seen.add(cur.pid);
      cur = byPid.get(cur.ppid);
    }
    return chain;
  };
  const self = byPid.get(selfPid);
  const selfAncestors = new Set(self ? chainOf(self).map((a) => a.pid) : []);
  const picked: number[] = [];

  for (const c of table) {
    if (!SDK_CMD_RE.test(c.cmd) || protectedPids.has(c.pid) || c.pid === selfPid) continue;
    if (ownerPid != null) {
      if (c.ppid === ownerPid) picked.push(c.pid);
      continue;
    }
    if (!self || selfAncestors.has(c.pid)) continue; // cannot place ourselves: fail safe
    const chain = chainOf(c);
    if (chain.some((a) => a.pid === selfPid)) continue; // our own descendant
    if (self.sid !== undefined && c.sid === self.sid) continue;
    if (self.pgrp !== undefined && c.pgrp === self.pgrp) continue;
    if (chain.some((a) => isLiveSessionCmd(a.cmd))) continue;
    const parent = byPid.get(c.ppid);
    if (!parent) {
      if (c.ppid !== 1) continue;
    } else if (c.sid !== undefined && parent.sid !== undefined) {
      if (parent.sid === c.sid) continue;
    } else if (c.ppid !== 1 && !INIT_SUBREAPER_RE.test(parent.cmd)) {
      continue;
    }
    picked.push(c.pid);
  }
  return picked;
}

/** Kill orphaned claude-agent-sdk processes.
 *  @param protectedPids PIDs to never kill (e.g. sibling org agents).
 *  @param ownerPid Only kill SDK processes whose parent is this PID.
 *    When undefined, only kills processes `selectOrphanedSdkPids` proves
 *    orphaned by ownership (see there). */
export function reapOrphanedSdkProcesses(protectedPids: Set<number>, ownerPid?: number): number {
  // ps doesn't exist on native Windows — same rationale as countSdkProcesses above.
  if (platform() === 'win32') return 0;
  try {
    const table = (platform() === 'linux' ? readProcTable() : null) ?? readPsTable();
    const starts = new Map(table.map((p) => [p.pid, p.start]));
    let reaped = 0;
    for (const pid of selectOrphanedSdkPids(table, process.pid, protectedPids, ownerPid)) {
      // PID-reuse guard: the pid must still be the process that was judged.
      const start = starts.get(pid);
      if (start !== undefined && readProcStat(pid)?.start !== start) continue;
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
