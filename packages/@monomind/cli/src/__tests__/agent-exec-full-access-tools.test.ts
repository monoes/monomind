/**
 * #389: `--access full --tools stdio` — caller tools next to native tools on
 * a full-access turn, and parallel caller calls sent to the caller at once.
 *
 *  - claude: the REAL ClaudeAgentRunner and a fake Claude CLI
 *    (fake-claude-cli.ts: MCP JSON-RPC to the in-process `org` server; the
 *    calls of one message run concurrently only when every tool has
 *    readOnlyHint, as Claude Code decides);
 *  - codex: the real CodexAgentRunner with `codex exec` mocked (fence
 *    protocol); the other full-access runtimes have the same fixture in
 *    their own runner test files (`#389` describe blocks);
 *  - runToolRound concurrency, the scan fields, the unsupported guard,
 *    --tool-timeout in full mode, and --allow-bash-prefix still rejected.
 */

import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runExec } from '../commands/agent-exec.js';
import { runAgentExec } from '../orgrt/agent-exec.js';
import { checkCallerTools } from '../orgrt/agent-exec-access.js';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { CodexAgentRunner } from '../orgrt/codex-runner.js';
import { RUNNER_SPECS, runnerSpec, scanInstalled } from '../orgrt/runner-registry.js';
import { runToolRound } from '../orgrt/tool-fence.js';
import type { CommandContext } from '../types.js';
import {
  CALLER_TOOL,
  callerFence,
  expectAllCallsBeforeResults,
  expectCallerRoundTrip,
  rosterResult,
  runFullAccessToolTurn,
} from './caller-tool-turn.js';
import { fakeClaudeQuery } from './fake-claude-cli.js';

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

beforeEach(() => vi.mocked(cp.spawn).mockReset());
// The audit line of the hand-built full-access turn below stays out of ~/.monomind.
beforeAll(() => {
  process.env.MONOMIND_FULL_ACCESS_LOG = join(mkdtempSync(join(tmpdir(), 'mm-389-log-')), 'fa.log');
});
afterAll(() => {
  delete process.env.MONOMIND_FULL_ACCESS_LOG;
});

describe('#389 claude: full access + stdio caller tools', () => {
  it('a full-access turn calls a stdio tool and gets the result back', async () => {
    const fake = fakeClaudeQuery([
      [{ id: 't1', name: 'mcp__org__org_roster', input: { team: 'core' } }],
    ]);
    const turn = await runFullAccessToolTurn('claude', new ClaudeAgentRunner(fake.queryFn));
    expectCallerRoundTrip(turn, ['core']);
    expect(fake.outcomes).toEqual([
      expect.objectContaining({ id: 't1', denied: false, text: rosterResult('core') }),
    ]);
    // Full access really is full: bypassPermissions, no canUseTool, org server present.
    expect(fake.captured.options.permissionMode).toBe('bypassPermissions');
    expect(fake.captured.options.canUseTool).toBeUndefined();
    expect(Object.keys(fake.captured.options.mcpServers)).toEqual(['org']);
  });

  it('native tools and caller tools in one full-access turn', async () => {
    const fake = fakeClaudeQuery([
      [{ id: 'b1', name: 'Bash', input: { command: 'rm -rf build' } }],
      [{ id: 't1', name: 'mcp__org__org_roster', input: { team: 'core' } }],
    ]);
    const turn = await runFullAccessToolTurn('claude', new ClaudeAgentRunner(fake.queryFn));
    expectCallerRoundTrip(turn, ['core']);
    expect(fake.outcomes.map((o) => [o.id, o.denied])).toEqual([
      ['b1', false],
      ['t1', false],
    ]);
  });

  it('two parallel caller calls: both tool_call frames before either tool_result', async () => {
    const fake = fakeClaudeQuery([
      [
        { id: 't1', name: 'mcp__org__org_roster', input: { team: 'core' } },
        { id: 't2', name: 'mcp__org__org_roster', input: { team: 'qa' } },
      ],
    ]);
    const turn = await runFullAccessToolTurn('claude', new ClaudeAgentRunner(fake.queryFn), {
      expectCalls: 2,
    });
    expectCallerRoundTrip(turn, ['core', 'qa']);
    expectAllCallsBeforeResults(turn, 2);
    // Each result reached the call it answers, whatever order they came back in.
    expect(fake.outcomes.map((o) => [o.id, o.text])).toEqual([
      ['t1', rosterResult('core')],
      ['t2', rosterResult('qa')],
    ]);
  });
});

// ─── codex (fence protocol) ─────────────────────────────────────────────────

function codexChild(texts: string[]): cp.ChildProcess {
  const child = new EventEmitter() as any;
  const lines = [
    '{"type":"thread.started","thread_id":"th-389"}',
    ...texts.map((text, i) =>
      JSON.stringify({
        type: 'item.completed',
        item: { id: `item_${i}`, type: 'agent_message', text },
      }),
    ),
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
  ];
  child.stdout = new EventEmitter();
  child.stdout[Symbol.asyncIterator] = async function* () {
    for (const line of lines) yield Buffer.from(`${line}\n`);
  };
  child.stderr = new EventEmitter();
  child.stdinData = '';
  child.stdin = {
    on: vi.fn(),
    write: (d: string) => {
      child.stdinData += d;
    },
    end: (d?: string) => {
      if (d) child.stdinData += d;
    },
  };
  child.kill = vi.fn();
  child.exitCode = null;
  child.signalCode = null;
  setTimeout(() => {
    child.exitCode = 0;
    child.emit('close', 0);
  }, 5);
  return child as cp.ChildProcess;
}

describe('#389 codex: full access + stdio caller tools (fence protocol)', () => {
  it('a full-access turn calls a stdio tool and gets the result back', async () => {
    const children = [codexChild([`Checking.\n${callerFence('core')}`]), codexChild(['done'])];
    vi.mocked(cp.spawn).mockImplementation(() => children.shift()! as any);
    const turn = await runFullAccessToolTurn('codex', new CodexAgentRunner('/usr/bin/codex'));
    expectCallerRoundTrip(turn, ['core']);
    const calls = vi.mocked(cp.spawn).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toContain('--dangerously-bypass-approvals-and-sandbox');
    // Tool protocol in the first prompt, the caller's answer in the resumed one.
    const first = (vi.mocked(cp.spawn).mock.results[0].value as any).stdinData as string;
    const second = (vi.mocked(cp.spawn).mock.results[1].value as any).stdinData as string;
    expect(first).toContain('org_roster');
    expect(second).toContain(rosterResult('core'));
    expect(calls[1][1]).toEqual(expect.arrayContaining(['resume', 'th-389']));
  });

  it('two fences in one message: both tool_call frames before either tool_result', async () => {
    const children = [
      codexChild([`${callerFence('core')}\n${callerFence('qa')}`]),
      codexChild(['done']),
    ];
    vi.mocked(cp.spawn).mockImplementation(() => children.shift()! as any);
    const turn = await runFullAccessToolTurn('codex', new CodexAgentRunner('/usr/bin/codex'), {
      expectCalls: 2,
    });
    expectCallerRoundTrip(turn, ['core', 'qa']);
    expectAllCallsBeforeResults(turn, 2);
    const second = (vi.mocked(cp.spawn).mock.results[1].value as any).stdinData as string;
    expect(second.indexOf(rosterResult('core'))).toBeLessThan(second.indexOf(rosterResult('qa')));
  });
});

// ─── shared pieces ──────────────────────────────────────────────────────────

describe('#389 runToolRound concurrency', () => {
  const tool = (name: string, concurrent: boolean, log: string[]) => ({
    name,
    description: '',
    schema: {},
    concurrent,
    handler: async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${name}`);
      return { text: name };
    },
  });

  it('starts every call of a round together when all tools are concurrent; results keep call order', async () => {
    const log: string[] = [];
    const tools = [tool('a', true, log), tool('b', true, log)];
    const { results } = await runToolRound(
      { tools },
      [
        { name: 'b', arguments: {} },
        { name: 'a', arguments: {} },
      ],
      0,
    );
    expect(results).toEqual(['b', 'a']);
    expect(log.slice(0, 2)).toEqual(['start b', 'start a']);
  });

  it('runs a round one after another when any tool is not concurrent (org runtime unchanged)', async () => {
    const log: string[] = [];
    const tools = [tool('a', true, log), tool('b', false, log)];
    await runToolRound(
      { tools },
      [
        { name: 'a', arguments: {} },
        { name: 'b', arguments: {} },
      ],
      0,
    );
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('#389 scan fields and the unsupported guard', () => {
  it('agent scan --json advertises caller tools only on verified transports and access combinations', async () => {
    const { agents } = await scanInstalled({ skipVersionProbe: true, env: { PATH: '' } });
    expect(agents).toHaveLength(RUNNER_SPECS.length);
    for (const a of agents) {
      expect(a.caller_tools, a.id).toBe(!['freebuff', 'kilo'].includes(a.id));
      if (!a.execution_supported) {
        expect(a.execution_unsupported_reason, a.id).toEqual(expect.any(String));
        expect(a.access_modes, a.id).toEqual([]);
      }
      expect(a.caller_tools_with_full_access).toBe(a.full_access && a.caller_tools);
    }
  });

  it('caller tools with full access on a runtime that cannot take them: unsupported, never dropped', () => {
    const spec = { ...runnerSpec('claude')!, callerTools: true, supportsFullAccess: false };
    expect(checkCallerTools('x', 'full', spec)).toMatchObject({ code: 'unsupported' });
    expect(checkCallerTools('x', 'scoped', spec)).toBeNull();
    const none = { ...runnerSpec('claude')!, callerTools: false };
    expect(checkCallerTools('x', 'scoped', none)).toMatchObject({ code: 'unsupported' });
  });

  it('--tool-timeout applies in full mode: an unanswered call fails with ERROR: tool timeout', async () => {
    const events: Record<string, any>[] = [];
    const runner = {
      async *run(a: any) {
        const r = await a.tools[0].handler({ team: 'core' });
        yield { type: 'assistant', text: r.text } as any;
        yield { type: 'result', subtype: 'success' } as any;
      },
    };
    const code = await runAgentExec({
      runtime: 'claude',
      access: 'full',
      cwd: process.cwd(),
      prompt: 'x',
      maxTurns: 1,
      toolTimeoutMs: 30,
      toolSpecs: [CALLER_TOOL],
      runnerOverride: runner,
      emit: (ev) => events.push(ev),
      stdin: new PassThrough(),
      env: {},
    });
    expect(code).toBe(0);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: false,
      result: { text: 'ERROR: tool timeout' },
    });
  });

  it('--allow-bash-prefix is still rejected with --access full (exit 2)', async () => {
    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        runtime: 'claude',
        prompt: 'hi',
        access: 'full',
        tools: 'stdio',
        'allow-bash-prefix': 'monoagentcli',
      },
      cwd: process.cwd(),
      interactive: false,
    };
    expect(await runExec(ctx, {})).toBe(2);
  });
});
