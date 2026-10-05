// packages/@monomind/cli/src/orgrt/operator-protected-paths.ts
/**
 * #502 review: paths no role may write because the OPERATOR's own processes
 * run or trust what is in them. A role that could write one could get code
 * run outside every role sandbox:
 *   - `<orgRoot>/.claude/` — the operator's Claude Code session in the
 *     project loads its settings, hooks and helpers;
 *   - `~/.monomind/` — the org skill library that decides the MCP tools the
 *     daemon grants, the terminal-execution opt-in gate, the broker
 *     registry, audit logs… — except the entries the CLI legitimately
 *     writes while a role uses it (ROLE_WRITABLE_MONOMIND);
 *   - `<project>/.monomind/org-skills/` (the project skill library);
 *   - #576: `<project>/.monomind/catalog/` — the catalog's state and
 *     packages, whose active `org` skills (their content and grantedTools,
 *     which decide the MCP tools the daemon grants) and blueprints roles get
 *     at start. Only the operator's `monomind catalog` writes it;
 *   - #580: the project config other runtimes' operator sessions load and
 *     act on, as Claude Code loads `.claude/` and `.mcp.json`
 *     (PROJECT_RUNTIME_CONFIG): `.agents/skills` (the catalog's other
 *     projection surface), the hook bridge, `.gemini/`, `.codex/`, … Like
 *     `.claude/` none is pre-created (that would leave stray dirs in every
 *     repo); while missing each is on the planted-path watch
 *     (planted-paths.ts);
 *   - `~/.npm/_npx` (what `npx -y monomind …` runs), `~/.npmrc`,
 *     `~/.local/bin`, and shell startup files beyond HOME_DENY_WRITE;
 *   - #527: the node, npm, claude and monomind installs the operator's
 *     processes run, the version-manager roots they live in, the directories
 *     on PATH, mise's trust store and direnv's allow list
 *     (operator-toolchain-paths.ts), and toolchain config files.
 *
 * Enforced three ways: the SDK sandbox's `denyWrite`, read-only binds in the
 * bubblewrap authority mask, and the file tools' deny pass (policy.ts). The
 * directories on the way to them are mount points in both OS layers
 * (operatorMountPoints), so none can be renamed aside and replaced. An
 * explicit, signed `policy.sandbox.allowWrite` entry at or inside one of
 * these paths is the opt-out for an org that really must write it.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { protectedClaudeBinary } from './claude-sdk.js';
import {
  ensureToolchainDirs,
  mountPointAncestors,
  operatorToolchainPaths,
  resetToolchainMemo,
  xdgDirs,
} from './operator-toolchain-paths.js';
import { realPath } from './policy-paths.js';

/** `~/.monomind` entries a role's own `monomind` commands write: browser
 *  automation state, the embedding-model cache, per-project memory, update
 *  checks, runner session dirs, and the release locks. Nothing the
 *  operator's processes execute or treat as a grant. */
export const ROLE_WRITABLE_MONOMIND = new Set([
  'browser-sessions',
  'browser-reports',
  'browse.db',
  'browse.db-wal',
  'browse.db-shm',
  'browse-runs.json',
  'models',
  'cache',
  'neural',
  'projects',
  'sessions',
  'sessions.json',
  'statusline-cache.json',
  'update-state.json',
  'update-history.json',
  'crash-reports.json',
  'pending-reports',
  'release-locks',
  'mcp.log',
  'mcp.pid',
]);

/** The allowlisted entries that are directories: created before the mask
 *  is built, so the mask can bind them writable inside a read-only
 *  ~/.monomind. */
const ROLE_WRITABLE_MONOMIND_DIRS = [
  'browser-sessions',
  'browser-reports',
  'models',
  'cache',
  'neural',
  'projects',
  'sessions',
  'pending-reports',
  'release-locks',
];

/** #502 review round 2: the bubblewrap mask's layout for ~/.monomind (and
 *  $MONOMIND_HOME): the directory itself read-only, so no new top-level
 *  entry can be planted, and only the allowlisted entries bound writable
 *  again — the same pattern as the orgs dir. An allowlisted FILE that does
 *  not exist yet cannot be created inside the mask. */
export function monomindMaskLayout(
  home: string,
  env: NodeJS.ProcessEnv,
): { readOnly: string[]; writable: string[] } {
  const roots = [...new Set([join(home, '.monomind'), monomindHome(home, env)])].filter((d) =>
    existsSync(d),
  );
  const writable: string[] = [];
  for (const root of roots) {
    for (const d of ROLE_WRITABLE_MONOMIND_DIRS) {
      try {
        mkdirSync(join(root, d), { recursive: true });
      } catch {
        /* left read-only */
      }
    }
    for (const e of ROLE_WRITABLE_MONOMIND)
      if (existsSync(join(root, e))) writable.push(join(root, e));
  }
  return { readOnly: roots, writable };
}

/** Under $HOME, beyond file-roots.ts's HOME_DENY_WRITE. */
export const HOME_OPERATOR_EXEC = [
  '.npm/_npx',
  // (.npmrc, .config/npm and .monomind/deps are in file-roots.ts's
  // HOME_DENY_WRITE since #518, applied in the same places.)
  '.local/bin',
  '.config/fish',
  '.bashrc.d',
  '.zshrc.d',
  // #527 review M3: config the operator's toolchain commands load and act
  // on (install hooks, env files, default global packages). The XDG ones
  // are added in protectedCandidates.
  '.bunfig.toml',
  '.cargo/env',
  '.cargo/config.toml',
  '.yarnrc.yml',
  '.default-npm-packages',
];

/** Under $XDG_CONFIG_HOME (default ~/.config), like HOME_OPERATOR_EXEC. */
export const XDG_CONFIG_OPERATOR_EXEC = ['pnpm/rc', 'go/env'];

/** Inside ~/.claude, the entries Claude Code executes or obeys. Used by the
 *  bubblewrap mask, which also wraps Claude Code itself and so cannot make
 *  the whole of ~/.claude (sessions, todos, credentials) read-only. */
export const CLAUDE_HOME_EXEC = [
  // The legacy global config: Claude Code prefers it over ~/.claude.json
  // whenever it exists (#502 review round 3).
  '.config.json',
  'settings.json',
  'settings.local.json',
  'hooks',
  'commands',
  'skills',
  'agents',
  'plugins',
  'helpers',
  'output-styles',
  'CLAUDE.md',
];

/** #580: relative to the org root and a role's cwd, what the operator's
 *  non-Claude sessions in the project load and act on: MCP servers, hooks and
 *  the scripts they run, plugins (and the node_modules OpenCode installs for
 *  them), extensions, skills and commands. A role that wrote one would get
 *  code run, or a skill loaded, in the operator's next Codex, Gemini, agy,
 *  Kimi, OpenCode, Qwen, Crush, pi, Cline, aider, Cursor, Kiro or Droid
 *  session. Instruction files (AGENTS.md, GEMINI.md, QWEN.md, rules) stay
 *  writable, like CLAUDE.md. Where a runtime writes into its own project dir
 *  while it runs as a role, only the parts it loads are listed (#582
 *  review), so that runtime keeps working:
 *  - OpenCode writes `.opencode/.gitignore` at every start and exits
 *    ("FileSystem.writeFile … Unknown") when it can't;
 *  - pi creates `.pi/settings.json.lock` to read its settings, and ignores
 *    them all when it can't;
 *  - Qwen Code writes `.qwen/worktrees/`, `batch/`, `PROJECT_SUMMARY.md`;
 *  - agy writes `.agents/teamwork/`; Crush keeps its data dir in `.crush/`. */
const under = (dir: string, entries: string[]): string[] => entries.map((e) => `${dir}/${e}`);
export const PROJECT_RUNTIME_CONFIG = [
  // The catalog's other projection surface (Codex, Gemini, Cursor, OpenCode,
  // Kimi… skills).
  '.agents/skills',
  // `node .agents/monomind/hook-bridge.mjs`, which rendered hooks run.
  '.agents/monomind',
  // agy's workspace hooks, plugins (their MCP servers and hooks) and the
  // skill dirs skills.json points it at.
  ...under('.agents', ['hooks.json', 'plugins', 'skills.json']),
  // settings.json (mcpServers, hooks), .env, helpers, commands, skills.
  '.gemini',
  // config.toml (mcp_servers, hooks) and the hook scripts it names.
  '.codex',
  // mcp.json and the plugin hooks.
  '.kimi-code',
  // What OpenCode loads from `.opencode/` (its globs), and the packages it
  // installs there for the plugins.
  ...under('.opencode', [
    ...['agent', 'agents', 'command', 'commands', 'mode', 'modes', 'plugin', 'plugins'],
    ...['skill', 'skills', 'tool', 'tools', 'themes', 'opencode.json', 'opencode.jsonc'],
    ...['tui.json', 'tui.jsonc', 'package.json', 'package-lock.json', 'bun.lock', 'node_modules'],
  ]),
  'opencode.json',
  'opencode.jsonc',
  ...under('.qwen', ['settings.json', '.env', 'commands', 'agents', 'skills', 'extensions']),
  'crush.json',
  '.crush.json',
  // Crush's shell-format project config, and its project skills.
  'crushrc',
  '.crushrc',
  '.crush/skills',
  // pi's settings (and the packages they install), extensions, skills,
  // prompt templates, themes and system prompt.
  ...under('.pi', ['settings.json', 'extensions', 'skills', 'prompts', 'themes', 'npm', 'git']),
  ...under('.pi', ['SYSTEM.md', 'APPEND_SYSTEM.md']),
  // Cline hooks and workflows (its rules are instructions).
  ...under('.clinerules', ['hooks', 'workflows']),
  // lint-cmd / test-cmd, which aider runs.
  '.aider.conf.yml',
  '.cursor',
  '.vscode/mcp.json',
  '.kiro',
  '.factory',
];

/** #582 review: at a root that is $HOME these PROJECT_RUNTIME_CONFIG dirs are
 *  the runtimes' own state (sessions, caches, installs), which a role's codex,
 *  agy, kimi, qwen, pi, OpenCode, cursor, droid or kiro writes while it runs;
 *  there they are left to the home rules. */
const RUNTIME_HOME_STATE = new Set([
  '.codex',
  '.gemini',
  '.kimi-code',
  '.qwen',
  '.pi',
  '.opencode',
  '.cursor',
  '.factory',
  '.kiro',
]);

/** PROJECT_RUNTIME_CONFIG under `root`, less RUNTIME_HOME_STATE at $HOME. */
function runtimeConfigUnder(root: string, home: string): string[] {
  const atHome = resolve(root) === resolve(home) || realPath(root) === realPath(home);
  return PROJECT_RUNTIME_CONFIG.filter(
    (p) => !(atHome && RUNTIME_HOME_STATE.has(p.split('/')[0])),
  ).map((p) => join(root, p));
}

export const monomindHome = (home: string, env: NodeJS.ProcessEnv): string =>
  env.MONOMIND_HOME ? resolve(env.MONOMIND_HOME) : join(home, '.monomind');

const within = (container: string, p: string): boolean =>
  p === container || p.startsWith(container.endsWith(sep) ? container : container + sep);

interface ProtectedCtx {
  home: string;
  env: NodeJS.ProcessEnv;
  orgRoot?: string;
  cwd?: string;
  allowWrite?: string[];
}

/** The signed `policy.sandbox.allowWrite` entries, absolute. */
export const optInPaths = (ctx: ProtectedCtx): string[] =>
  (ctx.allowWrite ?? []).map((p) => resolve(ctx.orgRoot ?? ctx.cwd ?? '.', p));

/** Is `p` protected: inside a protected path and not inside an opt-in? */
export function isOperatorProtected(
  p: string,
  ctx: ProtectedCtx,
  real: (x: string) => string,
  /** How a protected path contains `p`: the caller's DENY comparison
   *  (policy.ts passes `isWithin(…, fold.deny)`, so `.Claude/` or
   *  `.MCP.json` are refused where the filesystem folds case). An opt-in
   *  (a signed allowWrite) always compares exactly. */
  insideProtected: (container: string, target: string) => boolean = within,
): string | undefined {
  if (optInPaths(ctx).some((a) => within(real(a), p) || within(a, p))) return undefined;
  return protectedCandidates(ctx).find((d) => insideProtected(real(d), p) || insideProtected(d, p));
}

/** `p` with `optIn` carved out of it, for an OS layer that can only deny
 *  whole paths: `p` itself when nothing inside it is opted in, nothing when
 *  an opt-in covers it, else its children (recursively) less the branch that
 *  holds the opt-in. */
function carve(p: string, optIn: string[]): string[] {
  if (optIn.some((a) => within(a, p))) return [];
  const inside = optIn.filter((a) => within(p, a));
  if (!inside.length) return [p];
  let entries: string[];
  try {
    entries = readdirSync(p);
  } catch {
    return [p];
  }
  return entries.flatMap((e) => carve(join(p, e), inside));
}

/** Every protected path (existing or not) for a role with this org root and
 *  cwd, with what a signed `policy.sandbox.allowWrite` entry opts into
 *  carved out — the form the SDK sandbox and the bubblewrap mask take. */
export function operatorProtectedPaths(ctx: ProtectedCtx): string[] {
  const optIn = optInPaths(ctx);
  return protectedCandidates(ctx).flatMap((p) => carve(p, optIn));
}

function protectedCandidates(ctx: ProtectedCtx): string[] {
  const mmHome = monomindHome(ctx.home, ctx.env);
  const monomindEntries: string[] = [];
  // #527 review round 2: with the org root at $HOME, ~/.monomind/orgs is the
  // org's own orgs dir, whose work dirs its roles write; its authority files
  // stay protected (org-authority-files.ts).
  const ownOrgs = ctx.orgRoot ? realPath(join(ctx.orgRoot, '.monomind', 'orgs')) : undefined;
  try {
    for (const e of readdirSync(mmHome))
      if (!ROLE_WRITABLE_MONOMIND.has(e) && realPath(join(mmHome, e)) !== ownOrgs)
        monomindEntries.push(join(mmHome, e));
  } catch {
    /* no ~/.monomind yet */
  }
  const roots = [...new Set([ctx.orgRoot, ctx.cwd].filter((r): r is string => !!r))];
  const paths = [
    ...roots.map((r) => join(r, '.claude')),
    // The project's MCP servers, which the operator's Claude Code starts.
    ...roots.map((r) => join(r, '.mcp.json')),
    ...roots.map((r) => join(r, '.monomind', 'org-skills')),
    ...roots.map((r) => join(r, '.monomind', 'catalog')),
    ...roots.flatMap((r) => runtimeConfigUnder(r, ctx.home)),
    join(mmHome, 'org-skills'),
    // #599: protect future CLI inputs even before any file-based runner runs.
    join(ctx.home, '.monomind', 'runner-inputs'),
    join(mmHome, 'runner-inputs'),
    join(mmHome, 'enable-terminal.json'),
    ...monomindEntries,
    ...HOME_OPERATOR_EXEC.map((p) => join(ctx.home, p)),
    ...XDG_CONFIG_OPERATOR_EXEC.map((p) => join(xdgDirs(ctx.home, ctx.env).config, p)),
    // #527: never one that holds the role's own work tree.
    ...operatorToolchainPaths(ctx.home, ctx.env, roots).filter(
      (t) => !roots.some((r) => within(t, r)),
    ),
    // #522: the MONOMIND_CLAUDE_PATH binary (its real path), which the
    // daemons run unsandboxed. The mask and the SDK sandbox also pin the
    // directories above it (claude-sdk.ts's protectedClaudeBinary().dirs).
    ...[protectedClaudeBinary(ctx.env, ctx.home)?.file].filter((f): f is string => !!f),
  ];
  return [...new Set(paths)];
}

/** #527: the directories on the way to each protected path that a role could
 *  rename aside (operator-toolchain-paths.ts's mountPointAncestors). The SDK
 *  sandbox lists them in allowWrite and the mask binds them onto themselves:
 *  either way a mount point, which cannot be renamed. */
export function operatorMountPoints(ctx: ProtectedCtx): string[] {
  return mountPointAncestors(operatorProtectedPaths(ctx), {
    home: ctx.home,
    roots: [ctx.orgRoot, ctx.cwd].filter((r): r is string => !!r),
  });
}

/** Paths the bubblewrap mask binds read-only: the protected paths plus the
 *  guard-undoing home files, with ~/.claude narrowed to CLAUDE_HOME_EXEC. */
export function maskReadOnlyPaths(ctx: {
  home: string;
  env: NodeJS.ProcessEnv;
  orgRoot?: string;
  cwd?: string;
  allowWrite?: string[];
  homeDenyWrite: string[];
}): string[] {
  // ~/.claude.json holds the operator's `mcpServers`: read-only too. Claude
  // Code itself runs inside the mask and writes that file on its own, and
  // copes with it being read-only (operator-paths-sdk.test.ts).
  const home = ctx.homeDenyWrite.filter((p) => p !== '.claude').map((p) => join(ctx.home, p));
  const claude = CLAUDE_HOME_EXEC.map((p) => join(ctx.home, '.claude', p));
  return [...new Set([...home, ...claude, ...operatorProtectedPaths(ctx)])].filter((p) =>
    existsSync(p),
  );
}

/** Create what must exist before a role starts for the denies to hold: an
 *  OS sandbox can only protect a path that exists, and a role creating one
 *  of these first would plant it. The skill libraries and the npx cache are
 *  empty directories; the terminal gate is written as disabled, which is
 *  what its absence already meant (terminal-tools-core.ts); and the
 *  HOME_DENY_WRITE stubs below (#526). An empty `.monomind/catalog/` means
 *  what its absence meant: no state.json, catalog not configured. */
export function ensureOperatorProtectedPaths(ctx: {
  home: string;
  env: NodeJS.ProcessEnv;
  orgRoot?: string;
  platform?: NodeJS.Platform;
}): void {
  const mmHome = monomindHome(ctx.home, ctx.env);
  const dirs = [join(mmHome, 'org-skills'), join(ctx.home, '.npm', '_npx')];
  // #599: Linux drops a missing denyWrite path. Create the protected root
  // before the first role starts, so later runner inputs are covered too.
  for (const root of new Set([
    join(ctx.home, '.monomind', 'runner-inputs'),
    join(mmHome, 'runner-inputs'),
  ])) {
    try {
      mkdirSync(root, { recursive: true, mode: 0o700 });
    } catch {
      /* unwritable: no runner can create trusted inputs there either */
    }
  }
  if (ctx.orgRoot)
    dirs.push(
      join(ctx.orgRoot, '.monomind', 'org-skills'),
      join(ctx.orgRoot, '.monomind', 'catalog'),
    );
  for (const d of dirs) {
    try {
      mkdirSync(d, { recursive: true });
    } catch {
      /* unwritable: nothing can plant it either */
    }
  }
  const gate = join(mmHome, 'enable-terminal.json');
  try {
    writeFileSync(gate, '{ "enabled": false }\n', { flag: 'wx' });
  } catch {
    /* exists (the operator's own choice) or unwritable */
  }
  // #527: the toolchain list is recomputed for every org and session start,
  // after the directories it expects are created.
  ensureToolchainDirs(ctx.home, ctx.env);
  resetToolchainMemo();
  ensureHomeDenyWriteStubs(ctx.home, ctx.env, ctx.platform ?? process.platform);
}

/** #526: HOME_DENY_WRITE entries created in the operator's HOME when they
 *  are absent, at org or session start (never overwriting), so the SDK
 *  sandbox's denyWrite (which drops missing paths) and the mask's read-only
 *  binds cover them too. Each is either an empty file or an empty 0700
 *  directory, and each means exactly what its absence meant:
 *  - `.npmrc`: npm merges an empty user config into nothing;
 *  - `.bashrc`: read only by interactive bash, which runs nothing from it;
 *  - `.profile`: read by sh/dash login shells, and by bash only when
 *    `.bash_profile` and `.bash_login` are absent; zsh never reads it;
 *    empty, it runs nothing in any of them. Not created when $SHELL is zsh
 *    or fish: installers such as nvm's append to ~/.profile when it exists
 *    instead of the shell's own rc file, which that shell would then miss;
 *  - `.ssh`, `.config/git`, `.config/gh`, `.config/npm`: tools read files
 *    inside them, never the directory itself (git's `--global` target
 *    depends on `~/.config/git/config`, a file, not on the directory).
 *  `~/.config` is created too when it is missing.
 *  Linux only. On macOS the SDK's seatbelt denies a missing path by rule
 *  (role-sandbox-restrictions.ts), so only `~/.config` is created there, so
 *  that the entries below it can be passed (their parent must exist). */
export const HOME_DENY_WRITE_STUB_DIRS = ['.ssh', '.config/git', '.config/gh', '.config/npm'];
export const HOME_DENY_WRITE_STUB_FILES = ['.npmrc', '.bashrc', '.profile'];
/** Never created, left to the planted-path watch (planted-paths.ts; on
 *  macOS the SDK's seatbelt also denies creating them, by path):
 *  - `.bash_profile`, `.bash_login`: an empty one makes a bash login shell
 *    skip `~/.profile`;
 *  - `.gitconfig`: once it exists, `git config --global` writes go to it
 *    instead of a `~/.config/git/config` the operator creates later;
 *  - `.zshrc`, `.zprofile`, `.zshenv`, `.zlogin`: with none of them, zsh
 *    runs its new-user setup, and an empty one would stop that;
 *  - `.claude`, `.claude.json`: Claude Code's own state (an empty
 *    `.claude.json` is a corrupt config);
 *  - `.monomind/deps`: optional-deps.ts creates it. */
export const HOME_DENY_WRITE_NOT_STUBBED = [
  '.bash_profile',
  '.bash_login',
  '.gitconfig',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.claude',
  '.claude.json',
  '.monomind/deps',
];

function ensureHomeDenyWriteStubs(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): void {
  if (platform === 'darwin') {
    try {
      mkdirSync(join(home, '.config'));
    } catch {
      /* exists, or unwritable */
    }
    return;
  }
  if (platform !== 'linux') return;
  const loginShell = basename(env.SHELL ?? '');
  const files = HOME_DENY_WRITE_STUB_FILES.filter(
    (f) => f !== '.profile' || (loginShell !== 'zsh' && loginShell !== 'fish'),
  );
  for (const d of HOME_DENY_WRITE_STUB_DIRS) {
    try {
      mkdirSync(dirname(join(home, d)), { recursive: true });
      mkdirSync(join(home, d), { mode: 0o700 });
    } catch {
      /* exists, or unwritable: nothing can plant it either */
    }
  }
  for (const f of files) {
    try {
      writeFileSync(join(home, f), '', { flag: 'wx', mode: 0o600 });
    } catch {
      /* exists, or unwritable */
    }
  }
}
