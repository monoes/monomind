/**
 * #559: ~/.monomind/deps is read-only inside an org role (#527), so a role
 * cannot do the first-use install of the Claude Agent SDK that
 * `agent exec --runtime claude` needs. The org runtime host, which runs
 * outside the sandbox, installs it before it spawns a role; inside a role a
 * missing SDK fails at once with the operator command that installs it.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { depsCommand } from '../../src/commands/deps.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { effectiveRoleRuntime } from '../../src/orgrt/runner-resolve.js';
import {
  ensureRoleDeps,
  newRoleDepsState,
  ROLE_DEPS_RETRY_MS,
  type RoleDepsProbe,
  waitRoleDeps,
} from '../../src/orgrt/role-deps.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import type { CommandContext } from '../../src/types.js';
import {
  dependencyDir,
  depsRoot,
  ensureOptionalDependency,
  manualInstallCommand,
  OptionalDependencyError,
  optionalDependencyPresent,
} from '../../src/utils/optional-deps.js';
import {
  FAKE_PINS,
  fakeNpm,
  HOST,
  notFound,
  SDK,
  writeFakeSdk,
} from '../../src/__tests__/fixtures/optional-deps-fixture.js';

const loadClaudeSdk = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({})));
vi.mock('../../src/orgrt/claude-sdk.js', async (orig) => ({
  ...(await orig<typeof import('../../src/orgrt/claude-sdk.js')>()),
  loadClaudeSdk,
}));

function probe(over: Partial<RoleDepsProbe> = {}): RoleDepsProbe & { installs: number } {
  const p = {
    env: {} as NodeJS.ProcessEnv,
    sdkPresent: () => false,
    installs: 0,
    install: async () => {
      p.installs++;
    },
    ...over,
  };
  return p;
}

describe('ensureRoleDeps (host side)', () => {
  it('installs the SDK for a claude-runtime role when it is missing', async () => {
    const p = probe();
    expect(await ensureRoleDeps('claude', p, newRoleDepsState())).toEqual({ status: 'installed' });
    expect(p.installs).toBe(1);
  });

  it('does not download the SDK for a role that runs another runtime', async () => {
    const p = probe();
    expect(await ensureRoleDeps('codex', p, newRoleDepsState())).toEqual({ status: 'not-needed' });
    expect(p.installs).toBe(0);
  });

  it('installs nothing when MONOMIND_NO_AUTO_INSTALL is set (offline hosts)', async () => {
    const p = probe({ env: { MONOMIND_NO_AUTO_INSTALL: '1' } });
    expect(await ensureRoleDeps('claude', p, newRoleDepsState())).toEqual({ status: 'disabled' });
    expect(p.installs).toBe(0);
  });

  it('does nothing when the SDK is already present', async () => {
    const p = probe({ sdkPresent: () => true });
    expect(await ensureRoleDeps('claude', p, newRoleDepsState())).toEqual({ status: 'present' });
    expect(p.installs).toBe(0);
  });

  it('never installs from inside a role, where the deps dir is read-only', async () => {
    const p = probe({ env: { MONOMIND_ORG_ROLE: 'builder' } });
    expect(await ensureRoleDeps('claude', p, newRoleDepsState())).toEqual({ status: 'in-role' });
    expect(p.installs).toBe(0);
  });

  it('reports a failed install instead of throwing', async () => {
    const p = probe({
      install: async () => {
        throw new Error('npm exited 1: ETIMEDOUT');
      },
    });
    const r = await ensureRoleDeps('claude', p, newRoleDepsState());
    expect(r).toMatchObject({ status: 'failed' });
    expect(r.status === 'failed' && r.error).toContain('ETIMEDOUT');
  });

  it('does not rerun a failed install at every session start, and retries later', async () => {
    let t = 0;
    const state = newRoleDepsState(() => t);
    const p = probe({
      install: async () => {
        p.installs++;
        throw new Error('offline');
      },
    });
    expect(await ensureRoleDeps('claude', p, state)).toMatchObject({ status: 'failed' });
    t += ROLE_DEPS_RETRY_MS - 1;
    expect(ensureRoleDeps('claude', p, state)).toMatchObject({ status: 'failed' });
    expect(p.installs).toBe(1);
    t += 1;
    expect(await ensureRoleDeps('claude', p, state)).toMatchObject({ status: 'failed' });
    expect(p.installs).toBe(2);
  });

  it('shares one install between concurrent session starts, then answers synchronously', async () => {
    const state = newRoleDepsState();
    const p = probe();
    const [a, b] = await Promise.all([
      ensureRoleDeps('claude', p, state),
      ensureRoleDeps('claude', p, state),
    ]);
    expect(a).toEqual({ status: 'installed' });
    expect(b).toEqual({ status: 'installed' });
    expect(p.installs).toBe(1);
    expect(ensureRoleDeps('claude', p, state)).toEqual({ status: 'present' });
  });
});

// #566's effectiveRoleRuntime (runner-specs.ts) decides which roles get the
// host install; runtime-checks-567.test.ts covers the rest of its precedence.
describe('effectiveRoleRuntime, as the host install uses it', () => {
  it('puts provider kind before MONOMIND_RUNTIME, and a configured runtime before both', () => {
    vi.stubEnv('MONOMIND_RUNTIME', 'pi');
    try {
      expect(effectiveRoleRuntime(undefined, undefined, 'codex')).toBe('codex');
      expect(effectiveRoleRuntime(undefined, undefined, 'subscription')).toBe('pi');
      expect(effectiveRoleRuntime('claude', 'codex', 'codex')).toBe('claude');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('optionalDependencyPresent', () => {
  it('accepts the SDK installed without its bundled binary when asked to', () => {
    const home = mkdtempSync(join(tmpdir(), 'mm-present-'));
    const env = { MONOMIND_HOME: home };
    writeFakeSdk(dependencyDir(SDK, env), 'light', { platform: false });
    const o = { env, resolveOwn: notFound, host: HOST };
    expect(optionalDependencyPresent(SDK, o)).toBe(false);
    expect(optionalDependencyPresent(SDK, { ...o, withoutSdkBinary: true })).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('waitRoleDeps', () => {
  const never = new Promise<never>(() => {});

  it('stops waiting when the session is aborted', async () => {
    const ac = new AbortController();
    const r = waitRoleDeps(never, ac.signal, 60_000);
    ac.abort();
    expect(await r).toMatchObject({ status: 'failed', error: expect.stringContaining('stopped') });
  });

  it('stops waiting after the timeout', async () => {
    const r = await waitRoleDeps(never, new AbortController().signal, 5);
    expect(r).toMatchObject({ status: 'failed', error: expect.stringContaining('still installing') });
  });

  it('returns the install result when it comes first', async () => {
    const r = waitRoleDeps(
      Promise.resolve({ status: 'installed' as const }),
      new AbortController().signal,
    );
    expect(await r).toEqual({ status: 'installed' });
  });
});

describe('runOneSession', () => {
  it('ensures the role deps on the host before it spawns the runner', async () => {
    const order: string[] = [];
    const runner = {
      run: async function* (args: any) {
        order.push('spawn');
        for await (const _ of args.prompt) {
          yield { type: 'result', subtype: 'success', result: 'done' };
          return;
        }
      },
    };
    const def = OrgDefSchema.parse({ name: 'x', roles: [{ id: 'worker', runtime: 'codex' }] });
    const bus = new OrgBus('x', 'run-1', mkdtempSync(join(tmpdir(), 'role-deps-')));
    const mailbox = new Mailbox();
    mailbox.push('go');
    mailbox.close();
    const ensure = vi.fn(async (runtime: string) => {
      order.push(`ensure:${runtime}`);
      return { status: 'installed' as const };
    });
    const opts = {
      org: 'x',
      role: def.roles[0],
      bus,
      policy: new PolicyEngine('worker', {}, bus, '/tmp'),
      mailbox,
      cwd: '/tmp',
      def,
      deliver: async () => 'ok',
      runner,
      ensureRoleDeps: ensure,
    } as unknown as SessionOpts;
    await runAgentSession(opts).catch(() => {});
    expect(order[0]).toBe('ensure:codex');
    expect(order).toContain('spawn');
    expect(order.indexOf('ensure:codex')).toBeLessThan(order.indexOf('spawn'));
  });

  it('passes the runtime runner selection resolves, provider kind included', async () => {
    const runtimes: string[] = [];
    const def = OrgDefSchema.parse({
      name: 'x',
      roles: [{ id: 'worker', provider: { kind: 'codex' } }],
    });
    const bus = new OrgBus('x', 'run-1', mkdtempSync(join(tmpdir(), 'role-deps-')));
    const mailbox = new Mailbox();
    mailbox.close();
    const opts = {
      org: 'x',
      role: def.roles[0],
      bus,
      policy: new PolicyEngine('worker', {}, bus, '/tmp'),
      mailbox,
      cwd: '/tmp',
      def,
      deliver: async () => 'ok',
      runner: { run: async function* () {} },
      ensureRoleDeps: (runtime: string) => {
        runtimes.push(runtime);
        return { status: 'not-needed' as const };
      },
    } as unknown as SessionOpts;
    await runAgentSession(opts).catch(() => {});
    expect(runtimes[0]).toBe('codex');
  });
});

describe('in a role, a missing SDK fails fast (#559)', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mm-role-deps-'));
  });
  afterEach(() => {
    chmodSync(depsRoot({ MONOMIND_HOME: home }), 0o700);
    rmSync(home, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'names the operator command and never runs npm when the deps dir is read-only',
    async () => {
      const env = { MONOMIND_HOME: home, MONOMIND_ORG_ROLE: 'builder' };
      mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
      chmodSync(depsRoot(env), 0o555);
      const npm = fakeNpm('unused');
      const log = vi.fn();
      const err = (await ensureOptionalDependency(SDK, {
        env,
        resolveOwn: notFound,
        log,
        host: HOST,
        pins: FAKE_PINS,
        runNpm: npm.run,
      }).catch((e: unknown) => e)) as Error;
      expect(err).toBeInstanceOf(OptionalDependencyError);
      expect(err.message).toContain('monomind deps install');
      expect(err.message).toContain(manualInstallCommand(SDK, env));
      expect(err.message).not.toMatch(/^EROFS|^EACCES/);
      expect(npm.calls).toHaveLength(0);
      expect(log.mock.calls.flat().join('\n')).not.toMatch(/Installing it once/);
    },
  );
});

describe('monomind deps install', () => {
  it('is an explicit request: installs even with MONOMIND_NO_AUTO_INSTALL set', async () => {
    const install = depsCommand.subcommands?.find((c) => c.name === 'install');
    const saved = process.env.MONOMIND_NO_AUTO_INSTALL;
    process.env.MONOMIND_NO_AUTO_INSTALL = '1';
    loadClaudeSdk.mockClear();
    try {
      const r = await install!.action!({ args: [], flags: {} } as unknown as CommandContext);
      expect(r).toMatchObject({ success: true });
      expect(loadClaudeSdk).toHaveBeenCalledWith(undefined, { requested: true, intoCache: true });
    } finally {
      if (saved === undefined) delete process.env.MONOMIND_NO_AUTO_INSTALL;
      else process.env.MONOMIND_NO_AUTO_INSTALL = saved;
    }
  });

  it('a requested install is not blocked by MONOMIND_NO_AUTO_INSTALL', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mm-requested-'));
    const env = { MONOMIND_HOME: home, MONOMIND_NO_AUTO_INSTALL: '1' };
    const npm = fakeNpm('requested');
    const o = { env, resolveOwn: notFound, log: vi.fn(), host: HOST, pins: FAKE_PINS, runNpm: npm.run };
    await expect(ensureOptionalDependency(SDK, o)).rejects.toThrow(/MONOMIND_NO_AUTO_INSTALL/);
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, { ...o, requested: true });
    expect(mod.marker).toBe('requested');
    expect(npm.calls).toHaveLength(1);
    rmSync(home, { recursive: true, force: true });
  });

  it('refuses to run inside an org role', async () => {
    const install = depsCommand.subcommands?.find((c) => c.name === 'install');
    const saved = process.env.MONOMIND_ORG_ROLE;
    process.env.MONOMIND_ORG_ROLE = 'builder';
    try {
      const r = await install!.action!({ args: [], flags: {} } as unknown as CommandContext);
      expect(r).toMatchObject({ success: false });
    } finally {
      if (saved === undefined) delete process.env.MONOMIND_ORG_ROLE;
      else process.env.MONOMIND_ORG_ROLE = saved;
    }
  });
});
