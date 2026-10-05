/**
 * #396 (rev 23): `agent exec --sandbox read-only|workspace-write|full` and
 * the truthful `native_sandbox` / `approvals` on `start` and in `agent scan`.
 *
 *  - default argv is unchanged without the flag (codex, grok, dsh, pi), and
 *    `--sandbox full` is the same as no flag;
 *  - read-only / workspace-write map to each CLI's own mode where it exists
 *    and are `unsupported` elsewhere;
 *  - an org role's git level stricter than the flag wins; `--access read`
 *    always runs read-only; `--access read --sandbox full` is a usage error.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runExec } from '../commands/agent-exec.js';
import { runAgentExec } from '../orgrt/agent-exec.js';
import type { AgentMessage, AgentRunArgs, AgentRunner } from '../orgrt/agent-runner.js';
import { codexExecArgs } from '../orgrt/codex-runner-stream.js';
import { dshPermissionMode } from '../orgrt/dsh-runner-stream.js';
import { grokCliArgs } from '../orgrt/grok-runner-stream.js';
import { piCliArgs } from '../orgrt/pi-runner-state.js';
import { RUNNER_SPECS, scanInstalled } from '../orgrt/runner-registry.js';
import { RUNNER_SANDBOX_MODES, type SandboxMode } from '../orgrt/runner-sandbox.js';
import type { CommandContext } from '../types.js';

const base = (extra: Partial<AgentRunArgs> = {}): AgentRunArgs =>
  ({ tools: [], prompt: [], systemPrompt: '', cwd: '/w', env: {}, maxTurns: 0, ...extra }) as any;

const NET = ['-c', 'sandbox_workspace_write.network_access=true'];

describe('#396 codex argv', () => {
  it('default argv is unchanged without --sandbox, and --sandbox full is identical', () => {
    const cases: Array<[Partial<AgentRunArgs>, string[]]> = [
      [{}, ['--sandbox', 'danger-full-access']],
      [{ env: { MONOMIND_GIT_LEVEL: 'read' } }, ['--sandbox', 'workspace-write', ...NET]],
      [{ access: 'full' }, ['--dangerously-bypass-approvals-and-sandbox']],
      [{ access: 'read' }, ['--sandbox', 'read-only']],
    ];
    for (const [extra, tail] of cases) {
      const argv = codexExecArgs(base(extra), undefined);
      expect(argv).toEqual([
        'exec',
        '--json',
        '-c',
        'features.shell_snapshot=false',
        '-c',
        'features.shell_snapshot_v2=false',
        '--cd',
        '/w',
        '--skip-git-repo-check',
        ...tail,
        '--',
        '-',
      ]);
      expect(codexExecArgs(base({ ...extra, sandbox: 'full' }), undefined)).toEqual(argv);
    }
  });

  it('read-only / workspace-write map to codex --sandbox, with scoped and full access', () => {
    for (const access of ['scoped', 'full'] as const) {
      const ro = codexExecArgs(base({ access, sandbox: 'read-only' }), undefined);
      expect(ro).toContain('read-only');
      expect(ro).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      const ww = codexExecArgs(base({ access, sandbox: 'workspace-write' }), 't1');
      expect(ww.join(' ')).toContain(['--sandbox', 'workspace-write', ...NET].join(' '));
      expect(ww).not.toContain('danger-full-access');
      expect(ww).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    }
  });

  it('--access read stays read-only whatever --sandbox says', () => {
    const argv = codexExecArgs(base({ access: 'read', sandbox: 'workspace-write' }), undefined);
    expect(argv.join(' ')).toContain('--sandbox read-only');
    expect(argv).not.toContain('workspace-write');
  });
});

describe('#396 grok argv', () => {
  const sandboxOf = (a: string[]) => {
    const i = a.indexOf('--sandbox');
    return i < 0 ? null : a[i + 1];
  };
  it('default argv is unchanged without --sandbox, and --sandbox full is identical', () => {
    for (const extra of [
      {},
      { env: { MONOMIND_GIT_LEVEL: 'commit' } },
      { access: 'full' as const },
    ]) {
      const argv = grokCliArgs('p', undefined, base(extra));
      expect(grokCliArgs('p', undefined, base({ ...extra, sandbox: 'full' }))).toEqual(argv);
    }
    expect(sandboxOf(grokCliArgs('p', undefined, base()))).toBeNull();
    expect(
      sandboxOf(grokCliArgs('p', undefined, base({ env: { MONOMIND_GIT_LEVEL: 'read' } }))),
    ).toBe('workspace');
    expect(sandboxOf(grokCliArgs('p', undefined, base({ access: 'full' })))).toBeNull();
  });
  it('read-only → read-only profile, workspace-write → workspace profile, in any access mode', () => {
    for (const access of ['scoped', 'full'] as const) {
      expect(sandboxOf(grokCliArgs('p', undefined, base({ access, sandbox: 'read-only' })))).toBe(
        'read-only',
      );
      expect(
        sandboxOf(grokCliArgs('p', undefined, base({ access, sandbox: 'workspace-write' }))),
      ).toBe('workspace');
      expect(grokCliArgs('p', undefined, base({ access }))).toContain('--always-approve');
    }
  });
});

describe('#396 dsh permission mode', () => {
  it('default unchanged; full = default; read-only / workspace-write map through', () => {
    expect(dshPermissionMode(base())).toBe('workspace-write');
    expect(dshPermissionMode(base({ sandbox: 'full' }))).toBe('workspace-write');
    expect(dshPermissionMode(base({ access: 'full' }))).toBe('danger-full-access');
    expect(dshPermissionMode(base({ access: 'full', sandbox: 'full' }))).toBe('danger-full-access');
    expect(dshPermissionMode(base({ env: { DSH_PERMISSION_MODE: 'read-only' } }))).toBe(
      'read-only',
    );
    expect(dshPermissionMode(base({ sandbox: 'read-only' }))).toBe('read-only');
    expect(dshPermissionMode(base({ access: 'full', sandbox: 'workspace-write' }))).toBe(
      'workspace-write',
    );
  });
});

describe('#396 other runtimes ignore the field', () => {
  it('pi argv is the same with sandbox full', () => {
    expect(piCliArgs('json', 's1', base({ sandbox: 'full' }))).toEqual(
      piCliArgs('json', 's1', base()),
    );
  });
  it('only the runners with a mode in RUNNER_SANDBOX_MODES read args.sandbox', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'orgrt');
    const readers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && /args\.sandbox/.test(readFileSync(join(dir, f), 'utf8')))
      .sort();
    expect(readers).toEqual([
      'antigravity-runner-stream.ts',
      'codex-runner-stream.ts',
      'copilot-runner-stream.ts',
      'dsh-runner-stream.ts',
      'grok-runner-stream.ts',
      'kilo-runner.ts',
      'opencode-runner-server.ts',
      'opencode-runner.ts',
      'pi-runner-state.ts',
    ]);
  });
});

// ─── engine: start fields, unsupported, org cap ─────────────────────────────

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
  return { code, events, start: events.find((e) => e.type === 'start'), seen: runner.seen };
}

const DEFAULTS: Record<string, [string, string]> = {
  claude: ['monomind', 'n/a'],
  codex: ['full', 'off'],
  grok: ['full', 'off'],
  dsh: ['workspace-write', 'on'],
  opencode: ['none', 'on'],
  cline: ['none', 'on'],
  hermes: ['none', 'on'],
  vercel: ['none', 'n/a'],
  antigravity: ['none', 'off'],
  kimicode: ['none', 'off'],
  qwen: ['none', 'off'],
  'qwen-rpc': ['none', 'off'],
  crush: ['none', 'off'],
  copilot: ['none', 'off'],
  pi: ['none', 'off'],
  'pi-rpc': ['none', 'off'],
  aider: ['none', 'off'],
};

const APPROVALS_WHEN_NARROWED: Record<string, string> = {
  claude: 'n/a',
  codex: 'off',
  grok: 'off',
  dsh: 'on',
  copilot: 'on',
  antigravity: 'on',
  opencode: 'on',
  pi: 'off',
  'pi-rpc': 'off',
};

describe('#396 start event', () => {
  const savedLevel = process.env.MONOMIND_GIT_LEVEL;
  afterEach(() => {
    if (savedLevel === undefined) delete process.env.MONOMIND_GIT_LEVEL;
    else process.env.MONOMIND_GIT_LEVEL = savedLevel;
  });

  it('every runtime reports its default native_sandbox / approvals, and no sandbox reaches the runner', async () => {
    delete process.env.MONOMIND_GIT_LEVEL;
    expect(Object.keys(DEFAULTS).sort()).toEqual(
      RUNNER_SPECS.filter(
        (s) => !s.executionUnsupportedReason && !('scopedAccess' in s && s.scopedAccess === false),
      )
        .map((s) => s.id)
        .sort(),
    );
    for (const [runtime, [native, approvals]] of Object.entries(DEFAULTS)) {
      const { code, start, seen } = await turn(runtime);
      expect(code, runtime).toBe(0);
      expect(start, runtime).toMatchObject({ native_sandbox: native, approvals });
      expect(seen && 'sandbox' in seen, runtime).toBe(false);
    }
  });

  it.each(
    RUNNER_SPECS.filter((s) => s.executionUnsupportedReason || s.scopedAccess === false).map(
      (s) => s.id,
    ),
  )('%s refuses default scoped access before any runner executes', async (runtime) => {
    const { code, events, seen, start } = await turn(runtime);
    expect(code).toBe(2);
    expect(start).toBeUndefined();
    expect(seen).toBeUndefined();
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'unsupported', fatal: true }),
      { v: 1, type: 'done', exit_code: 2 },
    ]);
  });

  it('each supported mode reaches the runner and is reported; full = the default report', async () => {
    delete process.env.MONOMIND_GIT_LEVEL;
    for (const [runtime, modes] of Object.entries(RUNNER_SANDBOX_MODES)) {
      for (const mode of modes) {
        const fullOnly = RUNNER_SPECS.find((s) => s.id === runtime)?.scopedAccess === false;
        const { code, start, seen } = await turn(runtime, {
          sandbox: mode,
          ...(fullOnly ? { access: 'full', cwd: process.cwd() } : {}),
        });
        expect(code, `${runtime} ${mode}`).toBe(0);
        expect(seen?.sandbox).toBe(mode);
        const [native, approvals] = fullOnly ? ['none', 'off'] : DEFAULTS[runtime];
        if (mode === 'full') expect(start).toMatchObject({ native_sandbox: native, approvals });
        else
          expect(start, `${runtime} ${mode}`).toMatchObject({
            // #482: claude's allow-list is monomind's own; the CLIs with
            // approval rules report them on.
            native_sandbox: runtime === 'claude' ? 'monomind' : mode,
            approvals: APPROVALS_WHEN_NARROWED[runtime],
          });
        expect(start).toMatchObject({ sandbox_requested: mode, sandbox_applied: mode });
      }
    }
  });

  it('an unsupported mode is error {code:"unsupported", fatal:true}, exit 2, the runner never runs', async () => {
    for (const [runtime, modes] of Object.entries(RUNNER_SANDBOX_MODES)) {
      for (const mode of ['read-only', 'restricted', 'workspace-write'] as SandboxMode[]) {
        if (modes.includes(mode)) continue;
        const { code, events, seen } = await turn(runtime, { sandbox: mode });
        expect(code, `${runtime} ${mode}`).toBe(2);
        expect(events[0]).toMatchObject({ type: 'error', code: 'unsupported', fatal: true });
        expect(events.at(-1)).toMatchObject({ type: 'done', exit_code: 2 });
        expect(seen).toBeUndefined();
      }
    }
  });

  it('full access reports what the CLI really runs', async () => {
    const cwd = process.cwd();
    const cases: Array<[string, Record<string, unknown>, string, string]> = [
      ['claude', {}, 'full', 'off'],
      ['codex', {}, 'full', 'off'],
      ['codex', { sandbox: 'workspace-write' }, 'workspace-write', 'off'],
      ['dsh', {}, 'full', 'off'],
      ['opencode', {}, 'none', 'off'],
    ];
    for (const [runtime, extra, native, approvals] of cases) {
      const { start } = await turn(runtime, { access: 'full', cwd, ...extra });
      expect(start, runtime).toMatchObject({ access: 'full', native_sandbox: native, approvals });
    }
  });

  it('codex --access read reports read-only whatever --sandbox says', async () => {
    const { start, seen } = await turn('codex', { access: 'read', sandbox: 'workspace-write' });
    expect(start).toMatchObject({ access: 'read', native_sandbox: 'read-only' });
    expect(codexExecArgs({ ...(seen as AgentRunArgs), cwd: '/w' }, undefined)).toContain(
      'read-only',
    );
  });

  it('org git level below push (via --env) is reported without the flag and caps --sandbox full', async () => {
    delete process.env.MONOMIND_GIT_LEVEL;
    const env = { MONOMIND_GIT_LEVEL: 'read' };
    expect((await turn('codex', { env })).start).toMatchObject({
      native_sandbox: 'workspace-write',
    });
    for (const runtime of ['codex', 'grok']) {
      const { start, seen } = await turn(runtime, { env, sandbox: 'full' });
      expect(seen?.sandbox, runtime).toBe('workspace-write');
      expect(start).toMatchObject({ native_sandbox: 'workspace-write' });
      // A stricter flag still wins over the org level.
      expect((await turn(runtime, { env, sandbox: 'read-only' })).seen?.sandbox).toBe('read-only');
    }
  });

  it("monomind's own MONOMIND_GIT_LEVEL (an org role running agent exec) also caps --sandbox full", async () => {
    process.env.MONOMIND_GIT_LEVEL = 'commit';
    const { seen, start } = await turn('codex', { sandbox: 'full' });
    expect(seen?.sandbox).toBe('workspace-write');
    expect(start).toMatchObject({ native_sandbox: 'workspace-write' });
    expect(codexExecArgs({ ...(seen as AgentRunArgs), cwd: '/w' }, undefined)).not.toContain(
      'danger-full-access',
    );
    // A runtime with no native mode keeps today's behaviour.
    expect((await turn('copilot', { sandbox: 'full' })).seen?.sandbox).toBe('full');
  });
});

describe('#396 agent scan --json', () => {
  it('every entry has native_sandbox, approvals and sandbox_modes', async () => {
    const { agents } = await scanInstalled({ skipVersionProbe: true });
    for (const a of agents) {
      if (!a.execution_supported) {
        expect(a.sandbox_modes, a.id).toEqual([]);
        expect(a.sandbox_mode_reports, a.id).toEqual({});
        continue;
      }
      if (!a.access_modes.includes('scoped')) {
        expect(a.id).toBe('kilo');
        expect(a.access_modes).toEqual(['full']);
        expect(a.sandbox_modes).toEqual(['full']);
        continue;
      }
      const [native, approvals] = DEFAULTS[a.id];
      expect(a, a.id).toMatchObject({ native_sandbox: native, approvals });
      expect(a.sandbox_modes).toEqual([
        ...RUNNER_SANDBOX_MODES[a.id as keyof typeof RUNNER_SANDBOX_MODES],
      ]);
      expect(a.sandbox_modes).toContain('full');
      // #482: one report per accepted mode; full = the default report.
      expect(Object.keys(a.sandbox_mode_reports)).toEqual(a.sandbox_modes);
      expect(a.sandbox_mode_reports.full).toEqual({ native_sandbox: native, approvals });
    }
    const reports = Object.fromEntries(agents.map((a) => [a.id, a.sandbox_mode_reports]));
    expect(reports.copilot.restricted).toEqual({ native_sandbox: 'restricted', approvals: 'on' });
    expect(reports.claude['read-only']).toEqual({ native_sandbox: 'monomind', approvals: 'n/a' });
    const byId = Object.fromEntries(agents.map((a) => [a.id, a.sandbox_modes]));
    expect(byId.codex).toEqual(['read-only', 'workspace-write', 'full']);
    expect(byId.grok).toEqual(['read-only', 'workspace-write', 'full']);
    expect(byId.dsh).toEqual(['read-only', 'workspace-write', 'full']);
    // #482
    expect(byId.claude).toEqual(['read-only', 'workspace-write', 'full']);
    expect(byId.copilot).toEqual(['read-only', 'restricted', 'workspace-write', 'full']);
    expect(byId.antigravity).toEqual(['restricted', 'full']);
    expect(byId.opencode).toEqual(['restricted', 'full']);
    expect(byId.pi).toEqual(['read-only', 'full']);
    expect(byId.qwen).toEqual(['full']);
  });
});

describe('#396 CLI flag validation', () => {
  const ctx = (flags: Record<string, string>): CommandContext => ({
    args: [],
    flags: { _: [], ...flags },
    cwd: process.cwd(),
    interactive: false,
  });
  it('an unknown --sandbox value is a usage error, exit 2', async () => {
    expect(await runExec(ctx({ runtime: 'codex', prompt: 'hi', sandbox: 'danger' }), {})).toBe(2);
  });
  it('--access read --sandbox full is a usage error, exit 2', async () => {
    const c = ctx({ runtime: 'codex', prompt: 'hi', access: 'read', sandbox: 'full' });
    expect(await runExec(c, {})).toBe(2);
  });
  it('--sandbox reaches the engine', async () => {
    const events: Record<string, any>[] = [];
    const runner = new RecordingRunner();
    const code = await runExec(ctx({ runtime: 'codex', prompt: 'hi', sandbox: 'read-only' }), {
      runnerOverride: runner,
      emit: (ev) => events.push(ev),
    });
    expect(code).toBe(0);
    expect(runner.seen?.sandbox).toBe('read-only');
    expect(events[0]).toMatchObject({
      type: 'start',
      native_sandbox: 'read-only',
      approvals: 'off',
    });
  });
});
