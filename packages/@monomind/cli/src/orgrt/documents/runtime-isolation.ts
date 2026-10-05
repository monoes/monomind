// packages/@monomind/cli/src/orgrt/documents/runtime-isolation.ts
/**
 * Sections orgs on every runtime (design note, section 4): where each role
 * runtime keeps its native copies (transcripts, logs, backups, checkpoints) and
 * the one strategy that keeps one role's copies from another's.
 *
 *  - `mask-bind`   Claude Code: a private directory per role is bound over each of
 *                  its native directories (copy-inventory.ts, authority mask).
 *  - `in-process`  an API client that writes nothing natively.
 *  - `config-env`  the CLI names a config/data directory by an environment
 *                  variable; the role's process gets a private directory there.
 *  - `private-home` HOME and the XDG_* variables point at a private home.
 *  - `refused`     cannot be contained; the reason is shown by validate.
 *
 * For `config-env` and `private-home` the private directory is
 * `<orgDir>/runner/<role>/rt-<runtime>`. The credentials a CLI needs are staged
 * into it by SYMLINK to the real file (`authFiles`); nothing under the real
 * `$HOME` is ever written, moved or deleted by this module. A CLI that
 * refreshes a token by writing through the link rewrites that one credential
 * file in place, as it would when the operator used it.
 *
 * Every entry says how it was established. `verified` entries were probed with a
 * temporary HOME, the cheapest model and the CLI's own listing of the files it
 * wrote (tests/eval/org/runtime-probes); `unverified` ones are the generic
 * strategy for a CLI that is not installed on the host that wrote this table,
 * adjusted only where the runner source shows how the CLI finds its files.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { RuntimeKind } from '../daemon.js';

export type IsolationStrategy =
  | 'mask-bind'
  | 'in-process'
  | 'config-env'
  | 'private-home'
  | 'refused';

/** Runners that keep their own session files read this variable (a directory). */
export const RUNNER_DATA_DIR_ENV = 'MONOMIND_RUNNER_DATA_DIR';

export interface RuntimeIsolation {
  strategy: IsolationStrategy;
  /** Files under the real home symlinked into the private directory, when they exist. */
  authFiles: string[];
  /** `config-env`: the variable that names the private directory, and the real-home directory it replaces. */
  configEnv?: string;
  configDir?: string;
  /** Extra variables: name to a path relative to the private directory. */
  pathEnv?: Record<string, string>;
  /** Variables kept pointing into the real home (a private HOME would hide them): name to a path relative to it. */
  pins?: Record<string, string>;
  /** Where native copies land, relative to the private directory (home or config dir). */
  nativeDirs: string[];
  probe?: { command: string; expect: string };
  verified: { date: string; cli: string } | 'unverified';
  /** `refused`: why. `unverified` and others: what to know. */
  note?: string;
}

const GIT_CONFIG = '.gitconfig';
const V = (cli: string): { date: string; cli: string } => ({ date: '2026-10-05', cli });
const PROBE = (command: string, expect: string): { command: string; expect: string } => ({
  command,
  expect,
});

/** The registry: one entry per runtime kind. */
export const RUNTIME_ISOLATION: Record<RuntimeKind, RuntimeIsolation> = {
  claude: {
    strategy: 'mask-bind',
    authFiles: [],
    nativeDirs: ['projects', 'file-history', 'debug'],
    verified: V('claude (R5 hardening probes, real bubblewrap)'),
    note: 'private directories are bound over the config directory entries by the authority mask',
  },
  codex: {
    strategy: 'config-env',
    configEnv: 'CODEX_HOME',
    configDir: '.codex',
    authFiles: ['.codex/auth.json'],
    nativeDirs: [
      'sessions',
      'shell_snapshots',
      'logs_2.sqlite',
      'state_5.sqlite',
      'thread_history_1.sqlite',
      'memories_1.sqlite',
      'queue_1.sqlite',
      'goals_1.sqlite',
      'history.jsonl',
      'cache',
      'plugins',
      'tmp',
    ],
    probe: PROBE(
      'CODEX_HOME=<tmp>/codex codex exec --json --skip-git-repo-check -m gpt-6-luna -s read-only "ok"',
      'every file under CODEX_HOME; nothing else under HOME',
    ),
    verified: V('codex-cli 0.159.3'),
  },
  antigravity: {
    strategy: 'private-home',
    authFiles: [GIT_CONFIG],
    nativeDirs: ['.gemini/antigravity-cli', '.gemini/config/projects'],
    probe: PROBE(
      'HOME=<tmp> agy -p ok --output-format stream-json --model gemini-3.8-flash-low',
      'files under .gemini/antigravity-cli and .gemini/config; nothing else under HOME or the cwd',
    ),
    verified: V('agy 1.2.14'),
    note: 'login lives in the desktop keyring over D-Bus (no credential file): the session bus variable is inherited, so no staging is needed or possible; without it agy reports "authentication failed"',
  },
  opencode: {
    strategy: 'private-home',
    authFiles: ['.config/opencode/opencode.json', '.local/share/opencode/auth.json', GIT_CONFIG],
    nativeDirs: [
      '.local/share/opencode',
      '.local/state/opencode',
      '.cache/opencode',
      '.npm/_cacache',
    ],
    probe: PROBE(
      'HOME=<tmp> XDG_*=<tmp> opencode run -m openrouter/poolside/laguna-s-2.1:free --format json ok',
      'opencode.db (sessions), log, snapshot, state locks, cache under HOME/XDG; opencode/ under TMPDIR',
    ),
    verified: V('opencode 1.18.32'),
    note: 'provider keys come from the environment; an attached server (OPENCODE_URL) is shared by every role and is refused',
  },
  pi: {
    strategy: 'config-env',
    configEnv: 'PI_CODING_AGENT_DIR',
    configDir: '.pi/agent',
    authFiles: ['.pi/agent/auth.json', '.pi/agent/settings.json'],
    nativeDirs: ['sessions', 'models-store.json'],
    probe: PROBE(
      'PI_CODING_AGENT_DIR=<tmp>/pi pi --mode json -p --model openrouter/poolside/laguna-s-2.1:free -- ok',
      'sessions/<cwd>/*.jsonl and models-store.json under the directory; nothing else',
    ),
    verified: V('pi 0.87.1'),
  },
  'pi-rpc': {
    strategy: 'config-env',
    configEnv: 'PI_CODING_AGENT_DIR',
    configDir: '.pi/agent',
    authFiles: ['.pi/agent/auth.json', '.pi/agent/settings.json'],
    nativeDirs: ['sessions', 'models-store.json'],
    probe: PROBE(
      'PI_CODING_AGENT_DIR=<tmp>/pi pi --mode rpc (one prompt command on stdin)',
      'the same files as pi --mode json',
    ),
    verified: V('pi 0.87.1'),
  },
  crush: {
    strategy: 'private-home',
    authFiles: ['.config/crush/crush.json', GIT_CONFIG],
    pathEnv: { [RUNNER_DATA_DIR_ENV]: 'runner-data' },
    nativeDirs: ['runner-data', '.local/share/crush'],
    probe: PROBE(
      'HOME=<tmp> crush --data-dir <tmp>/data run --model openrouter/poolside/laguna-s-2.1:free ok',
      'crush.db and logs under --data-dir, projects.json under XDG_DATA_HOME; without --data-dir they land in <cwd>/.crush, the workspace every role of a section shares',
    ),
    verified: V('crush 0.96.1'),
    note: 'the runner passes --data-dir from MONOMIND_RUNNER_DATA_DIR; there is no environment variable for it',
  },
  // The entries below follow tests/eval/org/runtime-probes (probe.mjs, one JSON per runtime).
  grok: {
    strategy: 'config-env',
    configEnv: 'GROK_HOME',
    configDir: '.grok',
    authFiles: ['.grok/config.toml', '.grok/auth.json'],
    nativeDirs: ['sessions', 'logs', 'bin', 'installed-plugins'],
    probe: PROBE(
      'GROK_HOME=<tmp>/grok grok -p "reply with OK" --output-format json -m poolside/laguna-s-2.1:free',
      '51 files, all under GROK_HOME (sessions/<cwd>/<id>/*.jsonl, session_search.sqlite, logs/unified.jsonl, bin/grok-<ver>); none under HOME or the cwd',
    ),
    verified: V('grok 1.0.41'),
    note: 'the model key comes from the environment; auth.json is staged when the operator logged in. Each private directory holds its own ~160 MB copy of the binary. The leader daemon (--leader-socket, default ~/.grok/leader.sock) is off unless [cli] use_leader is true: keep it off',
  },
  copilot: {
    strategy: 'private-home',
    authFiles: ['.config/gh/hosts.yml', GIT_CONFIG],
    nativeDirs: [
      '.copilot',
      '.cache/copilot',
      '.cache/Microsoft/DeveloperTools',
      '.local/state/gh',
    ],
    probe: PROBE(
      'HOME=<tmp> XDG_*=<tmp> copilot -p "reply with OK" --model auto --auto-tier efficiency -s --no-auto-update',
      '235 files, all under the temp HOME (state, session-state/<id>/events.jsonl, session-store.db, a ~175 MB self-extracted package cache); none under the cwd',
    ),
    verified: V('GitHub Copilot CLI 1.0.89'),
    note: 'COPILOT_HOME alone moves only the state, ~175 MB of cache and device ids would still land in the real home, so the whole home is private; login is the gh CLI file hosts.yml and `gh` must be on PATH; without credentials copilot exits "No authentication information found"',
  },
  hermes: {
    strategy: 'config-env',
    configEnv: 'HERMES_HOME',
    configDir: '.hermes',
    authFiles: ['.hermes/auth.json', '.hermes/.env', '.hermes/config.yaml'],
    nativeDirs: ['state.db', 'logs', 'cache', 'bin', 'SOUL.md'],
    probe: PROBE(
      'HERMES_HOME=<tmp>/hermes hermes chat --query="reply with OK" -Q -m nvidia/nemotron-3-super-120b-a12b:free --provider openrouter',
      '12 files, all under HERMES_HOME (state.db holds the sessions, logs/agent.log, auth.json, cache/, bin/tirith); none under HOME or the cwd',
    ),
    verified: V('Hermes Agent v0.19.0'),
    note: 'a fresh directory downloads the ~38 MB tirith scanner on first use; its prompt file (#599) is in its own per-role holder under <monomind home>/runner-inputs, hidden from the other roles',
  },
  vercel: {
    strategy: 'in-process',
    authFiles: [],
    pathEnv: { [RUNNER_DATA_DIR_ENV]: '.' },
    nativeDirs: ['sessions'],
    verified: 'unverified',
    note: 'API client in the daemon process, no CLI and no HOME lookup; its one native copy is <dir>/sessions/<id>.json, which the runner keeps under MONOMIND_RUNNER_DATA_DIR. Not probed: the ai package and a provider key were not available (runtime-probes/vercel.json)',
  },
  kimicode: {
    strategy: 'config-env',
    configEnv: 'KIMI_CODE_HOME',
    configDir: '.kimi-code',
    authFiles: [],
    nativeDirs: ['sessions'],
    verified: 'unverified',
    note: 'kimi is not installed on the host that wrote this table; the runner reads KIMI_CODE_HOME for the session wire files, so that variable is the directory; credential files unknown; its agent file (#599) is in its own per-role holder under <monomind home>/runner-inputs, hidden from the other roles',
  },
  qwen: {
    strategy: 'private-home',
    authFiles: ['.qwen/oauth_creds.json', '.qwen/settings.json', GIT_CONFIG],
    nativeDirs: ['.qwen'],
    verified: 'unverified',
    note: 'qwen is not installed on the host that wrote this table; generic private home',
  },
  'qwen-rpc': {
    strategy: 'private-home',
    authFiles: ['.qwen/oauth_creds.json', '.qwen/settings.json', GIT_CONFIG],
    nativeDirs: ['.qwen'],
    verified: 'unverified',
    note: 'qwen is not installed on the host that wrote this table; generic private home',
  },
  cline: {
    strategy: 'config-env',
    configEnv: 'CLINE_DIR',
    configDir: '.cline',
    authFiles: [],
    nativeDirs: ['data'],
    verified: 'unverified',
    note: 'cline is not installed on the host that wrote this table; the runner reads CLINE_DIR (its data dir derives from it) for full-access turns, and a scoped turn keeps its state in the role private TMPDIR; its prompt file (#599) is in its own per-role holder under <monomind home>/runner-inputs, hidden from the other roles. Open: whether the detached hub daemon is keyed by the data dir; if two roles share one it must become refused',
  },
  aider: {
    strategy: 'private-home',
    authFiles: [GIT_CONFIG],
    pins: { UV_TOOL_DIR: '.local/share/uv/tools' },
    nativeDirs: ['.aider', '.cache/aider'],
    verified: 'unverified',
    note: 'aider is not installed on the host that wrote this table; the runner keeps conversations under the role private TMPDIR and finds the tool through HOME, which UV_TOOL_DIR keeps pointing at the real home',
  },
  // Kilo runs with explicit full access only (kilo-runner.ts refuses scoped), and a sections org refuses
  // policy.access "full" (documents/definition.ts checkRoles), so no sections role can ever run on it.
  // Probed with a temp HOME anyway (tests/eval/org/runtime-probes/kilo.json): where its copies would land.
  kilo: {
    strategy: 'refused',
    authFiles: [],
    nativeDirs: [],
    verified: 'unverified',
    note: 'Kilo supports full access only and a sections org refuses full access (a full-access role runs with no authority mask), so no role can run on it; its copies (kilo.db, logs, config, cache under HOME/XDG, probed) cannot be kept apart',
  },
  // Not executable: its published CLI has no headless prompt or JSON transport (runner-specs.ts).
  freebuff: {
    strategy: 'refused',
    authFiles: [],
    nativeDirs: [],
    verified: 'unverified',
    note: 'Freebuff has no headless prompt or JSON transport, so no role can run on it; the runner refuses with "unsupported" before any process starts (tests/eval/org/runtime-probes/freebuff.json)',
  },
  dsh: {
    strategy: 'private-home',
    authFiles: [GIT_CONFIG],
    nativeDirs: [],
    verified: 'unverified',
    note: 'dsh is not installed on the host that wrote this table; generic private home (the runner writes its model patch under the host tmpdir, not the role one)',
  },
};

/** An attached opencode server belongs to the operator and every role would share it. */
const OPENCODE_URL_REFUSAL =
  'OPENCODE_URL attaches every role to one shared opencode server, whose sessions no role can be kept apart in; unset it so each role starts its own';

/** The entry of `runtime` on a host with `env`, or undefined for an unknown runtime. */
export function runtimeIsolation(
  runtime: string,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeIsolation | undefined {
  const entry = (RUNTIME_ISOLATION as Record<string, RuntimeIsolation | undefined>)[runtime];
  if (!entry) return undefined;
  if (runtime === 'opencode' && env.OPENCODE_URL)
    return { ...entry, strategy: 'refused', note: OPENCODE_URL_REFUSAL };
  return entry;
}

/** Whether the role's process gets a private directory of its own (an in-process runner only when it keeps session files there). */
export const usesPrivateDir = (iso: RuntimeIsolation | undefined): boolean =>
  iso?.strategy === 'config-env' ||
  iso?.strategy === 'private-home' ||
  (iso?.strategy === 'in-process' && !!iso.pathEnv);

/** The environment that points a runner process at its private directory `dir`. */
export function isolationEnv(
  iso: RuntimeIsolation | undefined,
  dir: string,
  realHome: string,
): Record<string, string> {
  if (!iso || !usesPrivateDir(iso)) return {};
  const out: Record<string, string> = {};
  if (iso.strategy === 'config-env' && iso.configEnv) out[iso.configEnv] = dir;
  if (iso.strategy === 'private-home') {
    out.HOME = dir;
    out.XDG_CONFIG_HOME = join(dir, '.config');
    out.XDG_DATA_HOME = join(dir, '.local', 'share');
    out.XDG_STATE_HOME = join(dir, '.local', 'state');
    out.XDG_CACHE_HOME = join(dir, '.cache');
    for (const [name, rel] of Object.entries(iso.pins ?? {})) out[name] = join(realHome, rel);
  }
  for (const [name, rel] of Object.entries(iso.pathEnv ?? {})) out[name] = join(dir, rel);
  return out;
}

/** Where a staged real-home file lands inside the private directory. */
function stagedPath(iso: RuntimeIsolation, dir: string, authFile: string): string {
  return iso.strategy === 'config-env' && iso.configDir
    ? join(dir, relative(iso.configDir, authFile))
    : join(dir, authFile);
}

/**
 * Creates the private directory (0700) and symlinks each existing auth file of the
 * real home into it. Reads the real home only; an existing entry in the private
 * directory is replaced only when it is a symlink that points elsewhere. Returns the
 * links in place.
 */
export function stageAuthFiles(
  iso: RuntimeIsolation | undefined,
  dir: string,
  realHome: string,
): string[] {
  if (!iso || !usesPrivateDir(iso)) return [];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (iso.strategy === 'private-home')
    for (const sub of ['.config', '.local/share', '.local/state', '.cache'])
      mkdirSync(join(dir, sub), { recursive: true });
  const staged: string[] = [];
  for (const file of iso.authFiles) {
    const target = join(realHome, file);
    if (!existsSync(target)) continue;
    const link = stagedPath(iso, dir, file);
    mkdirSync(dirname(link), { recursive: true });
    if (!linkIsCurrent(link, target)) {
      try {
        if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
        else continue; // a real file of the role's own: never replaced
      } catch {
        /* nothing there yet */
      }
      symlinkSync(target, link);
    }
    staged.push(link);
  }
  return staged;
}

function linkIsCurrent(link: string, target: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && readlinkSync(link) === target;
  } catch {
    return false;
  }
}
