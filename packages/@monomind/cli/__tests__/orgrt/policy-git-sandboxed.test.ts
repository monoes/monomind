// packages/@monomind/cli/__tests__/orgrt/policy-git-sandboxed.test.ts
/**
 * checkGitPolicy fails closed on commands it can't read (`node $X`,
 * `python3 $F`, `$BIN …`, `env -i …`, eval) because, without an OS sandbox,
 * such a command could run git at any level. When the role's Bash actually
 * runs inside the SDK sandbox, the sandbox enforces the level where git runs
 * (role-sandbox.ts), so those are allowed — but every git call written out
 * literally is still checked, and a visible git call whose subcommand is
 * hidden (`sh -c "git …"`, `git $SUB`, an alias, a guard override) still
 * fails closed. The flag comes from the session's runtime sandbox decision,
 * never from config alone.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { checkGitPolicy } from '../../src/orgrt/policy-git.js';
import { sandboxAvailability } from '../../src/orgrt/role-sandbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sandboxed = { osSandboxed: true };

const OPAQUE = [
  'node $X',
  'python3 $F --check',
  '$BIN --help',
  'env -i PATH=/usr/bin node test.js',
  'eval "$CMD"',
  'GIT_CONFIG_COUNT=0 node build.js',
];

describe('checkGitPolicy with the OS sandbox active', () => {
  it.each(OPAQUE)('allows %s at read (the sandbox enforces the level)', (cmd) => {
    expect(checkGitPolicy(cmd, 'read', sandboxed)).toBeNull();
  });

  it.each(OPAQUE)('still denies %s at read without the sandbox', (cmd) => {
    expect(checkGitPolicy(cmd, 'read')).toMatch(/cannot verify git usage/);
    expect(checkGitPolicy(cmd, 'read', { osSandboxed: false })).toMatch(/cannot verify git usage/);
  });

  it('keeps the literal git-subcommand checks per level', () => {
    expect(checkGitPolicy('git commit -m x', 'read', sandboxed)).toMatch(/git commit denied/);
    expect(checkGitPolicy('git push origin main', 'commit', sandboxed)).toMatch(/git push denied/);
    expect(checkGitPolicy('git stash pop', 'commit', sandboxed)).toMatch(/git stash denied/);
    expect(checkGitPolicy('git config user.name x', 'commit', sandboxed)).toMatch(/config write denied/);
    expect(checkGitPolicy('git status', 'none', sandboxed)).toMatch(/not allowed/);
    expect(checkGitPolicy('git status && git log -1', 'read', sandboxed)).toBeNull();
    expect(checkGitPolicy('git commit -m x', 'commit', sandboxed)).toBeNull();
  });

  it('keeps classifying literal git calls after an unreadable part of the same command', () => {
    expect(checkGitPolicy('node $X && git commit -m x', 'read', sandboxed)).toMatch(/git commit denied/);
    expect(checkGitPolicy('env -i git push', 'commit', sandboxed)).toMatch(/git push denied/);
    expect(checkGitPolicy('$BIN; git stash', 'commit', sandboxed)).toMatch(/git stash denied/);
  });

  it.each([
    ['sh -c "git push"', 'commit'],
    ['bash -c "git stash pop"', 'commit'],
    ['git $SUB', 'read'],
    ['git -c alias.p=push p', 'commit'],
    ['git -c core.hooksPath=/dev/null commit -m x', 'commit'],
  ] as const)('still fails closed on a visible git call with a hidden subcommand: %s', (cmd, level) => {
    expect(checkGitPolicy(cmd, level, sandboxed)).toMatch(/cannot verify git usage/);
  });
});

describe('PolicyEngine.setOsSandboxed', () => {
  const engine = () => {
    const bus = new OrgBus('o', 'r', tmp('pgs-bus-'));
    return new PolicyEngine('qa', { git: 'read' } as any, bus, tmp('pgs-cwd-'));
  };

  it('unsandboxed read role: `node $X` is denied (default)', async () => {
    expect((await engine().decide('Bash', { command: 'node $X' })).behavior).toBe('deny');
  });

  it('sandboxed read role: `node $X` allowed, `git commit` denied', async () => {
    const p = engine();
    p.setOsSandboxed(true);
    expect((await p.decide('Bash', { command: 'node $X' })).behavior).toBe('allow');
    expect((await p.decide('Bash', { command: 'git commit -m x' })).behavior).toBe('deny');
    p.setOsSandboxed(false);
    expect((await p.decide('Bash', { command: 'node $X' })).behavior).toBe('deny');
  });
});

describe('session wiring: the flag follows the runtime sandbox decision', () => {
  const run = async (policy: Record<string, unknown>, claude = true, wasSandboxed = false) => {
    const base = tmp('pgs-');
    const repo = join(base, 'repo');
    spawnSync('git', ['init', '-q', repo]);
    const bus = new OrgBus('o', 'r', tmp('pgs-bus-'));
    const engine = new PolicyEngine('qa', policy as any, bus, repo);
    // A previous session of the same role (the daemon keeps one engine per role) was sandboxed.
    engine.setOsSandboxed(wasSandboxed);
    const mailbox = new Mailbox();
    mailbox.push('go');
    mailbox.close();
    let sdkSandbox: unknown;
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        sdkSandbox = options.sandbox;
        for await (const _ of prompt) break;
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    const runner = {
      async *run(args: any) {
        for await (const _ of args.prompt) break;
        yield { type: 'result' as const, subtype: 'success', input_tokens: 1, output_tokens: 1 };
      },
    };
    await runAgentSession({
      org: 'o',
      role: { id: 'qa', title: 'QA', type: 'specialist', reports_to: 'boss', responsibilities: [], policy } as any,
      bus,
      policy: engine,
      mailbox,
      cwd: repo,
      orgRoot: base,
      orgDir: join(base, '.monomind', 'orgs', 'o'),
      deliver: async () => 'delivered',
      ...(claude ? { queryFn: queryFn as any } : { runner }),
    });
    return { opaqueDecision: (await engine.decide('Bash', { command: 'node $X' })).behavior, sdkSandbox };
  };

  it.skipIf(!sandboxAvailability().available)(
    'a claude read role whose session got the SDK sandbox: `node $X` allowed',
    async () => {
      const r = await run({ git: 'read' });
      expect(r.sdkSandbox).toBeDefined();
      expect(r.opaqueDecision).toBe('allow');
    },
  );

  it('each session resets the flag: a restart without the sandbox denies `node $X` again', async () => {
    const r = await run({ git: 'read', sandbox: { mode: 'off' } }, true, true);
    expect(r.sdkSandbox).toBeUndefined();
    expect(r.opaqueDecision).toBe('deny');
  });

  it("'auto' with the sandbox unavailable at runtime (falls open): `node $X` still denied", async () => {
    // A PATH with git but without bwrap/socat: sandboxAvailability() reports unavailable.
    const bin = tmp('pgs-bin-');
    const git = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(git, join(bin, 'git'));
    const PATH = process.env.PATH;
    process.env.PATH = bin;
    try {
      const r = await run({ git: 'read' }, true, true);
      expect(r.sdkSandbox).toBeUndefined();
      expect(r.opaqueDecision).toBe('deny');
    } finally {
      process.env.PATH = PATH;
    }
  });

  it("policy.sandbox.mode 'off': no sandbox, `node $X` still denied", async () => {
    const r = await run({ git: 'read', sandbox: { mode: 'off' } });
    expect(r.sdkSandbox).toBeUndefined();
    expect(r.opaqueDecision).toBe('deny');
  });

  it('a non-Claude runtime: `node $X` still denied', async () => {
    expect((await run({ git: 'read' }, false)).opaqueDecision).toBe('deny');
  });
});
