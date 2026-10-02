// A tool_call fence the runner cannot parse (found in the smoke-tier antigravity dry run: an org_send
// whose message held raw newlines, "Unterminated string in JSON") used to be dropped with a note on the
// bus and nothing sent back to the role. The role believed the send had gone, nobody was told, and the
// org sat silent until the idle watchdog ended it. Now a fence that will not parse comes back to its
// sender as an error tool_result, so the role can retry; the bus note stays.
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentRunArgs, OrgToolDef } from '../../src/orgrt/agent-runner.js';
import { AntigravityAgentRunner } from '../../src/orgrt/antigravity-runner.js';
import {
  executeToolCall,
  formatToolResults,
  MALFORMED_FENCE_CALL,
  parseToolCalls,
  runToolRound,
} from '../../src/orgrt/tool-fence.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const good = '```tool_call\n{"name": "org_send", "arguments": {"to": "a"}}\n```';
const bad = '```tool_call\n{"name": "org_send", "arguments": {"message": "line one\nline two"}}\n```';
const truncated = '```tool_call\n{"name": "org_send", "arguments": {"message": "never closed';

describe('parseToolCalls on a fence that will not parse', () => {
  it('returns an error call for it, still reports it to onMalformed, and keeps the valid calls in order', () => {
    const seen: string[] = [];
    const calls = parseToolCalls([`${good}\n${bad}\n${good}`], (_raw, err) => seen.push(err));
    expect(calls.map((c) => c.name)).toEqual(['org_send', MALFORMED_FENCE_CALL, 'org_send']);
    expect(calls[1].arguments).toMatchObject({ error: expect.stringMatching(/JSON|string/i) });
    expect(seen).toHaveLength(1);
  });

  it('does the same for a fence cut off before its closing backticks', () => {
    const calls = parseToolCalls([truncated]);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe(MALFORMED_FENCE_CALL);
    expect(String(calls[0].arguments.error)).toMatch(/truncated/);
  });

  it('adds nothing for a clean reply or a fence with no name', () => {
    expect(parseToolCalls(['just text'])).toEqual([]);
    expect(parseToolCalls(['```tool_call\n{"arguments": {}}\n```'])).toEqual([]);
  });
});

describe('executing the error call', () => {
  const noCall = vi.fn();
  const tools: OrgToolDef[] = [{ name: 'org_send', description: '', schema: {}, handler: noCall as never }];

  it('runs no tool and no policy check, and tells the role what failed and how to retry', async () => {
    const canUse = vi.fn();
    const [call] = parseToolCalls([bad]);
    const out = await executeToolCall(tools, call, canUse);
    expect(out).toMatch(/^ERROR: .*could not be parsed/);
    expect(out).toMatch(/Nothing ran/);
    expect(out).toMatch(/escape|\\n/i);
    expect(noCall).not.toHaveBeenCalled();
    expect(canUse).not.toHaveBeenCalled();
  });

  it('comes back through a tool round as a tool_result the role reads next, beside the valid call results', async () => {
    const calls = parseToolCalls([`${good}\n${bad}`]);
    tools[0].handler = (async () => ({ text: 'sent' })) as never;
    const { results } = await runToolRound({ tools }, calls, 0);
    const next = formatToolResults(calls, results as string[]);
    expect(next).toContain('"result":"sent"');
    expect(next).toContain(`"name":"${MALFORMED_FENCE_CALL}"`);
    expect(next).toMatch(/could not be parsed/);
  });
});

describe('a runner given a reply with an unparseable fence', () => {
  beforeEach(() => vi.clearAllMocks());

  const CID = 'c0ec97ea-ed0b-4b68-be12-f4a1e4d7f24d';
  const child = (text: string) => {
    const lines = [
      JSON.stringify({ event: 'init', conversation_id: CID, init: { cwd: '/w', tools: [] } }),
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: CID, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: text },
      }),
      JSON.stringify({ event: 'result', result: { conversation_id: CID, status: 'SUCCESS', usage: { input_tokens: 5, output_tokens: 2 } } }),
    ];
    const c = new EventEmitter() as any;
    c.stdout = new EventEmitter();
    c.stdout[Symbol.asyncIterator] = async function* () {
      for (const l of lines) yield Buffer.from(`${l}\n`);
    };
    c.stderr = new EventEmitter();
    c.kill = vi.fn();
    c.pid = undefined;
    c.exitCode = 0;
    setTimeout(() => c.emit('close', 0), 5);
    return c as cp.ChildProcess;
  };

  it('sends the error back in the next prompt instead of ending the turn, and keeps the note on the stream', async () => {
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(child(bad))
      .mockReturnValueOnce(child('resent'));
    const args: AgentRunArgs = {
      tools: [{ name: 'org_send', description: '', schema: {}, handler: async () => ({ text: 'sent' }) } as never],
      prompt: (async function* () {
        yield 'go';
      })(),
      systemPrompt: 'sys',
      cwd: '/w',
      env: {},
      maxTurns: 5,
    };
    const out: AgentMessage[] = [];
    for await (const m of new AntigravityAgentRunner('/bin/agy').run(args)) out.push(m);

    expect(vi.mocked(cp.spawn)).toHaveBeenCalledTimes(2); // a second exec: the role was told
    const second = (vi.mocked(cp.spawn).mock.calls[1][1] as string[]).join(' ');
    expect(second).toMatch(/tool_result/);
    expect(second).toMatch(/could not be parsed/);
    const notes = out.filter((m) => m.type === 'assistant' && /ignored malformed tool_call fence/.test((m as { text?: string }).text ?? ''));
    expect(notes).toHaveLength(1);
  });
});
