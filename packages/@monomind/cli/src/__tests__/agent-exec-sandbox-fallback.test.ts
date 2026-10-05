/**
 * #482 (rev 26): more `--sandbox` modes (copilot read-only/restricted/
 * workspace-write, antigravity and opencode restricted, pi read-only, claude
 * read-only/workspace-write in scoped/read access) and `--sandbox-fallback
 * fail|strictest|run`.
 *
 *  - default argv is byte-identical without `--sandbox` (and with `full`);
 *  - each new mode maps to the CLI flags that were checked live;
 *  - `unsupported` stays fatal under `fail` (the default);
 *  - `strictest` / `run` replace the mode, emit a `status` notice right
 *    after `start`, and report `sandbox_requested` / `sandbox_applied`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExec } from '../commands/agent-exec.js';
import { runAgentExec } from '../orgrt/agent-exec.js';
import { execAllowedToolNames } from '../orgrt/agent-exec-gate.js';
import type { AgentMessage, AgentRunArgs, AgentRunner } from '../orgrt/agent-runner.js';
import { copilotPermissionArgs } from '../orgrt/copilot-runner-stream.js';
import { piCliArgs } from '../orgrt/pi-runner-state.js';
import { runnerSpec } from '../orgrt/runner-registry.js';
import {
  RUNNER_SANDBOX_MODES,
  resolveSandbox,
  SANDBOX_MODES,
  type SandboxMode,
  strictestFallback,
} from '../orgrt/runner-sandbox.js';
import type { CommandContext } from '../types.js';

// An org role's git level in the test's own env would cap codex/grok/dsh.
const savedLevel = process.env.MONOMIND_GIT_LEVEL;
beforeAll(() => {
  delete process.env.MONOMIND_GIT_LEVEL;
});
afterAll(() => {
  if (savedLevel !== undefined) process.env.MONOMIND_GIT_LEVEL = savedLevel;
});

const base = (extra: Partial<AgentRunArgs> = {}): AgentRunArgs =>
  ({ tools: [], prompt: [], systemPrompt: '', cwd: '/w', env: {}, maxTurns: 0, ...extra }) as any;

describe('#482 copilot permission flags', () => {
  it('default flags are unchanged without --sandbox, and --sandbox full is identical', () => {
    expect(copilotPermissionArgs(base())).toEqual(['--allow-all-tools']);
    expect(copilotPermissionArgs(base({ access: 'full' }))).toEqual(['--allow-all']);
    expect(copilotPermissionArgs(base({ sandbox: 'full' }))).toEqual(['--allow-all-tools']);
    expect(copilotPermissionArgs(base({ access: 'full', sandbox: 'full' }))).toEqual([
      '--allow-all',
    ]);
  });
  it('restricted / read-only / workspace-write', () => {
    expect(copilotPermissionArgs(base({ sandbox: 'restricted' }))).toEqual([]);
    expect(copilotPermissionArgs(base({ access: 'full', sandbox: 'restricted' }))).toEqual([]);
    expect(copilotPermissionArgs(base({ sandbox: 'read-only' }))).toEqual([
      '--deny-tool=write',
      '--deny-tool=shell',
    ]);
    expect(copilotPermissionArgs(base({ access: 'full', sandbox: 'read-only' }))).toEqual([
      '--allow-all',
      '--deny-tool=write',
      '--deny-tool=shell',
    ]);
    expect(copilotPermissionArgs(base({ sandbox: 'workspace-write' }))).toEqual([
      '--allow-tool=write',
      '--deny-tool=shell',
    ]);
    const fullWw = copilotPermissionArgs(base({ access: 'full', sandbox: 'workspace-write' }));
    expect(fullWw).toEqual(['--allow-all-tools', '--allow-all-urls', '--deny-tool=shell']);
    // Never lifts copilot's path check, never allows every tool, when narrowed.
    for (const sandbox of ['read-only', 'restricted', 'workspace-write'] as const) {
      for (const access of ['scoped', 'full'] as const) {
        const argv = copilotPermissionArgs(base({ access, sandbox }));
        expect(argv).not.toContain('--allow-all-paths');
        if (sandbox !== 'read-only') expect(argv).not.toContain('--allow-all');
      }
    }
  });
});

describe('#482 pi read-only', () => {
  it('--sandbox read-only adds the read-only tool list; default and full argv unchanged', () => {
    const def = piCliArgs('json', 's1', base());
    expect(def).not.toContain('--tools');
    expect(piCliArgs('json', 's1', base({ sandbox: 'full' }))).toEqual(def);
    for (const access of ['scoped', 'full'] as const) {
      const ro = piCliArgs('rpc', 's1', base({ access, sandbox: 'read-only' }));
      expect(ro.slice(-2)).toEqual(['--tools', 'read,grep,find,ls']);
    }
  });
});

describe('#482 strictest ordering', () => {
  it('read-only > restricted > workspace-write > full', () => {
    expect(SANDBOX_MODES).toEqual(['read-only', 'restricted', 'workspace-write', 'full']);
  });
  it('keeps a supported mode, else the closest stricter one, else the strictest there is', () => {
    const all = SANDBOX_MODES;
    for (const m of all) expect(strictestFallback(m, all)).toBe(m);
    // copilot-like and codex-like sets
    expect(strictestFallback('restricted', ['read-only', 'workspace-write', 'full'])).toBe(
      'read-only',
    );
    expect(strictestFallback('workspace-write', ['read-only', 'restricted', 'full'])).toBe(
      'restricted',
    );
    expect(strictestFallback('workspace-write', ['read-only', 'full'])).toBe('read-only');
    // nothing at least as strict: the strictest available (looser than asked)
    expect(strictestFallback('read-only', ['restricted', 'full'])).toBe('restricted');
    expect(strictestFallback('workspace-write', ['full'])).toBe('full');
  });
  it('resolveSandbox: fail is the default; run = full; notices name both modes', () => {
    expect(resolveSandbox('opencode', 'read-only', []).error).toMatch(/not supported/);
    expect(resolveSandbox('opencode', 'read-only', [], { fallback: 'fail' }).error).toBeTruthy();
    const s = resolveSandbox('opencode', 'read-only', [], { fallback: 'strictest' });
    expect(s.mode).toBe('restricted');
    expect(s.notice).toMatch(
      /--sandbox read-only is not supported.*running with --sandbox restricted/,
    );
    const r = resolveSandbox('opencode', 'read-only', [], { fallback: 'run' });
    expect(r.mode).toBe('full');
    expect(r.notice).toMatch(/runtime default/);
    expect(resolveSandbox('opencode', 'restricted', [], { fallback: 'run' })).toEqual({
      mode: 'restricted',
    });
  });
});

// ─── engine ─────────────────────────────────────────────────────────────────

class RecordingRunner implements AgentRunner {
  seen: AgentRunArgs | undefined;
  async *run(args: AgentRunArgs): AsyncGenerator<AgentMessage> {
    this.seen = args;
    yield { type: 'assistant', text: 'ok' } as AgentMessage;
    yield { type: 'result', subtype: 'success', usage: {} } as unknown as AgentMessage;
  }
}

async function turn(runtime: string, extra: Record<string, unknown> = {}) {
  const events: Record<string, any>[] = [];
  const runner = new RecordingRunner();
  const code = await runAgentExec({
    runtime,
    prompt: 'hi',
    maxTurns: 1,
    toolTimeoutMs: 1000,
    cwd: process.cwd(),
    runnerOverride: runner,
    emit: (ev) => events.push(ev),
    ...extra,
  } as any);
  const notices = events.filter((e) => e.type === 'status' && e.phase === 'notice');
  return {
    code,
    events,
    notices,
    start: events.find((e) => e.type === 'start'),
    seen: runner.seen,
  };
}

describe('#482 --sandbox-fallback in agent exec', () => {
  it('fail (and no fallback) keeps unsupported fatal, exit 2, no turn', async () => {
    for (const fallback of [undefined, 'fail']) {
      const { code, events, seen } = await turn('qwen', {
        sandbox: 'workspace-write',
        ...(fallback ? { sandboxFallback: fallback } : {}),
      });
      expect(code).toBe(2);
      expect(events[0]).toMatchObject({ type: 'error', code: 'unsupported', fatal: true });
      expect(seen).toBeUndefined();
    }
  });

  it('strictest starts supported modes and refuses unavailable scoped transports before execution', async () => {
    for (const [runtime, modes] of Object.entries(RUNNER_SANDBOX_MODES)) {
      for (const requested of SANDBOX_MODES) {
        const r = await turn(runtime, { sandbox: requested, sandboxFallback: 'strictest' });
        const spec = runnerSpec(runtime)!;
        if (
          spec.executionUnsupportedReason ||
          ('scopedAccess' in spec && spec.scopedAccess === false)
        ) {
          expect(r.code, runtime).toBe(2);
          expect(r.seen, runtime).toBeUndefined();
          expect(r.start, runtime).toBeUndefined();
          expect(r.events).toEqual([
            expect.objectContaining({ type: 'error', code: 'unsupported', fatal: true }),
            { v: 1, type: 'done', exit_code: 2 },
          ]);
          continue;
        }
        const applied = strictestFallback(requested, modes);
        expect(r.code, `${runtime} ${requested}`).toBe(0);
        expect(r.seen?.sandbox).toBe(applied);
        expect(r.start).toMatchObject({ sandbox_requested: requested, sandbox_applied: applied });
        expect(r.notices.length, `${runtime} ${requested}`).toBe(applied === requested ? 0 : 1);
      }
    }
  });

  it('the notice comes right after start and says what ran', async () => {
    const { events, start } = await turn('copilot', {
      sandbox: 'workspace-write',
      sandboxFallback: 'strictest',
    });
    // copilot has workspace-write: nothing changes, no notice.
    expect(start).toMatchObject({ native_sandbox: 'workspace-write', approvals: 'on' });
    expect(events[1].type).not.toBe('status');
    const ag = await turn('antigravity', {
      sandbox: 'workspace-write',
      sandboxFallback: 'strictest',
    });
    expect(ag.events[0].type).toBe('start');
    expect(ag.events[1]).toMatchObject({ type: 'status', phase: 'notice' });
    expect(ag.events[1].message).toMatch(
      /^antigravity: --sandbox workspace-write is not supported/,
    );
    expect(ag.start).toMatchObject({
      native_sandbox: 'restricted',
      approvals: 'on',
      sandbox_requested: 'workspace-write',
      sandbox_applied: 'restricted',
    });
  });

  it('run runs the runtime default and says so', async () => {
    const r = await turn('qwen', { sandbox: 'read-only', sandboxFallback: 'run' });
    expect(r.code).toBe(0);
    expect(r.seen?.sandbox).toBe('full');
    expect(r.start).toMatchObject({
      native_sandbox: 'none',
      approvals: 'off',
      sandbox_requested: 'read-only',
      sandbox_applied: 'full',
    });
    expect(r.notices[0].message).toMatch(/--sandbox-fallback run.*runtime default/);
  });

  it('without --sandbox there are no sandbox_* fields and no notice', async () => {
    const r = await turn('copilot', { sandboxFallback: 'strictest' });
    expect(r.start).not.toHaveProperty('sandbox_requested');
    expect(r.start).not.toHaveProperty('sandbox_applied');
    expect(r.notices).toHaveLength(0);
    expect(r.seen && 'sandbox' in r.seen).toBe(false);
  });

  it("an org role's git level still caps codex, with a notice", async () => {
    const r = await turn('codex', { sandbox: 'full', env: { MONOMIND_GIT_LEVEL: 'read' } });
    expect(r.seen?.sandbox).toBe('workspace-write');
    expect(r.start).toMatchObject({
      sandbox_requested: 'full',
      sandbox_applied: 'workspace-write',
    });
    expect(r.notices[0].message).toMatch(/git level/);
  });
});

describe('#482 claude', () => {
  it('scoped and read accept read-only / workspace-write, enforced by monomind', async () => {
    for (const access of ['scoped', 'read'] as const) {
      for (const sandbox of ['read-only', 'workspace-write'] as SandboxMode[]) {
        const r = await turn('claude', { access, sandbox });
        expect(r.code, `${access} ${sandbox}`).toBe(0);
        expect(r.seen?.sandbox).toBe(sandbox);
        expect(r.start).toMatchObject({
          native_sandbox: 'monomind',
          approvals: 'n/a',
          sandbox_applied: sandbox,
        });
      }
    }
    expect((await turn('claude', { sandbox: 'restricted' })).code).toBe(2);
  });

  it('--access full has only full: unsupported under fail, full + notice under strictest', async () => {
    const cwd = process.cwd();
    const failed = await turn('claude', { access: 'full', cwd, sandbox: 'workspace-write' });
    expect(failed.code).toBe(2);
    expect(failed.events[0].message).toMatch(/with --access full/);
    const r = await turn('claude', {
      access: 'full',
      cwd,
      sandbox: 'workspace-write',
      sandboxFallback: 'strictest',
    });
    expect(r.code).toBe(0);
    expect(r.start).toMatchObject({ native_sandbox: 'full', sandbox_applied: 'full' });
    expect(r.notices).toHaveLength(1);
  });

  it('a caller tool named like a native tool never lets the native tool through', async () => {
    const tools = [{ name: 'Write' }, { name: 'lookup' }];
    for (const sandbox of ['read-only', 'workspace-write'] as SandboxMode[]) {
      const names = execAllowedToolNames('claude', sandbox, tools);
      expect([...names].sort()).toEqual(['mcp__org__Write', 'mcp__org__lookup']);
    }
    // unchanged elsewhere: fence runtimes need the bare name, claude without --sandbox too
    expect(execAllowedToolNames('claude', undefined, tools).has('Write')).toBe(true);
    expect(execAllowedToolNames('copilot', 'read-only', tools).has('Write')).toBe(true);
  });
});

describe('#482 CLI flag validation', () => {
  const ctx = (flags: Record<string, string>): CommandContext => ({
    args: [],
    flags: { _: [], ...flags },
    cwd: process.cwd(),
    interactive: false,
  });
  it('an unknown --sandbox-fallback value is a usage error, exit 2', async () => {
    const c = ctx({ runtime: 'qwen', prompt: 'hi', sandbox: 'read-only', 'sandbox-fallback': 'x' });
    expect(await runExec(c, {})).toBe(2);
  });
  it('--sandbox restricted and --sandbox-fallback reach the engine', async () => {
    const events: Record<string, any>[] = [];
    const runner = new RecordingRunner();
    const flags = {
      runtime: 'codex',
      prompt: 'hi',
      sandbox: 'restricted',
      'sandbox-fallback': 'strictest',
    };
    const code = await runExec(ctx(flags), {
      runnerOverride: runner,
      emit: (ev) => events.push(ev),
    });
    expect(code).toBe(0);
    expect(runner.seen?.sandbox).toBe('read-only');
    expect(events[0]).toMatchObject({ type: 'start', sandbox_applied: 'read-only' });
    expect(events[1]).toMatchObject({ type: 'status', phase: 'notice' });
  });
});
