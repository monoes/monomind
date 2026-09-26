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
 * inode, still empty; a path that already existed is never touched. A
 * SIGKILL'd daemon leaves its stubs behind, as the SDK's own do; a later run
 * treats them as pre-existing.
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
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';

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

  /** Creates each missing path — a `.claude` path as a directory, anything
   *  else as an empty 0444 file — and records `owner` on every path this
   *  process created. Returns the paths created now. */
  hold(owner: string, paths: string[]): string[] {
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
    if (created.length && !this.exitHook) {
      this.exitHook = true;
      process.on('exit', () => this.releaseAll());
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

  /** Files before the directories holding them; each only while unchanged. */
  private remove(entries: Array<[string, Stub]>): string[] {
    const removed: string[] = [];
    entries.sort(([a], [b]) => b.length - a.length);
    for (const [p, stub] of entries) {
      this.stubs.delete(p);
      if (removeIfUnchanged(p, stub)) removed.push(p);
    }
    return removed;
  }
}

/** Unlinks `p` only while it is still the empty file or directory this
 *  process made. */
function removeIfUnchanged(p: string, stub: Stub): boolean {
  try {
    const st = lstatSync(p);
    if (st.dev !== stub.dev || st.ino !== stub.ino) return false;
    if (stub.dir) {
      if (!st.isDirectory()) return false;
      rmdirSync(p); // fails unless empty
    } else {
      if (!st.isFile() || st.size !== 0) return false;
      unlinkSync(p);
    }
    return true;
  } catch {
    return false;
  }
}

/** One per process: every org run in it shares the cwd and ~/.claude stubs. */
export const sandboxStubs = new SandboxStubs();
