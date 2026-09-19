// packages/@monomind/cli/__tests__/orgrt/role-sandbox.test.ts
/**
 * #258: for claude-runtime roles below policy.git 'push', the Claude Agent
 * SDK's OS sandbox (bubblewrap on Linux, seatbelt on macOS) confines the Bash
 * tool — writes to the protected .git and local-path remotes,
 * reads of credential files. These tests cover the options per level, the
 * availability probe, the fail-open ('auto') / fail-closed ('required')
 * decision and its audit trail, and the wiring through session.ts and
 * ClaudeAgentRunner (mock queryFn — no real SDK).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import {
  buildClaudeRestrictions,
  gitEnforcementFindings,
  resolveRoleGitEnforcement,
  sandboxAvailability,
} from '../../src/orgrt/role-sandbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import type { BusEvent } from '../../src/orgrt/types.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** A repo whose origin is a GitHub URL and whose backup remote is a local path. */
function scratchRepo() {
  const base = tmp('role-sandbox-');
  const repo = join(base, 'repo');
  git(base, 'init', '-q', repo);
  git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/app.git');
  git(repo, 'remote', 'add', 'backup', '../backup.git');
  mkdirSync(join(base, 'backup.git'));
  return { base, repo, gitDir: gitCommonDir(repo)! };
}

const binDir = (names: string[]) => {
  const dir = tmp('bin-');
  for (const n of names) {
    writeFileSync(join(dir, n), '#!/bin/sh\n');
    chmodSync(join(dir, n), 0o755);
  }
  return dir;
};

describe('sandboxAvailability', () => {
  it('is available on Linux when bwrap and socat are on PATH', () => {
    const PATH = binDir(['bwrap', 'socat']);
    expect(sandboxAvailability({ PATH }, 'linux')).toEqual({ available: true });
  });

  it('names the missing Linux dependency', () => {
    const PATH = binDir(['socat']);
    const a = sandboxAvailability({ PATH }, 'linux');
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/bwrap/);
  });

  it('is unavailable on platforms the SDK sandbox does not support here', () => {
    expect(sandboxAvailability({ PATH: '' }, 'win32').available).toBe(false);
  });
});

describe('buildClaudeRestrictions', () => {
  /** A home with an ssh dir and a gh login but no ~/.gitconfig or ~/.netrc. */
  const fakeHome = () => {
    const home = tmp('home-');
    mkdirSync(join(home, '.ssh'));
    mkdirSync(join(home, '.config', 'gh'), { recursive: true });
    return home;
  };
  let home = '';
  const ctx = (repo: string, base: string) => {
    home = fakeHome();
    return { cwd: repo, orgRoot: base, home, tmp: '/tmp' };
  };

  it("read: sandbox enabled fail-closed, Bash still gated by canUseTool, .git and the guard dir unwritable", () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const r = buildClaudeRestrictions(guard, undefined, ctx(repo, base), true);
    const sb = r.sandbox as any;
    expect(sb).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
    });
    expect(sb.filesystem.denyWrite).toEqual(expect.arrayContaining([gitDir, guard.dir, join(base, 'backup.git')]));
    expect(sb.filesystem.allowWrite).toEqual(expect.arrayContaining([repo, base, home, '/tmp']));
    expect(sb.network).toMatchObject({ allowedDomains: ['*'], strictAllowlist: true, allowLocalBinding: true });
    // git remote hosts stay reachable (fetch/ls-remote/clone); withheld credentials stop pushes
    expect(sb.network.deniedDomains).toEqual([]);
    expect(sb.credentials.files).toEqual([
      { path: join(home, '.ssh'), mode: 'deny' },
      { path: join(home, '.config/gh'), mode: 'deny' },
    ]);
    expect(r.disallowedTools).toEqual(expect.arrayContaining([`Edit(/${gitDir}/**)`, `Edit(/${guard.dir}/**)`]));
  });

  it('never denies a path that does not exist (the sandbox would make a missing ~/.gitconfig fatal to git)', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const sb = buildClaudeRestrictions(guard, undefined, ctx(repo, base), true).sandbox as any;
    const denied = [...sb.filesystem.denyWrite, ...sb.credentials.files.map((f: any) => f.path)];
    expect(denied).not.toContain(join(home, '.gitconfig'));
    expect(denied).not.toContain(join(home, '.netrc'));
    expect(sb.filesystem.denyWrite).toContain(join(home, '.ssh'));
  });

  it('allows unix sockets (Chrome needs one) but masks agent sockets that would hand out credentials', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const agentDir = join(base, 'ssh-fake');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'agent.1'), '');
    const c = ctx(repo, base);
    const sb = buildClaudeRestrictions(guard, undefined, {
      ...c,
      tmp: base,
      env: { SSH_AUTH_SOCK: join(agentDir, 'agent.1') },
    }, true).sandbox as any;
    expect(sb.network.allowAllUnixSockets).toBe(true);
    expect(sb.filesystem.denyRead).toEqual(expect.arrayContaining([join(agentDir, 'agent.1'), agentDir]));
  });

  // Regression: /run/containerd is drwx--x--x on a stock docker host. bwrap
  // cannot bind over a file in a directory it cannot list ("Can't mkdir parents
  // for /run/containerd/containerd.sock: Permission denied"), so masking the
  // socket itself made every Bash call in every sandboxed role fail.
  it('masks the whole directory when a socket sits in a directory the user cannot list', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const locked = join(base, 'locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'agent.sock'), '');
    chmodSync(locked, 0o311);
    try {
      const sb = buildClaudeRestrictions(guard, undefined, {
        ...ctx(repo, base),
        env: { SSH_AUTH_SOCK: join(locked, 'agent.sock') },
      }, true).sandbox as any;
      expect(sb.filesystem.denyRead).toContain(locked);
      expect(sb.filesystem.denyRead).not.toContain(join(locked, 'agent.sock'));
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  // Regression: with unix sockets reachable, the session D-Bus in the runtime
  // dir reaches the login keyring, and `gh auth token` handed a sandboxed role
  // the operator's GitHub token (verified against the real sandbox — a
  // --dry-run push to the real repo then succeeded). The SDK's own default deny
  // of /run/user does not survive passing our own filesystem block.
  it('denies the XDG runtime dir, where the session bus and the keyring live', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const runtime = join(base, 'run-user');
    mkdirSync(runtime);
    for (const cfg of [undefined, { allowUnixSockets: false }]) {
      const sb = buildClaudeRestrictions(guard, cfg, { ...ctx(repo, base), env: { XDG_RUNTIME_DIR: runtime } }, true)
        .sandbox as any;
      expect(sb.filesystem.denyRead).toContain(runtime);
    }
  });

  it('can block every unix socket on request, and then masks no agent socket', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const agent = join(base, 'ssh-fake');
    mkdirSync(agent);
    const sb = buildClaudeRestrictions(guard, { allowUnixSockets: false }, { ...ctx(repo, base), tmp: base }, true)
      .sandbox as any;
    expect(sb.network.allowAllUnixSockets).toBe(false);
    expect(sb.filesystem.denyRead).not.toContain(agent);
  });

  it('commit: the repo stays writable (commits work) except its config and hooks', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'commit', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const r = buildClaudeRestrictions(guard, undefined, ctx(repo, base), true);
    const fs = (r.sandbox as any).filesystem;
    expect(fs.denyWrite).not.toContain(gitDir);
    expect(fs.denyWrite).toEqual(expect.arrayContaining([join(gitDir, 'config'), join(gitDir, 'hooks')]));
    expect(r.disallowedTools).toEqual(expect.arrayContaining([`Edit(/${join(gitDir, 'config')})`]));
    expect(r.disallowedTools).not.toContain(`Edit(/${gitDir}/**)`);
  });

  it('none: the repository is unreadable to sandboxed commands too', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'none', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const r = buildClaudeRestrictions(guard, undefined, ctx(repo, base), true);
    expect((r.sandbox as any).filesystem.denyRead).toContain(gitDir);
    expect(r.disallowedTools).toContain(`Read(/${gitDir}/**)`);
  });

  it('takes the network allowlist, extra denies and extra writable paths from policy.sandbox', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'commit', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const r = buildClaudeRestrictions(
      guard,
      { allowedDomains: ['registry.npmjs.org'], deniedDomains: ['gitlab.example.com'], allowWrite: ['/srv/cache'] },
      ctx(repo, base),
      true,
    );
    const sb = r.sandbox as any;
    expect(sb.network.allowedDomains).toEqual(['registry.npmjs.org']);
    expect(sb.network.deniedDomains).toEqual(['gitlab.example.com']);
    expect(sb.filesystem.allowWrite).toContain('/srv/cache');
  });

  it('keeps the file-tool deny rules when the sandbox itself cannot be used', () => {
    const { base, repo, gitDir } = scratchRepo();
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [gitDir] })!;
    const r = buildClaudeRestrictions(guard, undefined, ctx(repo, base), false);
    expect(r.sandbox).toBeUndefined();
    expect(r.disallowedTools).toContain(`Edit(/${gitDir}/**)`);
  });
});

describe('ClaudeAgentRunner sandbox pass-through', () => {
  const run = async (claudeRestrictions?: unknown) => {
    let options: any;
    const runner = new ClaudeAgentRunner(((a: any) => {
      options = a.options;
      return (async function* () {})();
    }) as any);
    for await (const _ of runner.run({
      tools: [],
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 1,
      claudeRestrictions,
    } as any));
    return options;
  };

  it('passes sandbox settings and disallowedTools to query()', async () => {
    const sandbox = { enabled: true, failIfUnavailable: true };
    const options = await run({ sandbox, disallowedTools: ['Edit(//repo/.git/**)'] });
    expect(options.sandbox).toBe(sandbox);
    expect(options.disallowedTools).toEqual(['Edit(//repo/.git/**)']);
  });

  it('passes neither when the role has no restrictions (push level)', async () => {
    const options = await run(undefined);
    expect('sandbox' in options).toBe(false);
    expect('disallowedTools' in options).toBe(false);
  });
});

describe('resolveRoleGitEnforcement', () => {
  // #298: this test process is itself an org role below policy.git 'push', so
  // process.env already carries the OUTER git guard's own GIT_CONFIG_COUNT +
  // GIT_CONFIG_KEY_n/VALUE_n (git-guard.ts). prepareGitGuard defaults to
  // reading process.env, and resolveRoleGitEnforcement's `build()` closure
  // doesn't forward its own injectable `env` arg down to it — so "installs the
  // placeholder excludes only when the sandbox actually runs" could see a
  // stray core.excludesFile that isn't the one this test built. Strip the
  // ambient guard for each test in this describe only — other describes below
  // (e.g. "session wiring") intentionally compare against live process.env and
  // must not be touched. A checked-in test sanitising its own process.env is
  // not an env-guard bypass: policy-git.ts's ENV_SETTERS rule governs shell
  // commands a role WRITES.
  //
  // Built as an ALLOWLIST from scratch, not by inheriting process.env and
  // subtracting known GIT_CONFIG_* keys: a subtraction is a deny-list over a
  // set GIT defines, and it fails open the same way #299's original reflog
  // deny-list did. It would miss GIT_CONFIG_GLOBAL/SYSTEM/NOSYSTEM (`man
  // git`, git 2.55.0, §ENVIRONMENT), GIT_CONFIG_COUNT/KEY_n/VALUE_n — the
  // guard's own mechanism — (`man git-config`, §ENVIRONMENT, NOT `man git`),
  // and GIT_CONFIG_PARAMETERS: git's internal channel for propagating `-c`
  // overrides to subprocesses, honoured but undocumented in EITHER man page
  // — precisely why a deny-list can't be trusted here: you cannot enumerate
  // what the manual doesn't list. HOME points at an empty scratch dir so no
  // ambient ~/.gitconfig leaks in either — `scratchRepo()` in this
  // describe's tests spawns real `git init`/`git remote add` calls that
  // inherit this same allowlisted env.
  let originalEnv: NodeJS.ProcessEnv;
  let hermeticHome: string;
  beforeEach(() => {
    originalEnv = { ...process.env };
    hermeticHome = mkdtempSync(join(tmpdir(), 'git-hermetic-home-'));
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, {
      PATH: originalEnv.PATH,
      HOME: hermeticHome,
      // Spread, not a plain key: assigning an absent TMPDIR writes the STRING
      // "undefined" into the env (process.env coerces every value), and
      // os.tmpdir() then hands back "undefined" — every mkdtempSync below
      // fails with ENOENT. Only reachable where TMPDIR is unset, which is the
      // default on CI, so this passed locally and would have broken there.
      ...(originalEnv.TMPDIR ? { TMPDIR: originalEnv.TMPDIR } : {}),
    });
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, originalEnv);
    rmSync(hermeticHome, { recursive: true, force: true });
  });

  const setup = (policy: Record<string, unknown> = {}) => {
    const { base, repo } = scratchRepo();
    const bus = new OrgBus('o', 'r', tmp('bus-'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const role = { id: 'qa', policy } as any;
    const opts = { org: 'o', role, cwd: repo, orgRoot: base, orgDir: join(base, 'org'), bus };
    return { opts, events };
  };
  const available = { available: true };
  const missing = { available: false, reason: 'bubblewrap (bwrap) not found on PATH' };

  it("push: no guard env, no restrictions, no audit", () => {
    const { opts, events } = setup({ git: 'push' });
    const r = resolveRoleGitEnforcement({ ...opts, claudeRuntime: true, availability: available });
    expect(r).toEqual({ env: {} });
    expect(events).toHaveLength(0);
  });

  it('default level (read) on claude with the sandbox available: guard env + sandbox, no audit', () => {
    const { opts, events } = setup();
    const r = resolveRoleGitEnforcement({ ...opts, claudeRuntime: true, availability: available });
    expect(r.env.MONOMIND_GIT_LEVEL).toBe('read');
    expect((r.claudeRestrictions?.sandbox as any)?.enabled).toBe(true);
    // node's fetch() ignores the sandbox's HTTP proxy without this (an
    // operator value wins, including one inherited from an outer sandbox)
    expect({ ...process.env, ...r.env }.NODE_USE_ENV_PROXY).toBe('1');
    expect(events.filter((e) => e.type === 'audit')).toHaveLength(0);
  });

  it('does not touch the proxy env when the sandbox is not in use', () => {
    const { opts } = setup({ sandbox: { mode: 'off' } });
    const r = resolveRoleGitEnforcement({ ...opts, claudeRuntime: true, availability: available });
    expect(r.env.NODE_USE_ENV_PROXY).toBeUndefined();
  });

  it("'auto' (default) with the sandbox unavailable: runs unsandboxed but says so on the bus", () => {
    const { opts, events } = setup({ git: 'commit' });
    const r = resolveRoleGitEnforcement({ ...opts, claudeRuntime: true, availability: missing });
    expect(r.claudeRestrictions?.sandbox).toBeUndefined();
    expect(r.claudeRestrictions?.disallowedTools?.length).toBeGreaterThan(0);
    const audit = events.find((e) => e.type === 'audit');
    expect(audit).toMatchObject({ from: 'qa', reason: 'git-sandbox-unavailable' });
    expect(audit?.msg).toMatch(/bwrap/);
  });

  it("'required' with the sandbox unavailable: refuses to start the session (fail closed)", () => {
    const { opts, events } = setup({ git: 'read', sandbox: { mode: 'required' } });
    expect(() => resolveRoleGitEnforcement({ ...opts, claudeRuntime: true, availability: missing })).toThrow(
      /sandbox/,
    );
    expect(events.find((e) => e.type === 'audit')).toMatchObject({ reason: 'git-sandbox-required' });
  });

  it('installs the placeholder excludes only when the sandbox actually runs', () => {
    const withSandbox = setup();
    const on = resolveRoleGitEnforcement({ ...withSandbox.opts, claudeRuntime: true, availability: available });
    const keys = Object.entries(on.env)
      .filter(([k]) => k.startsWith('GIT_CONFIG_KEY_'))
      .map(([, v]) => v);
    expect(keys).toContain('core.excludesFile');

    const withoutSandbox = setup();
    const off = resolveRoleGitEnforcement({ ...withoutSandbox.opts, claudeRuntime: true, availability: missing });
    const offKeys = Object.entries(off.env)
      .filter(([k]) => k.startsWith('GIT_CONFIG_KEY_'))
      .map(([, v]) => v);
    expect(offKeys).not.toContain('core.excludesFile');
  });

  it("'off' disables the sandbox and records the opt-out", () => {
    const { opts, events } = setup({ sandbox: { mode: 'off' } });
    const r = resolveRoleGitEnforcement({ ...opts, claudeRuntime: true, availability: available });
    expect(r.claudeRestrictions?.sandbox).toBeUndefined();
    expect(events.find((e) => e.type === 'audit')).toMatchObject({ reason: 'git-sandbox-off' });
  });

  it('non-claude runtimes get the git guard env only, and the gap is audited once per bus', () => {
    const { opts, events } = setup();
    const r1 = resolveRoleGitEnforcement({ ...opts, claudeRuntime: false, availability: available });
    resolveRoleGitEnforcement({ ...opts, claudeRuntime: false, availability: available });
    expect(r1.claudeRestrictions).toBeUndefined();
    expect(r1.env.GIT_CONFIG_COUNT).toBeDefined();
    expect(events.filter((e) => e.reason === 'git-sandbox-unsupported-runtime')).toHaveLength(1);
  });

  // #263: codex/grok run their own sandbox at the role's level, so the "this
  // runtime has nothing" event would be a lie for them.
  it.each([
    ['codex', 'workspace-write'],
    ['grok', 'workspace'],
  ])('audits git-sandbox-cli (not unsupported-runtime) for %s', (runtime, mode) => {
    const { opts, events } = setup();
    resolveRoleGitEnforcement({ ...opts, claudeRuntime: false, runtime, availability: available });
    expect(events.filter((e) => e.reason === 'git-sandbox-unsupported-runtime')).toHaveLength(0);
    const audit = events.find((e) => e.reason === 'git-sandbox-cli');
    expect(audit).toBeDefined();
    expect(String((audit as any).msg)).toContain(`'${mode}'`);
  });

  // #262: only the ephemeral server the opencode runner spawns itself can be
  // given the guard env. An attached one (OPENCODE_URL) is the operator's own
  // process — the role then has no enforcement at all, which must be audited.
  it('audits git-guard-unapplied for an opencode role attached to an external server', () => {
    const { opts, events } = setup();
    resolveRoleGitEnforcement({
      ...opts,
      claudeRuntime: false,
      runtime: 'opencode',
      env: { OPENCODE_URL: 'http://127.0.0.1:4096' },
      availability: available,
    });
    expect(events.filter((e) => e.reason === 'git-guard-unapplied')).toHaveLength(1);
  });

  it('does not audit git-guard-unapplied for an opencode role that spawns its own server', () => {
    const { opts, events } = setup();
    resolveRoleGitEnforcement({
      ...opts,
      claudeRuntime: false,
      runtime: 'opencode',
      env: {},
      availability: available,
    });
    expect(events.filter((e) => e.reason === 'git-guard-unapplied')).toHaveLength(0);
  });
});

describe('session wiring', () => {
  const role = (policy?: Record<string, unknown>) =>
    ({ id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [], policy }) as any;

  const capture = async (policy?: Record<string, unknown>, useQueryFn = false) => {
    const { base, repo } = scratchRepo();
    const bus = new OrgBus('o', 'r', tmp('bus-'));
    const mailbox = new Mailbox();
    mailbox.push('go');
    mailbox.close();
    let seen: any = {};
    const common = {
      org: 'o',
      role: role(policy),
      bus,
      policy: new PolicyEngine('coder', policy ?? {}, bus, repo),
      mailbox,
      cwd: repo,
      orgRoot: base,
      orgDir: join(base, '.monomind', 'orgs', 'o'),
      deliver: async () => 'delivered',
    };
    if (useQueryFn) {
      const queryFn = ({ prompt, options }: any) =>
        (async function* () {
          seen = options;
          for await (const _ of prompt) break;
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        })();
      await runAgentSession({ ...common, queryFn: queryFn as any });
    } else {
      const runner = {
        async *run(args: any) {
          seen = args;
          for await (const _ of args.prompt) break;
          yield { type: 'result' as const, subtype: 'success', input_tokens: 1, output_tokens: 1 };
        },
      };
      await runAgentSession({ ...common, runner });
    }
    return seen;
  };

  it('every runtime gets the git guard env for a default (read) role', async () => {
    const args = await capture();
    expect(args.env.MONOMIND_GIT_LEVEL).toBe('read');
    expect(args.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(args.env.MONOMIND_ORG_ROLE).toBe('coder');
    expect(args.claudeRestrictions).toBeUndefined();
  });

  it('a push role gets no guard env', async () => {
    const args = await capture({ git: 'push' });
    // session.ts hands the runner process.env plus its own overrides, so assert
    // that it adds nothing rather than that the vars are absent (they may be
    // inherited when the test itself runs inside a sandboxed role).
    expect(args.env.MONOMIND_GIT_LEVEL).toBe(process.env.MONOMIND_GIT_LEVEL);
    expect(args.env.GIT_CONFIG_COUNT).toBe(process.env.GIT_CONFIG_COUNT);
  });

  it('the Claude runner receives the file-tool deny rules (and the sandbox when available)', async () => {
    const options = await capture({ git: 'read' }, true);
    expect(options.env.MONOMIND_GIT_LEVEL).toBe('read');
    expect(options.disallowedTools?.some((t: string) => t.startsWith('Edit('))).toBe(true);
    if (sandboxAvailability().available) expect(options.sandbox?.enabled).toBe(true);
  });
});

describe('gitEnforcementFindings (org validate)', () => {
  const def = (roles: any[], runtime?: string) => ({ name: 'o', runtime, roles }) as any;

  it('warns that runtimes without any OS sandbox have none, and skips push roles', () => {
    const f = gitEnforcementFindings(def([{ id: 'a', runtime: 'qwen' }, { id: 'b', policy: { git: 'push' } }]), {
      available: true,
    });
    expect(f.errors).toHaveLength(0);
    expect(f.warnings.join('\n')).toMatch(/no OS sandbox on these runtimes[^\n]*a \(qwen\)/);
    expect(f.warnings.join('\n')).not.toMatch(/\bb\b/);
  });

  // #263: codex and grok now run their own sandbox at the role's level — they
  // must no longer be reported as having nothing.
  it("reports CLI-sandboxed runtimes separately from the ones that still have nothing", () => {
    const f = gitEnforcementFindings(
      def([
        { id: 'a', runtime: 'codex' },
        { id: 'g', runtime: 'grok' },
        { id: 'c', runtime: 'copilot' },
      ]),
      { available: true },
    );
    const text = f.warnings.join('\n');
    expect(text).toMatch(/CLI's own sandbox[^\n]*a \(codex: workspace-write\)/);
    expect(text).toMatch(/CLI's own sandbox[^\n]*g \(grok: workspace\)/);
    expect(text).toMatch(/no OS sandbox on these runtimes[^\n]*c \(copilot\)/);
    expect(text).not.toMatch(/no OS sandbox on these runtimes[^\n]*codex/);
  });

  it("warns when claude roles would run unsandboxed, and errors for mode 'required'", () => {
    const missing = { available: false, reason: 'bubblewrap (bwrap) not found on PATH' };
    const f = gitEnforcementFindings(
      def([{ id: 'dev', policy: { git: 'commit' } }, { id: 'qa', policy: { sandbox: { mode: 'required' } } }]),
      missing,
    );
    expect(f.warnings.join('\n')).toMatch(/dev/);
    expect(f.errors.join('\n')).toMatch(/qa/);
  });

  it('skips endpoint roles and says nothing when every agent role is sandboxed or push', () => {
    const f = gitEnforcementFindings(def([{ id: 'hook', kind: 'endpoint' }, { id: 'dev' }]), { available: true });
    expect(f).toEqual({ warnings: [], errors: [] });
  });
});
