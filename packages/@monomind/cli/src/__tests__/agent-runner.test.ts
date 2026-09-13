/**
 * Unit tests for ClaudeAgentRunner (orgrt/agent-runner.ts).
 *
 * ClaudeAgentRunner has two independent consumers with different needs:
 * session.ts (the org runtime) wants exactly one 'assistant' AgentMessage
 * per model turn (it feeds the full text into StateDetector pattern-matching
 * and an org chat-bus emission — fragmenting it would corrupt both), while
 * agent-exec.ts (the Agent Exec Protocol / mono-agent's path) wants
 * incremental text as it streams (the protocol's own §3.2 already documents
 * the `assistant` frame as "Incremental assistant text ... callers append").
 *
 * Incremental streaming is therefore opt-in via `AgentRunArgs.extras.
 * includePartialMessages` (the existing provider-specific escape hatch,
 * "other runners ignore it" per its own doc comment) — agent-exec.ts sets
 * it, session.ts never does. These tests cover both the opted-out (default,
 * matches every existing session.ts call site) and opted-in paths.
 *
 * The `queryFn` constructor param is the SDK injection seam
 * (`constructor(private queryFn: typeof query = query)`) — no real SDK/CLI
 * calls happen here.
 */

import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';

function makePrompt(text = 'hello') {
  return (async function* () {
    yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: undefined };
  })();
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    tools: [],
    prompt: makePrompt(),
    systemPrompt: '',
    cwd: '/tmp',
    env: {},
    maxTurns: 5,
    ...overrides,
  } as any;
}

describe('ClaudeAgentRunner', () => {
  it('does NOT set includePartialMessages when extras.includePartialMessages is absent (session.ts default)', async () => {
    let capturedOptions: any;
    const mockQueryFn = (args: any) => {
      capturedOptions = args.options;
      return (async function* () {
        yield {
          type: 'assistant',
          session_id: 's1',
          message: { content: [{ type: 'text', text: 'Hello world' }], usage: { input_tokens: 10, output_tokens: 5 } },
        };
        yield { type: 'result', session_id: 's1', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 };
      })();
    };
    const runner = new ClaudeAgentRunner(mockQueryFn as any);

    const messages: any[] = [];
    for await (const m of runner.run(baseArgs())) messages.push(m);

    expect(capturedOptions.includePartialMessages).toBeUndefined();
    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].text).toBe('Hello world');
    expect(assistantMsgs[0].input_tokens).toBe(10);
    expect(assistantMsgs[0].output_tokens).toBe(5);
  });

  it('sets includePartialMessages: true and streams incremental text when extras.includePartialMessages is set (agent-exec.ts opt-in)', async () => {
    let capturedOptions: any;
    const mockQueryFn = (args: any) => {
      capturedOptions = args.options;
      return (async function* () {
        yield { type: 'stream_event', session_id: 's1', event: { type: 'message_start' } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_start', index: 0 } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_stop', index: 0 } };
        yield {
          type: 'assistant',
          session_id: 's1',
          message: { content: [{ type: 'text', text: 'Hello world' }], usage: { input_tokens: 10, output_tokens: 5 } },
        };
        yield { type: 'result', session_id: 's1', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 };
      })();
    };
    const runner = new ClaudeAgentRunner(mockQueryFn as any);

    const messages: any[] = [];
    for await (const m of runner.run(baseArgs({ extras: { includePartialMessages: true } }))) messages.push(m);

    expect(capturedOptions.includePartialMessages).toBe(true);

    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    // Two incremental deltas + the final (now-empty-text) bookkeeping yield.
    expect(assistantMsgs.map((m) => m.text)).toEqual(['Hello', ' world', undefined]);
    // No duplication: the two real increments join to exactly the complete text.
    expect(assistantMsgs.map((m) => m.text ?? '').join('')).toBe('Hello world');
    // Usage lands only on the final (turn-complete) yield, never the increments.
    expect(assistantMsgs[0].input_tokens).toBeUndefined();
    expect(assistantMsgs[1].input_tokens).toBeUndefined();
    expect(assistantMsgs[2].input_tokens).toBe(10);
    expect(assistantMsgs[2].output_tokens).toBe(5);
  });

  it('reconstructs a multi-text-block turn (separated by a tool_use block) with the same \\n join as the complete message', async () => {
    const mockQueryFn = () =>
      (async function* () {
        yield { type: 'stream_event', session_id: 's1', event: { type: 'message_start' } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'First block.' } } };
        // A tool_use block (index 1) between the two text blocks — its own
        // input_json_delta events must never contribute to visible text.
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Second block.' } } };
        yield {
          type: 'assistant',
          session_id: 's1',
          message: {
            content: [
              { type: 'text', text: 'First block.' },
              { type: 'tool_use', id: 't1', name: 'x', input: { a: 1 } },
              { type: 'text', text: 'Second block.' },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        };
        yield { type: 'result', session_id: 's1', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    const runner = new ClaudeAgentRunner(mockQueryFn as any);

    const messages: any[] = [];
    for await (const m of runner.run(baseArgs({ extras: { includePartialMessages: true } }))) messages.push(m);

    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    const reconstructed = assistantMsgs.map((m) => m.text ?? '').join('');
    // Matches the complete message's own .filter(text).map(t=>t.text).join('\n').
    expect(reconstructed).toBe('First block.\nSecond block.');
  });

  it('resets block state on message_start so a NEW turn reusing a DIFFERENT block index is not joined with a stale, never-cleared index from an aborted turn', async () => {
    // The reset's job is not to "unsend" already-streamed text (impossible
    // for live streaming — once shown, it's shown, same as any chat UI)
    // but to stop cross-turn index contamination: without it, an aborted
    // turn's block 0 would still be in the map when a fresh turn's first
    // delta lands on a DIFFERENT index, and the index-sorted '\n' join
    // would incorrectly splice the old turn's leftover text back in.
    const mockQueryFn = () =>
      (async function* () {
        // Turn 1: starts streaming at index 0, then the connection drops —
        // no completing 'assistant' message ever arrives for it.
        yield { type: 'stream_event', session_id: 's1', event: { type: 'message_start' } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Stale block.' } } };
        // Turn 2: a fresh message_start, whose first text delta lands on
        // index 1 (e.g. index 0 was a leading thinking block this time).
        yield { type: 'stream_event', session_id: 's1', event: { type: 'message_start' } };
        yield { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Fresh turn.' } } };
        yield {
          type: 'assistant',
          session_id: 's1',
          message: { content: [{ type: 'text', text: 'Fresh turn.' }], usage: { input_tokens: 1, output_tokens: 1 } },
        };
        yield { type: 'result', session_id: 's1', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    const runner = new ClaudeAgentRunner(mockQueryFn as any);

    const messages: any[] = [];
    for await (const m of runner.run(baseArgs({ extras: { includePartialMessages: true } }))) messages.push(m);

    // Turn 2's own increment must be exactly "Fresh turn." — never
    // "Stale block.\nFresh turn." (which is what an un-reset blockTexts
    // map would index-sort-and-join into once index 1 arrived).
    const afterFirstMessageStart = messages.slice(1); // drop turn 1's own increment
    const turn2Text = afterFirstMessageStart
      .filter((m) => m.type === 'assistant')
      .map((m) => m.text ?? '')
      .join('');
    expect(turn2Text).toBe('Fresh turn.');
    expect(turn2Text).not.toContain('Stale');
  });

  it('opted in but no stream_event deltas ever arrived before the complete message: the diff falls back to the full text, not an empty remainder', async () => {
    // Robustness check for the diff logic itself: visibleSoFar never
    // advances (no deltas), so the complete message's full text must
    // still surface entirely via the remainder path, not get silently
    // dropped because "some" text was assumed to have already streamed.
    const mockQueryFn = () =>
      (async function* () {
        yield {
          type: 'assistant',
          session_id: 's1',
          message: { content: [{ type: 'text', text: 'Whole thing at once.' }], usage: { input_tokens: 1, output_tokens: 1 } },
        };
        yield { type: 'result', session_id: 's1', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    const runner = new ClaudeAgentRunner(mockQueryFn as any);

    const messages: any[] = [];
    for await (const m of runner.run(baseArgs({ extras: { includePartialMessages: true } }))) messages.push(m);

    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].text).toBe('Whole thing at once.');
    expect(assistantMsgs[0].input_tokens).toBe(1);
  });
});
