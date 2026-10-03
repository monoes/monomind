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
 * would break, and the state files it reads and writes itself: the live
 * global config ($CLAUDE_CONFIG_DIR/.claude.json, else $HOME/.claude.json),
 * the legacy <config dir>/.config.json it prefers when that exists (a CLI
 * starting on an empty one exits with "configuration file … is corrupted")
 * and .credentials.json. A path whose parent does not exist is skipped.
 *
 * The SDK binds `.claude{,-staging-oauth,-local-oauth,-custom-oauth}.json`
 * next to whichever global config the CLI picked: with a legacy
 * ~/.claude/.config.json that is ~/.claude/, so ~/.claude/.claude.json became
 * a raced stub ("Can't find source path ~/.claude/.claude.json", 2.16.15).
 * Without CLAUDE_CONFIG_DIR the CLI never reads those four in ~/.claude/ —
 * its config is ~/.claude/.config.json or $HOME/.claude*.json — so they are
 * held too (HOME_CONFIG_DIR_STUBS). With CLAUDE_CONFIG_DIR set,
 * $CLAUDE_CONFIG_DIR/.claude.json can be the live config and is left alone.
 *
 * File-size sweep: the path lists + sandboxStubPaths() live in
 * sandbox-stubs-paths.ts, and the crash ledger + pid-namespace identity live
 * in sandbox-stubs-ledger.ts — both re-exported below where other modules
 * import them from here.
 */

import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, sep } from 'node:path';
import {
  alive,
  defaultIdentity,
  defaultStubLedger,
  type IdentitySource,
  isLegacy,
  type LedgerEntry,
  readLedger,
  writeLedger,
} from './sandbox-stubs-ledger.js';
import { STUB_NAMES } from './sandbox-stubs-paths.js';

export { defaultStubLedger, type LedgerEntry } from './sandbox-stubs-ledger.js';
export { CWD_STUBS, sandboxStubPaths } from './sandbox-stubs-paths.js';

interface Stub {
  dev: number;
  ino: number;
  /** Files only: a directory's ctime moves whenever an entry inside it does. */
  ctimeMs?: number;
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
        this.stubs.set(p, {
          dev: st.dev,
          ino: st.ino,
          ctimeMs: dir ? undefined : st.ctimeMs,
          dir,
          owners: new Set([owner]),
        });
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
        this.releaseOnSignals();
      }
    }
    return created;
  }

  /**
   * A signal kills a process without running its 'exit' handlers, so a trial
   * ended by `timeout` (SIGTERM at the deadline) left ~/.mcp.json behind
   * (parallel-sweep-3 p1t). On SIGTERM/SIGINT this releases what the process
   * holds (synchronous and idempotent, so it cannot hang or double-remove) and,
   * when nothing else in the process handles the signal, lets it take its
   * default course again. A process with a handler of its own (`org run`'s
   * wait loop, `org serve`) keeps its graceful shutdown, which stops the orgs
   * and releases again as a no-op. Prepended so it runs before once-listeners
   * remove themselves from the count. SIGKILL cannot be handled: the ledger
   * reclaim covers it.
   */
  private releaseOnSignals(): void {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      const onSignal = (): void => {
        this.releaseAll();
        if (process.listenerCount(sig) > 1) return;
        process.removeListener(sig, onSignal);
        process.kill(process.pid, sig);
      };
      process.prependListener(sig, onSignal);
    }
  }

  /**
   * The paths among `paths` that bwrap could still have to create as a mount
   * point: neither a stub this process holds nor something that exists for
   * good. An empty file or directory we did not make is what another
   * process's bwrap stub looks like, and it vanishes when that sandbox ends,
   * so it counts as missing. A path whose parent is not a directory is left
   * out: the SDK skips it (a file ancestor, or no `.git` dir), and a missing
   * `.claude` parent is reported itself.
   */
  missing(paths: string[]): string[] {
    return paths.filter((p) => !this.stubs.has(p) && !lasting(p) && isDir(dirname(p)));
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
        { dev: e.dev, ino: e.ino, ctimeMs: e.ctimeMs, dir: e.kind === 'dir', owners: new Set() },
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
      ...(s.ctimeMs === undefined ? {} : { ctimeMs: s.ctimeMs }),
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
   *  namespace is only when that namespace provably has no process left
   *  (identity.namespaceLive: a sandboxed drill runtime killed before its
   *  cleanup, 2.16.16 release run) — otherwise we cannot tell alive from dead
   *  across namespaces (`process.kill` always throws ESRCH there), so it is
   *  left alone rather than guessed at. Same boot and same namespace (or a legacy entry) falls
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
    if (e.pidNamespace !== ourNs)
      return this.identity.namespaceLive?.(e.pidNamespace as string) === false;
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

const isDir = (p: string): boolean => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Exists and is not an empty file or directory (a symlink counts: the SDK
 *  binds over it without creating anything). */
function lasting(p: string): boolean {
  try {
    const st = lstatSync(p);
    if (st.isDirectory()) return readdirSync(p).length > 0;
    return !st.isFile() || st.size > 0;
  } catch {
    return false;
  }
}

/** Is `p` still the empty file or directory recorded in `stub`? A directory
 *  that still holds stubs counts with `filledDir` (adoption: its stubs are
 *  adopted with it). */
function unchanged(p: string, stub: Stub, filledDir = false): boolean {
  try {
    const st = lstatSync(p);
    if (st.dev !== stub.dev || st.ino !== stub.ino) return false;
    if (stub.ctimeMs !== undefined && st.ctimeMs !== stub.ctimeMs) return false;
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
