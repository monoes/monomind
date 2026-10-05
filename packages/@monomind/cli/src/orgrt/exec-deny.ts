// packages/@monomind/cli/src/orgrt/exec-deny.ts
/**
 * `policy.sandbox.denyExec`: programs a role must not be able to run (opt-in;
 * a role without it is unchanged).
 *
 * Two layers, and only the first one enforces:
 *   1. The mask. The role's whole process tree (the Claude CLI and everything
 *      its Bash tool starts, a nested SDK sandbox included, or any other CLI
 *      runtime) is launched inside a bubblewrap layer in which every matching
 *      binary is replaced by /dev/null: running it is EACCES, and copying it
 *      yields nothing (cp reads an empty file). The layer has its own pid
 *      namespace, so `/proc/<pid>/exe` of the daemon's own node is not there to
 *      copy. A name is looked up in every PATH directory, the system bin
 *      directories and the version managers' trees (mise, nvm, fnm, asdf,
 *      volta, bun, deno, pyenv ...), by real path, so the mise shim, the
 *      system copy and the installed copy are all covered. It fails closed:
 *      with no usable bubblewrap the role does not start.
 *   2. The command check (execDenyViolation, in the PolicyEngine's Bash
 *      decision). It reads the command the model wrote and refuses one that
 *      names a denied program in a command position, through env, xargs,
 *      find -exec, sh -c and the like. It is a convenience for a clear refusal,
 *      and the only layer a runtime without bubblewrap would have; a command
 *      built at run time (base64, a script file) gets past it, not past 1.
 *
 * Not covered, by construction: a binary this resolver does not find (a
 * program with an engine built in, under a name no pattern matches), and the
 * shell itself, which stays available: bash, sed and awk can still be
 * scripted by a role that writes its own evaluator.
 */
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import { authorityMaskAvailability } from './authority-mask.js';
import type { OrgBus } from './bus.js';
import { homeLayerAvailability, homeWriteLayer } from './home-write-deny.js';
import { shellSegments } from './shell-scan.js';

const SYSTEM_DIRS = [
  '/usr/bin',
  '/bin',
  '/usr/local/bin',
  '/usr/sbin',
  '/sbin',
  '/usr/local/sbin',
  '/snap/bin',
  '/opt/homebrew/bin',
];

/** Version-manager and per-user install trees under $HOME, searched to a bounded depth. */
const MANAGER_DIRS = [
  '.local/share/mise/installs',
  '.local/share/mise/shims',
  '.nvm/versions',
  '.local/share/fnm/node-versions',
  '.fnm/node-versions',
  '.volta/bin',
  '.volta/tools',
  '.bun/bin',
  '.deno/bin',
  '.asdf/installs',
  '.asdf/shims',
  '.pyenv/versions',
  '.pyenv/shims',
  '.rbenv/versions',
  '.rbenv/shims',
  '.nodenv/versions',
  '.local/share/pnpm',
  '.cargo/bin',
  '.local/bin',
  '.local/share/uv/python',
  '.local/share/proto',
];
const WALK_DEPTH = 6;
const WALK_SKIP = new Set(['node_modules', '.git', 'downloads']);

const matcher = (names: string[]): ((n: string) => boolean) => {
  const res = names.map(
    (p) =>
      new RegExp(
        `^${p
          .split('*')
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      ),
  );
  return (n) => res.some((r) => r.test(n));
};

const real = (p: string): string | undefined => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};
const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export interface DenyExecCtx {
  home: string;
  env: NodeJS.ProcessEnv;
  /** Override the system bin directories (tests). */
  systemDirs?: string[];
}

/** The real paths of every executable file `patterns` name: bare names (`*` globs) wherever the
 *  resolver looks, absolute paths as themselves. A symlink is followed; its target is masked only
 *  when the target's own name matches too (so a version manager's shim, which points at the manager,
 *  is left alone: it ends in the masked interpreter). The running node is always among them when its
 *  name matches. */
export function resolveDenyExec(patterns: string[], ctx: DenyExecCtx): string[] {
  const names = patterns.filter((p) => !p.startsWith('/'));
  const wanted = matcher(names);
  const out = new Set<string>();
  const consider = (path: string) => {
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(path);
    } catch {
      return;
    }
    const target = st.isSymbolicLink() ? real(path) : path;
    if (!target || !isFile(target)) return;
    if (st.isSymbolicLink() && !wanted(basename(target))) return;
    if (!(statSync(target).mode & 0o111)) return;
    const r = real(target);
    if (r) out.add(r);
  };
  const list = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const dir of [...(ctx.env.PATH ?? '').split(delimiter), ...(ctx.systemDirs ?? SYSTEM_DIRS)])
    if (dir) for (const e of list(dir)) if (wanted(e.name)) consider(join(dir, e.name));
  const walk = (dir: string, depth: number) => {
    for (const e of list(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < WALK_DEPTH && !WALK_SKIP.has(e.name)) walk(p, depth + 1);
      } else if (wanted(e.name)) consider(p);
    }
  };
  for (const d of MANAGER_DIRS) walk(join(ctx.home, d), 1);
  if (wanted(basename(process.execPath))) consider(process.execPath);
  for (const p of patterns.filter((x) => x.startsWith('/'))) {
    const r = real(p);
    if (r && isFile(r)) out.add(r);
  }
  return [...out];
}

/** bubblewrap arguments, to follow an existing mask's or `--dev-bind / /`. `hide` (policy.sandbox
 *  denyRead): an existing file reads as empty, an existing directory as an empty one. */
function maskTail(paths: string[], hide: string[] = []): string[] {
  const hidden = hide.flatMap((p) => {
    const r = real(p);
    if (!r) return [];
    return isFile(r) ? ['--ro-bind', '/dev/null', r] : ['--tmpfs', r];
  });
  return [
    '--unshare-pid',
    '--proc',
    '/proc',
    ...paths.flatMap((p) => ['--ro-bind', '/dev/null', p]),
    ...hidden,
  ];
}

/** A complete mask for `patterns`: the whole filesystem as it is, minus those programs. */
export function denyExecMask(patterns: string[], ctx: DenyExecCtx): string[] {
  return ['--dev-bind', '/', '/', ...maskTail(resolveDenyExec(patterns, ctx))];
}

/** The mask a session launches its runner in: `authorityMask` (undefined when the role has none)
 *  plus the denyExec layer and the home write-deny layer (home-write-deny.ts). Unchanged without
 *  `denyExec`, `denyRead` or `homeWriteAllow`. Throws when the role asks for one of them and
 *  bubblewrap cannot do it: a role must not start with the program reachable or the home open. */
export function roleExecMask(args: {
  bus: OrgBus;
  roleId: string;
  authorityMask: string[] | undefined;
  denyExec?: string[];
  denyRead?: string[];
  /** Directories the daemon itself wants unreadable (GA row R3: other roles' mail digests). Unlike
   *  `denyRead`, bubblewrap being unavailable does not refuse the role: the audit
   *  `mail-mask-unavailable` is raised and the file-tool and SDK-sandbox layers still apply. */
  bestEffortDenyRead?: string[];
  /** Directories to bind read-only for every role (GA row R4: the mail root). Best-effort like `bestEffortDenyRead`. */
  bestEffortReadOnly?: string[];
  /** `policy.sandbox.homeWriteAllow`: set (even empty) to make the real home unwritable apart from these. */
  homeWriteAllow?: string[];
  /** Paths that must stay writable if they are under the home (cwd, org root, allowWrite, tmp). */
  writableRoots?: Array<string | undefined>;
  home: string;
  env: NodeJS.ProcessEnv;
  availability?: { available: boolean; reason?: string };
  homeAvailability?: { available: boolean; reason?: string };
}): string[] | undefined {
  const homeWrite = args.homeWriteAllow !== undefined;
  const bestEffort = args.bestEffortDenyRead ?? [];
  const roBinds = (args.bestEffortReadOnly ?? []).flatMap((d) => {
    const r = real(d);
    return r ? ['--ro-bind', r, r] : [];
  });
  if (!args.denyExec?.length && !args.denyRead?.length && !homeWrite) {
    if (!bestEffort.length && !args.bestEffortReadOnly?.length) return args.authorityMask;
    const avail = args.availability ?? authorityMaskAvailability();
    if (avail.available)
      return [
        ...(args.authorityMask ?? ['--dev-bind', '/', '/']),
        ...roBinds,
        ...maskTail([], bestEffort),
      ];
    args.bus.emit({
      type: 'audit',
      from: args.roleId,
      reason: 'mail-mask-unavailable',
      msg: `bubblewrap cannot mask other roles' mail digests for ${args.roleId} (${avail.reason}); the file-tool and SDK-sandbox denials still apply`,
      data: {},
    });
    return args.authorityMask;
  }
  const availability = args.availability ?? authorityMaskAvailability();
  const refuse = (key: string, reason: string | undefined, listed: string[]): never => {
    const msg = `policy.sandbox.${key} is set for role ${args.roleId} but bubblewrap cannot do it (${reason}): refusing to start it with ${listed.join(', ')} reachable`;
    args.bus.emit({
      type: 'audit',
      from: args.roleId,
      reason: 'deny-exec-unavailable',
      msg,
      data: {},
    });
    throw new Error(msg);
  };
  if (!availability.available) {
    const key = args.denyExec?.length
      ? 'denyExec'
      : args.denyRead?.length
        ? 'denyRead'
        : 'homeWriteAllow';
    refuse(key, availability.reason, [
      ...(args.denyExec ?? []),
      ...(args.denyRead ?? []),
      ...(homeWrite ? ['the real home (writable)'] : []),
    ]);
  }
  let head = args.authorityMask ?? ['--dev-bind', '/', '/'];
  if (homeWrite) {
    const h = args.homeAvailability ?? homeLayerAvailability();
    if (!h.available) refuse('homeWriteAllow', h.reason, ['the real home (writable)']);
    if (head.slice(0, 3).join(' ') !== '--dev-bind / /')
      throw new Error(`policy.sandbox.homeWriteAllow: unexpected mask for role ${args.roleId}`);
    const layer = homeWriteLayer({
      home: args.home,
      env: args.env,
      allow: args.homeWriteAllow ?? [],
      writable: args.writableRoots,
    });
    // first, right after the root bind: every bind of the mask below goes on top of the overlay
    head = [...head.slice(0, 3), ...layer, ...head.slice(3)];
  }
  const paths = resolveDenyExec(args.denyExec ?? [], { home: args.home, env: args.env });
  return [...head, ...roBinds, ...maskTail(paths, [...(args.denyRead ?? []), ...bestEffort])];
}

// ---- the command check ----------------------------------------------------

/** Commands that run another command named in their arguments. */
const WRAPPERS = new Set([
  'env',
  'xargs',
  'exec',
  'command',
  'builtin',
  'nohup',
  'time',
  'nice',
  'ionice',
  'timeout',
  'sudo',
  'doas',
  'setsid',
  'stdbuf',
  'watch',
  'parallel',
  'strace',
  'ltrace',
  'busybox',
  'chroot',
  'unshare',
  'nsenter',
  'flock',
  'taskset',
  'chrt',
  'su',
  'runuser',
]);
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish', 'eval']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HIDDEN = /[$`]/;

function scan(
  cmd: string,
  denied: (n: string) => boolean,
  shown: string,
  depth: number,
): string | undefined {
  if (depth > 8) return `cannot verify (nested too deep): ${shown}`;
  const { segments, opaque } = shellSegments(cmd);
  if (opaque) return `cannot verify (${opaque}) under policy.sandbox.denyExec`;
  const refuse = (w: string) =>
    `policy.sandbox.denyExec: ${basename(w)} is not available to this role`;
  const unverifiable = (w: string) => `cannot verify what ${w} runs under policy.sandbox.denyExec`;
  for (const seg of segments) {
    let i = 0;
    while (i < seg.length && ASSIGN.test(seg[i])) i++;
    const first = seg[i];
    if (first === undefined) continue;
    if (HIDDEN.test(first)) return unverifiable(first);
    const base = basename(first);
    if (denied(base)) return refuse(first);
    const rest = seg.slice(i + 1);
    let args = rest;
    if (base === 'find') {
      const at = rest.findIndex((t) => FIND_EXEC.has(t));
      args = at < 0 ? [] : rest.slice(at + 1);
    } else if (!WRAPPERS.has(base) && !SHELLS.has(base)) continue;
    for (const t of args) {
      if (denied(basename(t))) return refuse(t);
      if ((SHELLS.has(base) || base === 'env' || base === 'xargs') && HIDDEN.test(t) && t !== '{}')
        return unverifiable(base);
      if (/\s/.test(t) || SHELLS.has(base)) {
        const inner = scan(t, denied, shown, depth + 1);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/** Why a Bash command must not run because it names a program denied by `policy.sandbox.denyExec`
 *  in a command position, or undefined. Fails closed on a command position it cannot read. */
export function execDenyViolation(cmd: string, patterns: string[] | undefined): string | undefined {
  if (!patterns?.length) return undefined;
  const denied = matcher(patterns.map((p) => basename(p)));
  return scan(cmd, denied, cmd, 0);
}
