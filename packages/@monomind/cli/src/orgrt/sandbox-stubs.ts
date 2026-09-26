// packages/@monomind/cli/src/orgrt/sandbox-stubs.ts
/**
 * Mount-point stubs for the SDK sandbox's write-denies, held for the whole run.
 *
 * The Claude Code sandbox (bubblewrap) denies writes to a fixed set of
 * "dangerous" paths: in the role's cwd, in every directory above it that is
 * writable in the sandbox, in the Claude config dir and in $HOME. For one that
 * does not exist it binds /dev/null onto it, so bwrap creates a 0-byte,
 * mode-0444 file there as the mount point (an empty directory for a missing
 * `.claude/`), and the SDK deletes it again when the command ends
 * (sandbox-runtime cleanupBwrapMountPoints). The SDK only coordinates that
 * within one process. Every role is its own CLI process sharing one cwd and
 * one ~/.claude, so role B, wrapping a command while role A's stub exists,
 * takes the stub for a real file and binds it onto itself (`--ro-bind P P`);
 * A's command ends, A deletes it, and B's bwrap dies with "Can't find source
 * path ~/.claude/local" (release runs since 2.16.x: 0–5 per run, each a
 * sandbox-fault).
 *
 * So before a sandboxed role starts, the runtime creates every such path that
 * is missing, the way bwrap would (an empty 0444 file; a plain `.claude/`
 * directory to hold them), and keeps it until the run ends. The SDK then only
 * ever finds an existing path, which it binds read-only and never tracks or
 * deletes, so no process removes a mount source another one is about to use.
 * At the end the runtime removes only what it created itself — still the same
 * inode, still empty; a path that already existed is never touched. Every
 * stub is also written to a per-machine ledger (defaultStubLedger()), so the
 * ones a SIGKILL'd daemon or a reboot leaves behind (an empty read-only file
 * at ~/.claude/commands would break the user's own Claude config for good)
 * are reclaimed by the next runtime under the same rule (reclaim()).
 *
 * The lists are what claude-agent-sdk 0.3.226 binds (read off /proc/self/
 * mountinfo inside its sandbox; sandbox-stubs-sdk.test.ts fails when an SDK
 * upgrade adds one). Left out on purpose: `.git/config.lock` (held, it makes
 * every `git config` write fail), the dirs the CLI writes into itself
 * (projects, shell-snapshots, session-env, plugins, backups), which a file
 * would break, and the state files it writes itself (.claude.json,
 * .config.json, .credentials.json): a CLI starting on an empty .config.json
 * exits with "configuration file … is corrupted". A path whose parent does not
 * exist is skipped.
 */

import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';

/** Relative to the role's cwd and to each sandbox-writable directory above it. */
const PROJECT_STUBS = [
  '.mcp.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/agents',
  '.claude/commands',
  '.claude/hooks',
  '.claude/skills',
  '.claude/workflows',
  '.claude/routines',
  '.claude/output-styles',
  '.claude/launch.json',
  '.claude/loop.md',
  '.claude/scheduled_tasks.json',
];

/** Relative to the role's cwd. Also what git-guard.ts hides from `git add`. */
export const CWD_STUBS = [
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.gitconfig',
  '.gitmodules',
  '.ripgreprc',
  '.idea',
  '.vscode',
  ...PROJECT_STUBS,
];

/** Relative to the Claude config dir ($CLAUDE_CONFIG_DIR, else ~/.claude). */
export const CONFIG_DIR_STUBS = [
  'settings.json',
  'settings.local.json',
  'CLAUDE.md',
  'agents',
  'commands',
  'hooks',
  'skills',
  'rules',
  'workflows',
  'routines',
  'output-styles',
  'ide',
  'local',
  'jobs',
  'daemon',
  'daemon.json',
  'launch.json',
  'loop.md',
  'policy-limits.json',
  'scheduled_tasks.json',
];

/** Relative to where the global config file lives ($CLAUDE_CONFIG_DIR, else $HOME). */
export const GLOBAL_CONFIG_STUBS = [
  '.claude-custom-oauth.json',
  '.claude-local-oauth.json',
  '.claude-staging-oauth.json',
];

const within = (root: string, p: string): boolean =>
  p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** Every stub path the sandbox binds for a role with this cwd and HOME, where
 *  `writableRoots` is the sandbox's `filesystem.allowWrite`. A `.claude`
 *  directory comes before the files in it. */
export function sandboxStubPaths(ctx: {
  cwd: string;
  home: string;
  writableRoots: string[];
  env?: NodeJS.ProcessEnv;
}): string[] {
  const configDir = ctx.env?.CLAUDE_CONFIG_DIR;
  const above: string[] = [];
  for (let d = dirname(ctx.cwd); ; d = dirname(d)) {
    if (ctx.writableRoots.some((r) => within(r, d))) above.push(d);
    if (d === dirname(d)) break;
  }
  const project = (dir: string) => [
    join(dir, '.claude'),
    ...PROJECT_STUBS.map((p) => join(dir, p)),
  ];
  return [
    ...project(ctx.cwd),
    ...CWD_STUBS.filter((p) => !PROJECT_STUBS.includes(p)).map((p) => join(ctx.cwd, p)),
    join(ctx.cwd, '.git', 'config.worktree'),
    ...above.flatMap(project),
    ...CONFIG_DIR_STUBS.map((p) => join(configDir ?? join(ctx.home, '.claude'), p)),
    ...GLOBAL_CONFIG_STUBS.map((p) => join(configDir ?? ctx.home, p)),
    join(ctx.home, '.mcp.json'),
  ];
}

/** Every name a stub can have: a ledger entry naming anything else is not
 *  reclaimed, whatever it says (the ledger lives in a directory the roles'
 *  sandboxed shells can write). */
const STUB_NAMES = new Set(
  ['.claude', 'config.worktree', ...CWD_STUBS, ...CONFIG_DIR_STUBS, ...GLOBAL_CONFIG_STUBS].map(
    (p) => basename(p),
  ),
);

/** The per-machine crash ledger: `MONOMIND_ORGRT_STUBS_DIR`, else
 *  ~/.monomind/orgrt-sandbox-stubs (next to orgrt-broker and orgrt-operator). */
export function defaultStubLedger(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.MONOMIND_ORGRT_STUBS_DIR || join(homedir(), '.monomind', 'orgrt-sandbox-stubs'),
    'ledger.json',
  );
}

export interface LedgerEntry {
  path: string;
  ino: number;
  dev: number;
  kind: 'file' | 'dir';
  pid: number;
  /** This pid's namespace and boot, so a later reclaim() can tell a dead pid
   *  in our own namespace apart from a live one we simply cannot see from a
   *  different namespace. Absent on an entry written before this field
   *  existed (see isLegacy). */
  pidNamespace?: string;
  bootId?: string;
  runId: string;
  createdAt: string;
}

function readLedger(file: string): LedgerEntry[] {
  try {
    const entries = (JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (e): e is LedgerEntry =>
        !!e &&
        typeof e.path === 'string' &&
        isAbsolute(e.path) &&
        typeof e.ino === 'number' &&
        typeof e.dev === 'number' &&
        (e.kind === 'file' || e.kind === 'dir') &&
        Number.isInteger(e.pid) &&
        (e.pidNamespace === undefined || typeof e.pidNamespace === 'string') &&
        (e.bootId === undefined || typeof e.bootId === 'string'),
    );
  } catch {
    return []; // missing or corrupt: nothing to reclaim
  }
}

/** Atomic (tmp + rename). Only a write that adds entries makes the dir: a
 *  removal has nothing to record where there is no ledger. */
function writeLedger(file: string, entries: LedgerEntry[], create: boolean): void {
  try {
    if (create) mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`);
    renameSync(tmp, file);
  } catch {
    /* best-effort: the stubs still work, only crash recovery is lost */
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Reads what identifies THIS process's pid namespace and boot, so a ledger
 *  entry can later tell a dead pid in our own namespace (safe to reclaim)
 *  apart from a live daemon's pid that we simply cannot see (the Claude SDK
 *  sandbox runs every role with `bwrap --unshare-pid`: `process.kill(pid, 0)`
 *  on a pid outside our namespace always throws ESRCH, alive or not). */
export interface IdentitySource {
  /** `/proc/self/ns/pid`'s target, e.g. `pid:[4026531836]`; undefined if it
   *  cannot be read (older kernel, no /proc). */
  pidNamespace(): string | undefined;
  /** `/proc/sys/kernel/random/boot_id`, stable for one boot and never reused
   *  across a reboot — unlike a pid, which is. */
  bootId(): string | undefined;
}

const defaultIdentity: IdentitySource = {
  pidNamespace(): string | undefined {
    try {
      return readlinkSync('/proc/self/ns/pid');
    } catch {
      return undefined;
    }
  },
  bootId(): string | undefined {
    try {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      return undefined;
    }
  },
};

/** An entry recorded before pid-namespace awareness (no `pidNamespace`/
 *  `bootId`), or one whose reader could not read them: falls back to the
 *  bare pid check (today's behavior, and correct outside any sandbox). */
function isLegacy(e: LedgerEntry): boolean {
  return e.pidNamespace === undefined || e.bootId === undefined;
}

interface Stub {
  dev: number;
  ino: number;
  dir: boolean;
  owners: Set<string>;
}

/** The stubs this process created, and which runs still need each one. */
export class SandboxStubs {
  private readonly stubs = new Map<string, Stub>();
  private exitHook = false;
  private reclaimed = false;

  /** `ledger`: the crash-ledger file (default defaultStubLedger(), read when
   *  first needed); null keeps no ledger. `identity`: overridable in tests;
   *  defaults to reading this process's real pid namespace and boot id. */
  constructor(
    private readonly ledger?: string | null,
    private readonly identity: IdentitySource = defaultIdentity,
  ) {}

  private get ledgerFile(): string | null {
    return this.ledger === undefined ? defaultStubLedger() : this.ledger;
  }

  /** Creates each missing path — a `.claude` path as a directory, anything
   *  else as an empty 0444 file — and records `owner` on every path this
   *  process created. The first call reclaims a dead runtime's stubs first.
   *  Returns the paths created now. */
  hold(owner: string, paths: string[]): string[] {
    if (!this.reclaimed) this.reclaim();
    const created: string[] = [];
    for (const p of paths) {
      const mine = this.stubs.get(p);
      if (mine) {
        mine.owners.add(owner);
        continue;
      }
      const dir = p.endsWith(`${sep}.claude`);
      try {
        if (!lstatSync(dirname(p)).isDirectory()) continue;
        // Exclusive: a path that exists in any form is not ours.
        if (dir) mkdirSync(p);
        else
          closeSync(openSync(p, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o444));
        const st = lstatSync(p);
        this.stubs.set(p, { dev: st.dev, ino: st.ino, dir, owners: new Set([owner]) });
        created.push(p);
      } catch {
        /* exists, no parent, or not writable: the SDK handles it as before */
      }
    }
    if (created.length) {
      this.updateLedger((entries) => [...entries, ...created.map((p) => this.entry(p, owner))]);
      if (!this.exitHook) {
        this.exitHook = true;
        process.on('exit', () => this.releaseAll());
      }
    }
    return created;
  }

  /** Drops `owner`; removes the stubs no other run holds. Returns them. */
  release(owner: string): string[] {
    const free: Array<[string, Stub]> = [];
    for (const [p, stub] of this.stubs) {
      stub.owners.delete(owner);
      if (!stub.owners.size) free.push([p, stub]);
    }
    return this.remove(free);
  }

  releaseAll(): void {
    this.remove([...this.stubs]);
  }

  /**
   * Stubs a runtime that died without cleaning up (SIGKILL, reboot) left in
   * the ledger. Each is removed under the same rule as our own — same inode,
   * still empty — and forgotten either way: a changed path is no longer a
   * stub. While another live runtime has stubs in the ledger, its roles may
   * be binding the dead one's as existing files, so they are adopted instead:
   * held by this process and removed when its first run ends. Entries of live
   * runtimes are kept. Returns the paths removed.
   */
  reclaim(): string[] {
    this.reclaimed = true;
    const file = this.ledgerFile;
    if (!file) return [];
    const entries = readLedger(file);
    const ourNs = this.identity.pidNamespace();
    const ourBootId = this.identity.bootId();
    const dead = entries.filter((e) => this.isDead(e, ourNs, ourBootId));
    if (!dead.length) return [];
    const othersLive = entries.some((e) => !this.isOwn(e, ourNs, ourBootId) && !dead.includes(e));
    const stale = dead
      .filter((e) => STUB_NAMES.has(basename(e.path)) && !this.stubs.has(e.path))
      .map((e): [string, Stub] => [
        e.path,
        { dev: e.dev, ino: e.ino, dir: e.kind === 'dir', owners: new Set() },
      ]);
    const removed: string[] = [];
    const adopted: LedgerEntry[] = [];
    for (const [p, stub] of stale.sort(([a], [b]) => b.length - a.length)) {
      if (othersLive) {
        if (unchanged(p, stub, true)) {
          this.stubs.set(p, stub);
          adopted.push(this.entry(p, 'adopted'));
        }
      } else if (removeIfUnchanged(p, stub)) removed.push(p);
    }
    this.updateLedger((all) => [...all.filter((e) => !dead.includes(e)), ...adopted], entries);
    return removed;
  }

  private entry(p: string, runId: string): LedgerEntry {
    const s = this.stubs.get(p) as Stub;
    return {
      path: p,
      ino: s.ino,
      dev: s.dev,
      kind: s.dir ? 'dir' : 'file',
      pid: process.pid,
      pidNamespace: this.identity.pidNamespace(),
      bootId: this.identity.bootId(),
      runId,
      createdAt: new Date().toISOString(),
    };
  }

  /** Is `e` an entry this process itself wrote? For a modern entry that also
   *  requires our current namespace and boot to match — a matching pid alone
   *  can be a different process after a pid wrap, or the same-numbered pid in
   *  an unrelated namespace. A legacy entry (no pidNamespace/bootId) falls
   *  back to the bare pid check it was written under — and so does every
   *  entry when OUR OWN identity could not be read (older kernel, no /proc):
   *  with no `ourNs`/`ourBootId` to compare against, a modern entry's real
   *  values would always look "different", which is not a safe basis for
   *  ownership either. */
  private isOwn(e: LedgerEntry, ourNs: string | undefined, ourBootId: string | undefined): boolean {
    if (isLegacy(e) || ourNs === undefined || ourBootId === undefined) return e.pid === process.pid;
    return e.pid === process.pid && e.pidNamespace === ourNs && e.bootId === ourBootId;
  }

  /** Is `e` safe to reclaim? A different boot always is (pids and namespace
   *  ids are meaningless across a reboot). Same boot but a different pid
   *  namespace never is — we cannot tell alive from dead across namespaces
   *  (`process.kill` always throws ESRCH there), so it is left alone rather
   *  than guessed at. Same boot and same namespace (or a legacy entry) falls
   *  back to the bare pid-alive check — and so does every entry when OUR OWN
   *  identity could not be read (older kernel, no /proc): without `ourNs`/
   *  `ourBootId` to compare against, a modern entry's real boot/namespace
   *  ids would always compare unequal, which would misjudge every live
   *  entry as a different boot and reclaim it. */
  private isDead(
    e: LedgerEntry,
    ourNs: string | undefined,
    ourBootId: string | undefined,
  ): boolean {
    if (isLegacy(e) || ourNs === undefined || ourBootId === undefined) {
      return e.pid === process.pid || !alive(e.pid);
    }
    if (e.bootId !== ourBootId) return true;
    if (e.pidNamespace !== ourNs) return false;
    return e.pid === process.pid || !alive(e.pid);
  }

  private updateLedger(
    change: (entries: LedgerEntry[]) => LedgerEntry[],
    current?: LedgerEntry[],
  ): void {
    const file = this.ledgerFile;
    if (!file) return;
    const before = current ?? readLedger(file);
    const after = change(before);
    writeLedger(file, after, after.length > before.length);
  }

  /** Files before the directories holding them; each only while unchanged. */
  private remove(entries: Array<[string, Stub]>): string[] {
    const removed: string[] = [];
    entries.sort(([a], [b]) => b.length - a.length);
    for (const [p, stub] of entries) {
      this.stubs.delete(p);
      if (removeIfUnchanged(p, stub)) removed.push(p);
    }
    if (entries.length) {
      const gone = new Set(entries.map(([p]) => p));
      const ourNs = this.identity.pidNamespace();
      const ourBootId = this.identity.bootId();
      this.updateLedger((all) =>
        all.filter((e) => !this.isOwn(e, ourNs, ourBootId) || !gone.has(e.path)),
      );
    }
    return removed;
  }
}

/** Is `p` still the empty file or directory recorded in `stub`? A directory
 *  that still holds stubs counts with `filledDir` (adoption: its stubs are
 *  adopted with it). */
function unchanged(p: string, stub: Stub, filledDir = false): boolean {
  try {
    const st = lstatSync(p);
    if (st.dev !== stub.dev || st.ino !== stub.ino) return false;
    if (stub.dir) return st.isDirectory() && (filledDir || readdirSync(p).length === 0);
    return st.isFile() && st.size === 0;
  } catch {
    return false;
  }
}

/** Removes `p` only while it is still the empty file or directory recorded. */
function removeIfUnchanged(p: string, stub: Stub): boolean {
  if (!unchanged(p, stub)) return false;
  try {
    if (stub.dir)
      rmdirSync(p); // fails unless (still) empty
    else unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/** One per process: every org run in it shares the cwd and ~/.claude stubs. */
export const sandboxStubs = new SandboxStubs();
