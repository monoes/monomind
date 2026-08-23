/**
 * Unit tests for AntigravityAgentRunner.
 *
 * Tests the agy CLI subprocess protocol parsing without requiring the actual
 * agy binary — mocks child_process.spawn and feeds it scripted NDJSON events
 * matching agy 0.35.0's real wire format (verified against a live `agy -p`
 * invocation, not the headless docs page — see antigravity-runner.ts header
 * comment for the discrepancy this caught).
 *
 * Each line is { "event": "init" | "step_update" | "result", ... } with the
 * actual payload nested under a key matching the event name — EXCEPT init's
 * conversation_id, which is a sibling of "event"/"init", not nested inside
 * "init". A prior version of this file (and the runner) assumed a flat
 * `{ type: 'step_update', step_type: ..., text_delta: ... }` shape, which
 * silently matched nothing against the real CLI and dropped all output.
 */

import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AntigravityAgentRunner } from '../orgrt/antigravity-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** Create a mock child process that emits the given NDJSON lines on stdout. */
function makeMockChild(stdoutLines: string[], exitCode = 0): cp.ChildProcess {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stdout[Symbol.asyncIterator] = async function* () {
    for (const line of stdoutLines) {
      yield Buffer.from(`${line}\n`);
    }
  };
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => child.emit('close', exitCode), 5);
  return child as cp.ChildProcess;
}

describe('AntigravityAgentRunner', () => {
  let runner: AntigravityAgentRunner;

  beforeEach(() => {
    runner = new AntigravityAgentRunner('/usr/local/bin/agy');
    vi.clearAllMocks();
  });

  it('builds correct argv: agy -p <prompt> --output-format stream-json', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({
          event: 'init',
          conversation_id: 'c1',
          init: { model: 'gemini-3.6-flash-high' },
        }),
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'c1',
            status: 'SUCCESS',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: 'You are a test agent',
      model: 'gemini-3.6-flash-high',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    for await (const _m of gen) {
      /* consume */
    }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[0]).toBe('/usr/local/bin/agy');
    expect(spawnArgs[1]).toContain('-p');
    expect(spawnArgs[1]).toContain('--output-format');
    expect(spawnArgs[1]).toContain('stream-json');
    expect(spawnArgs[1]).toContain('--model');
    expect(spawnArgs[1]).toContain('gemini-3.6-flash-high');
    expect(spawnArgs[1]).toContain('--dangerously-skip-permissions');
  });

  it('captures conversation_id from init event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'test-conv-123', init: {} }),
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'test-conv-123',
            status: 'SUCCESS',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const resultMsg = messages.find((m) => m.type === 'result');
    expect(resultMsg.session_id).toBe('test-conv-123');
  });

  it('accumulates agent_response text_delta into one message', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: 'c1',
            step_type: 'agent_response',
            state: 'ACTIVE',
            text_delta: 'Hello',
          },
        }),
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: 'c1',
            step_type: 'agent_response',
            state: 'ACTIVE',
            text_delta: ' world',
          },
        }),
        JSON.stringify({
          event: 'step_update',
          step_update: { conversation_id: 'c1', step_type: 'agent_response', state: 'DONE' },
        }),
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'c1',
            status: 'SUCCESS',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    // agy streams per-token; the runner accumulates deltas per agent_response
    // step and emits one clean message at the step's DONE boundary (fence
    // stripping needs the full text — per-token deltas would split fences
    // across events).
    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].text).toBe('Hello world');
  });

  it('extracts usage from result event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'c1',
            status: 'SUCCESS',
            usage: {
              input_tokens: 1500,
              output_tokens: 320,
              thinking_tokens: 50,
              cache_read_tokens: 200,
              total_tokens: 2070,
            },
          },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const resultMsg = messages.find((m) => m.type === 'result');
    expect(resultMsg.input_tokens).toBe(1500);
    expect(resultMsg.output_tokens).toBe(320);
  });

  it('surfaces error from non-SUCCESS result status', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
        JSON.stringify({
          event: 'result',
          result: { conversation_id: 'c1', status: 'ERROR', error: 'model not found' },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    let caught: any;
    try {
      for await (const m of gen) messages.push(m);
    } catch (err) {
      caught = err;
    }
    // Partial liveness may already have been yielded before the error
    // surfaces at end of turn — the thrown error still carries it.
    expect(String(caught)).toContain('model not found');
  });

  it('uses --conversation flag when conversationId provided', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'existing-conv', init: {} }),
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'existing-conv',
            status: 'SUCCESS',
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'follow up';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
      resume: 'existing-conv',
    });

    for await (const _m of gen) {
      /* consume */
    }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[1]).toContain('--conversation');
    expect(spawnArgs[1]).toContain('existing-conv');
  });

  it('throws ENOENT error with install guidance when agy binary missing', async () => {
    vi.mocked(cp.spawn).mockImplementation(() => {
      const err = new Error('spawn agy ENOENT') as any;
      err.code = 'ENOENT';
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stdout[Symbol.asyncIterator] = async function* () {
        /* empty */
      };
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      setTimeout(() => child.emit('error', err), 1);
      return child;
    });

    const runner = new AntigravityAgentRunner('agy');
    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    // The spawn-time liveness message is yielded first (it wins session.ts's
    // watchdog race); the spawn error surfaces when the stream is drained.
    let caught: any;
    try {
      for await (const _m of gen) {
        /* consume */
      }
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).toContain('requires the Antigravity CLI');
  });

  it('falls back to result.response when no text_delta streamed', async () => {
    // Some agy versions may not stream text_delta and only return final response.
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'c1',
            status: 'SUCCESS',
            response: 'Final response text',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const assistantMsg = messages.find((m) => m.type === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.text).toBe('Final response text');
  });

  it('strips tool_call fences from streamed text (no tools registered → error result → clean second turn)', async () => {
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(
        makeMockChild([
          JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
          JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'c1',
              step_type: 'agent_response',
              state: 'ACTIVE',
              text_delta:
                'Sending...\n\n```tool_call\n{"name": "org_send", "arguments": {"to": "boss"}}\n```',
            },
          }),
          JSON.stringify({
            event: 'result',
            result: {
              conversation_id: 'c1',
              status: 'SUCCESS',
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          }),
        ]),
      )
      .mockReturnValueOnce(
        makeMockChild([
          JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
          JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'c1',
              step_type: 'agent_response',
              state: 'ACTIVE',
              text_delta: 'Done.',
            },
          }),
          JSON.stringify({
            event: 'result',
            result: {
              conversation_id: 'c1',
              status: 'SUCCESS',
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          }),
        ]),
      );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'hello';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    // First assistant message should not contain tool_call fences
    const firstAssistant = messages.find((m) => m.type === 'assistant' && m.text === 'Sending...');
    expect(firstAssistant).toBeDefined();
    expect(firstAssistant.text).not.toContain('tool_call');

    const doneMsg = messages.find((m) => m.type === 'assistant' && m.text === 'Done.');
    expect(doneMsg).toBeDefined();
  }, 15000);

  it('matches the exact live agy 0.35.0 NDJSON shape (regression guard)', async () => {
    // Captured verbatim from `agy -p "reply with exactly: PING_OK" --model
    // gemini-3.6-flash-high --output-format stream-json
    // --dangerously-skip-permissions` — pins the wire format so a future
    // agy update that reshapes events fails this test loudly instead of
    // silently dropping all output like the original bug did.
    vi.mocked(cp.spawn).mockReturnValue(
      makeMockChild([
        '{"event":"init","conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","init":{"model":"gemini-3.6-flash-high","cwd":"/tmp","tools":["finish"],"permission_mode":"always-proceed"}}',
        '{"event":"step_update","step_update":{"conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","step_index":0,"state":"DONE","step_type":"user_input"}}',
        '{"event":"step_update","step_update":{"conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"PING_OK\\n","duration_seconds":1.017427,"usage":{"input_tokens":8032,"output_tokens":31,"thinking_tokens":28,"cache_read_tokens":8141,"total_tokens":8063}}}',
        '{"event":"result","result":{"conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","status":"SUCCESS","response":"PING_OK\\n","duration_seconds":1.714006,"num_turns":1,"usage":{"input_tokens":8132,"output_tokens":35,"thinking_tokens":28,"cache_read_tokens":8141,"total_tokens":8167}}}',
      ]),
    );

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'reply with exactly: PING_OK';
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const assistantMsg = messages.find((m) => m.type === 'assistant');
    expect(assistantMsg?.text).toBe('PING_OK');
    const resultMsg = messages.find((m) => m.type === 'result');
    expect(resultMsg.input_tokens).toBe(8132);
    expect(resultMsg.output_tokens).toBe(35);
  });
});

/**
 * Incremental-streaming tests. The runner used to buffer ALL stdout until
 * the agy subprocess exited, so a turn longer than session.ts's 4-minute
 * silent-stream watchdog (SILENT_SESSION_MS) yielded zero messages in time —
 * abort, retry, kill, circuit breaker. These tests prove messages are yielded
 * DURING the turn: the mock stdout iterator sleeps between lines, so
 * buffered-until-exit delivery is measurably late.
 */
describe('AntigravityAgentRunner streaming', () => {
  let runner: AntigravityAgentRunner;

  beforeEach(() => {
    runner = new AntigravityAgentRunner('/usr/local/bin/agy');
    vi.clearAllMocks();
  });

  /** Mock child whose stdout lines are emitted with per-line delays; 'close'
   *  fires after the last line. */
  function makeDelayedMockChild(
    lines: Array<{ line: string; delayMs?: number }>,
    exitCode = 0,
  ): cp.ChildProcess {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stdout[Symbol.asyncIterator] = async function* () {
      for (const { line, delayMs = 0 } of lines) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        yield Buffer.from(`${line}\n`);
      }
    };
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const total = lines.reduce((s, l) => s + (l.delayMs ?? 0), 0);
    setTimeout(() => child.emit('close', exitCode), total + 50);
    return child as cp.ChildProcess;
  }

  function makeRunArgs(overrides?: Record<string, unknown>) {
    return {
      tools: [],
      prompt: (async function* () {
        yield 'do work';
      })(),
      systemPrompt: 'test role',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
      ...overrides,
    } as any;
  }

  it('yields a liveness message immediately, then streams messages DURING the turn (not after exit)', async () => {
    const step = (state: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'c1', step_type: 'agent_response', state, ...extra },
      });
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild([
        { line: JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }) },
        // Model "thinking", then first text…
        { line: step('ACTIVE', { text_delta: 'working on it' }), delayMs: 200 },
        // …a tool step…
        {
          line: JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'c1',
              step_type: 'tool',
              state: 'ACTIVE',
              tool_info: { name: 'read_file' },
            },
          }),
          delayMs: 200,
        },
        // …the DONE boundary flushes the first text…
        { line: step('DONE'), delayMs: 200 },
        // …then a LONG tail (e.g. reading a large dossier) before the final text.
        { line: step('ACTIVE', { text_delta: 'all done' }), delayMs: 500 },
        { line: step('DONE') },
        {
          line: JSON.stringify({
            event: 'result',
            result: {
              conversation_id: 'c1',
              status: 'SUCCESS',
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          }),
        },
      ]),
    );

    const start = Date.now();
    const messages: any[] = [];
    const times: number[] = [];
    for await (const m of runner.run(makeRunArgs())) {
      messages.push(m);
      times.push(Date.now());
    }
    const end = Date.now();

    // First message must be the spawn-time liveness yield — this is what
    // deterministically wins session.ts's first-pull watchdog race.
    expect(messages[0]).toEqual({ type: 'tool_use', session_id: undefined, text: 'turn started' });
    expect(times[0] - start).toBeLessThan(300);

    // Tool steps arrive as tool_use liveness messages.
    const toolMsgs = messages.filter((m) => m.type === 'tool_use');
    expect(toolMsgs.some((m) => m.text === 'read_file')).toBe(true);

    // Assistant text flushes at DONE boundaries, fence-stripped.
    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['working on it', 'all done']);

    // THE regression guard: the first assistant text must arrive well BEFORE
    // the subprocess exits (the mock sleeps 500ms after the first DONE before
    // printing the final lines). Under the old buffered design every message
    // arrived at process exit.
    const firstAssistantIdx = messages.findIndex((m) => m.type === 'assistant');
    expect(end - times[firstAssistantIdx]).toBeGreaterThanOrEqual(350);

    // The synthesized result carries the captured conversation id + usage.
    const result = messages.find((m) => m.type === 'result');
    expect(result?.subtype).toBe('success');
    expect(result?.session_id).toBe('c1');
    expect(result?.input_tokens).toBe(10);
  }, 15000);

  it('does not double-count text when a DONE step repeats the full step text after ACTIVE deltas', async () => {
    const step = (state: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'c1', step_type: 'agent_response', state, ...extra },
      });
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild([
        { line: step('ACTIVE', { text_delta: 'Hello' }) },
        { line: step('ACTIVE', { text_delta: ' world' }) },
        // DONE carrying the FULL text (not a delta) must replace, not append.
        { line: step('DONE', { text_delta: 'Hello world' }) },
        {
          line: JSON.stringify({
            event: 'result',
            result: { conversation_id: 'c1', status: 'SUCCESS', usage: {} },
          }),
        },
      ]),
    );

    const messages: any[] = [];
    for await (const m of runner.run(makeRunArgs())) messages.push(m);

    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['Hello world']);
  });

  it('fence protocol: executes tool_call fences and feeds results back into the SAME conversation', async () => {
    const fenceTurn = makeDelayedMockChild([
      { line: JSON.stringify({ event: 'init', conversation_id: 'conv-fence-1', init: {} }) },
      {
        line: JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: 'conv-fence-1',
            step_type: 'agent_response',
            state: 'DONE',
            text_delta:
              'Sending now.\n```tool_call\n{"name":"org_echo","arguments":{"text":"hi"}}\n```',
          },
        }),
      },
      {
        line: JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'conv-fence-1',
            status: 'SUCCESS',
            usage: { input_tokens: 5, output_tokens: 2 },
          },
        }),
      },
    ]);
    const finalTurn = makeDelayedMockChild([
      {
        line: JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: 'conv-fence-1',
            step_type: 'agent_response',
            state: 'DONE',
            text_delta: 'final answer',
          },
        }),
      },
      {
        line: JSON.stringify({
          event: 'result',
          result: {
            conversation_id: 'conv-fence-1',
            status: 'SUCCESS',
            usage: { input_tokens: 7, output_tokens: 3 },
          },
        }),
      },
    ]);
    vi.mocked(cp.spawn).mockReturnValueOnce(fenceTurn).mockReturnValueOnce(finalTurn);

    const handled: string[] = [];
    const args = makeRunArgs({
      tools: [
        {
          name: 'org_echo',
          description: 'echo text back',
          schema: { text: z.string() },
          handler: async (a: any) => {
            handled.push(String(a.text));
            return { text: `echo:${a.text}` };
          },
        },
      ],
    });
    const messages: any[] = [];
    for await (const m of runner.run(args)) messages.push(m);

    // The OrgToolDef handler ran in-process with the fence's arguments…
    expect(handled).toEqual(['hi']);
    // …and both turns' prose was yielded, fence-stripped.
    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toContain('Sending now.');
    expect(texts).toContain('final answer');
    expect(texts.every((t) => !t?.includes('tool_call'))).toBe(true);

    // Two CLI invocations: first WITHOUT --conversation (fresh session),
    // second WITH --conversation conv-fence-1 and the tool_result prompt.
    const calls = vi.mocked(cp.spawn).mock.calls;
    expect(calls).toHaveLength(2);
    const argv0 = calls[0][1] as string[];
    expect(argv0).not.toContain('--conversation');
    const argv1 = calls[1][1] as string[];
    expect(argv1[argv1.indexOf('--conversation') + 1]).toBe('conv-fence-1');
    const prompt1 = argv1[argv1.indexOf('-p') + 1];
    expect(prompt1).toContain('tool_result');
    expect(prompt1).toContain('echo:hi');

    // One synthesized result per mailbox prompt, usage summed across rounds.
    const results = messages.filter((m) => m.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe('conv-fence-1');
    expect(results[0].input_tokens).toBe(12);
  }, 15000);

  it('classifies auth/permission failures as FATAL (non-retryable)', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild(
        [
          {
            line: JSON.stringify({
              event: 'result',
              result: {
                conversation_id: 'c1',
                status: 'ERROR',
                error: 'auth_error: 401 Unauthorized',
              },
            }),
          },
        ],
        1,
      ),
    );

    let caught: any;
    try {
      for await (const _m of runner.run(makeRunArgs())) {
        /* consume */
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toContain('FATAL');
    expect(caught.fatal).toBe(true);
  });

  it('leaves transient failures retryable (no fatal flag)', async () => {
    const child = makeDelayedMockChild([], 1);
    // Generic stderr, no auth/quota markers.
    setTimeout(
      () => (child.stderr as EventEmitter).emit('data', Buffer.from('connection reset by peer')),
      5,
    );
    vi.mocked(cp.spawn).mockReturnValue(child);

    let caught: any;
    try {
      for await (const _m of runner.run(makeRunArgs())) {
        /* consume */
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toContain('agy failed (exit 1)');
    expect(caught.fatal).toBeUndefined();
  });
});
