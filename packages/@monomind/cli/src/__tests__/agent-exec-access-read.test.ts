/**
 * #388: `agent exec --access read` — read files, search, web and read-only
 * shell; no edits, no general shell, no subagents.
 *
 *  - the read-only shell check (agent-exec-read.ts) on its own;
 *  - a claude turn through the REAL ClaudeAgentRunner and a fake Claude CLI
 *    (fake-claude-cli.ts: PreToolUse hook + canUseTool, as the CLI calls
 *    them): Read and Grep run, Edit ends `denied:true`, `git diff` runs,
 *    `rm x`, `git diff | sh` and `find . -delete` are denied;
 *  - codex (`--sandbox read-only` whatever the role's git level) and pi
 *    (`--tools read,grep,find,ls`) argv; every other runtime, opencode
 *    included, is `unsupported` and has no "read" in `agent scan --json`.
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runExec } from '../commands/agent-exec.js';
import { runAgentExec } from '../orgrt/agent-exec.js';
import { checkReadOnlyCommand, READ_BASH_PREFIXES, shellWords } from '../orgrt/agent-exec-read.js';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { codexExecArgs } from '../orgrt/codex-runner-stream.js';
import { PI_READ_TOOLS, piCliArgs } from '../orgrt/pi-runner-state.js';
import { RUNNER_SPECS, scanInstalled } from '../orgrt/runner-registry.js';
import type { CommandContext } from '../types.js';
import { type FakeToolCall, fakeClaudeQuery } from './fake-claude-cli.js';

describe('#388 read-only shell check', () => {
  const allowed = [
    'git status',
    'git diff',
    'git diff HEAD~1 -- src',
    'git log --oneline -5',
    'git show HEAD:README.md',
    'git blame -L 1,5 a.ts',
    'ls -la',
    'cat package.json',
    'head -n 5 a.ts',
    'tail -n 5 a.ts',
    'wc -l a.ts',
    "rg 'foo|bar' src",
    'grep -rn "a;b" src',
    "find . -name '*.ts' -type f",
  ];
  it.each(allowed)('allows %s', (cmd) => {
    expect(checkReadOnlyCommand(cmd)).toEqual({ ok: true });
  });

  const denied = [
    'rm x',
    'git diff | sh',
    'find . -delete',
    "find . '-delete'",
    'find . -name x -exec rm {} \\;',
    'find . -execdir rm {} +',
    'find . -fprint out.txt',
    'find . -ok rm {} ;',
    'git log --output=x.txt',
    'git diff --ext-diff',
    'rg --pre ./evil x',
    'rg --pre=./evil x',
    'cat a > b',
    'cat a >> b',
    'cat < a',
    'ls; rm x',
    'ls && rm x',
    'ls || rm x',
    'ls & rm x',
    'cat `whoami`',
    'cat $(whoami)',
    '(ls)',
    'ls\nrm x',
    'git commit -m x',
    'git push',
    'lsof',
    'echo hi',
    'sh -c ls',
  ];
  it.each(denied)('denies %s', (cmd) => {
    expect(checkReadOnlyCommand(cmd).ok).toBe(false);
  });

  it('--allow-bash-prefix adds prefixes, under the same syntax rules', () => {
    expect(checkReadOnlyCommand('monoagentcli list', ['monoagentcli'])).toEqual({ ok: true });
    expect(checkReadOnlyCommand('monoagentcli list | sh', ['monoagentcli']).ok).toBe(false);
    expect(checkReadOnlyCommand('monoagentcli list').ok).toBe(false);
  });

  it('shellWords removes quotes and escapes the way bash does', () => {
    expect(shellWords(`find . '-del'"ete" \\-exec`)).toEqual(['find', '.', '-delete', '-exec']);
    expect(READ_BASH_PREFIXES).toContain('git diff');
  });
});

async function claudeReadTurn(steps: FakeToolCall[][], extra: Record<string, unknown> = {}) {
  const fake = fakeClaudeQuery(steps);
  const events: Record<string, any>[] = [];
  const stdin = new PassThrough();
  const code = await runAgentExec({
    runtime: 'claude',
    access: 'read',
    prompt: 'look around',
    maxTurns: 5,
    toolTimeoutMs: 60_000,
    runnerOverride: new ClaudeAgentRunner(fake.queryFn),
    emit: (ev) => {
      events.push(ev);
      // The caller answers every caller tool call.
      if (ev.type === 'tool_call')
        stdin.write(
          `${JSON.stringify({ v: 1, type: 'tool_result', id: ev.id, ok: true, result: { text: 'found' } })}\n`,
        );
    },
    stdin,
    ...extra,
  } as any);
  return { code, events, ...fake };
}

describe('#388 claude --access read (real ClaudeAgentRunner, fake CLI)', () => {
  const call = (id: string, name: string, input: Record<string, unknown>): FakeToolCall => ({
    id,
    name,
    input,
  });

  it('Read and Grep run, Edit is denied:true, git diff runs, rm x / git diff | sh / find -delete are denied', async () => {
    const { code, events, outcomes, captured } = await claudeReadTurn([
      [call('t_read', 'Read', { file_path: '/p/a.ts' }), call('t_grep', 'Grep', { pattern: 'x' })],
      [call('t_edit', 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })],
      [call('t_diff', 'Bash', { command: 'git diff' })],
      [call('t_rm', 'Bash', { command: 'rm x' })],
      [call('t_pipe', 'Bash', { command: 'git diff | sh' })],
      [call('t_find', 'Bash', { command: 'find . -delete' })],
      [call('t_task', 'Task', { prompt: 'go', subagent_type: 'Explore' })],
    ]);
    expect(code).toBe(0);
    const denied = Object.fromEntries(outcomes.map((o) => [o.id, o.denied]));
    expect(denied).toEqual({
      t_read: false,
      t_grep: false,
      t_edit: true,
      t_diff: false,
      t_rm: true,
      t_pipe: true,
      t_find: true,
      t_task: true,
    });
    const ends = events.filter((e) => e.type === 'tool_activity' && e.phase === 'end');
    const byId = Object.fromEntries(ends.map((e) => [e.id, e]));
    expect(byId.t_edit).toMatchObject({ ok: false, denied: true });
    expect(byId.t_read).toMatchObject({ ok: true });
    expect(byId.t_read.denied).toBeUndefined();
    expect(byId.t_rm).toMatchObject({ ok: false, denied: true });
    // Never bypassPermissions: the gate is consulted.
    expect(captured.options.permissionMode).toBe('default');
    expect(captured.options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(events.find((e) => e.type === 'start')).toMatchObject({ access: 'read' });
  });

  it('caller tools stay allowed; --settings user,project,local is accepted', async () => {
    const { code, outcomes, events, captured } = await claudeReadTurn(
      [[call('t_c', 'mcp__org__lookup', { q: 'x' })]],
      {
        settings: ['user', 'project', 'local'],
        toolSpecs: [
          {
            name: 'lookup',
            description: 'look up',
            schema: { type: 'object', properties: { q: { type: 'string' } } },
          },
        ],
      },
    );
    expect(code).toBe(0);
    expect(outcomes[0]).toMatchObject({ denied: false, text: 'found' });
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'lookup')).toBe(true);
    expect(captured.options.settingSources).toEqual(['user', 'project', 'local']);
  });

  it('no audit line and no background_pids: read is not full access', async () => {
    const { events } = await claudeReadTurn([]);
    expect(events.at(-1)).toEqual({ v: 1, type: 'done', exit_code: 0 });
  });
});

describe('#388 codex and pi map read to their own read-only mode', () => {
  const base = { tools: [], prompt: [], systemPrompt: '', cwd: '/w', maxTurns: 3 } as any;

  it('codex: --sandbox read-only, whatever MONOMIND_GIT_LEVEL says (never danger-full-access)', () => {
    for (const env of [{}, { MONOMIND_GIT_LEVEL: 'commit' }, { MONOMIND_GIT_LEVEL: 'read' }]) {
      const argv = codexExecArgs({ ...base, access: 'read', env }, undefined);
      expect(argv[argv.indexOf('--sandbox') + 1]).toBe('read-only');
      expect(argv).not.toContain('danger-full-access');
      expect(argv).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    }
    const resumed = codexExecArgs({ ...base, access: 'read', env: {} }, 'thread-1');
    expect(resumed.slice(resumed.indexOf('--sandbox'))).toEqual([
      '--sandbox',
      'read-only',
      'resume',
      'thread-1',
      '--',
      '-',
    ]);
  });

  it('codex scoped and full are unchanged', () => {
    expect(codexExecArgs({ ...base, env: {} }, undefined)).toContain('danger-full-access');
    expect(codexExecArgs({ ...base, access: 'full', env: {} }, undefined)).toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
  });

  it('pi and pi-rpc: --tools read,grep,find,ls only for read', () => {
    for (const mode of ['json', 'rpc'] as const) {
      const argv = piCliArgs(mode, 'sid', { ...base, access: 'read' });
      expect(argv[argv.indexOf('--tools') + 1]).toBe(PI_READ_TOOLS);
      expect(PI_READ_TOOLS.split(',')).toEqual(['read', 'grep', 'find', 'ls']);
      expect(piCliArgs(mode, 'sid', { ...base, access: 'full' })).not.toContain('--tools');
      expect(piCliArgs(mode, 'sid', base)).not.toContain('--tools');
    }
  });
});

describe('#388 access_modes and unsupported runtimes', () => {
  it('agent scan --json lists read only for claude, codex, pi, pi-rpc', async () => {
    const { agents } = await scanInstalled({ skipVersionProbe: true, env: { PATH: '' } });
    const withRead = agents.filter((a) => a.access_modes.includes('read')).map((a) => a.id);
    expect(withRead.sort()).toEqual(['claude', 'codex', 'pi', 'pi-rpc']);
    for (const a of agents) {
      if (!a.execution_supported) {
        expect(a.access_modes, a.id).toEqual([]);
        expect(a.execution_unsupported_reason, a.id).toEqual(expect.any(String));
      } else if (a.id === 'kilo') expect(a.access_modes).toEqual(['full']);
      else expect(a.access_modes[0]).toBe('scoped');
      expect(a.access_modes.includes('full')).toBe(a.full_access);
    }
    expect(agents.find((a) => a.id === 'opencode')!.access_modes).toEqual(['scoped', 'full']);
    expect(agents.find((a) => a.id === 'claude')!.access_modes).toEqual(['scoped', 'read', 'full']);
  });

  it.each(RUNNER_SPECS.filter((s) => !s.readAccess).map((s) => s.id))(
    '%s: --access read is error {code:"unsupported", fatal:true}, exit 2, runner never called',
    async (runtime) => {
      const events: Record<string, any>[] = [];
      let ran = false;
      const code = await runAgentExec({
        runtime,
        access: 'read',
        prompt: 'x',
        maxTurns: 1,
        toolTimeoutMs: 1000,
        runnerOverride: {
          async *run() {
            ran = true;
            yield { type: 'result', subtype: 'success' } as any;
          },
        },
        emit: (ev) => events.push(ev),
        stdin: new PassThrough(),
      });
      expect(code).toBe(2);
      expect(ran).toBe(false);
      expect(events).toEqual([
        expect.objectContaining({ type: 'error', code: 'unsupported', fatal: true }),
        { v: 1, type: 'done', exit_code: 2 },
      ]);
    },
  );
});

describe('#388 CLI flags', () => {
  const ctx = (flags: Record<string, string>): CommandContext => ({
    args: [],
    flags: { _: [], ...flags },
    cwd: process.cwd(),
    interactive: false,
  });
  const noopRunner = {
    async *run() {
      yield { type: 'result', subtype: 'success' } as any;
    },
  };

  it('--access read with --allow-bash-prefix passes validation (exit 0)', async () => {
    const code = await runExec(
      ctx({ runtime: 'claude', prompt: 'hi', access: 'read', 'allow-bash-prefix': 'monoagentcli' }),
      { runnerOverride: noopRunner, emit: () => {} },
    );
    expect(code).toBe(0);
  });

  it('--access read --settings user,project,local passes validation (exit 0)', async () => {
    const code = await runExec(
      ctx({ runtime: 'claude', prompt: 'hi', access: 'read', settings: 'user,project,local' }),
      { runnerOverride: noopRunner, emit: () => {}, startupTimeoutMs: 60_000 },
    );
    expect(code).toBe(0);
  });
});
