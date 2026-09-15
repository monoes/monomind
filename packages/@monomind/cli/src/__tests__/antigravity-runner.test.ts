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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AntigravityAgentRunner, computeSafeChunk } from '../orgrt/antigravity-runner.js';

/**
 * computeSafeChunk is the fence-boundary-aware cursor behind incremental
 * streaming: given the full text accumulated so far for one agent_response
 * step and how much of it has already been shown, it returns how much MORE
 * is now safe to show — never inside an unclosed ```tool_call fence, and
 * never ending on a partial match of the "```tool_call" opening marker
 * (which could still turn into a real fence as more text arrives next).
 */
describe('computeSafeChunk', () => {
  it('treats plain text with no backticks at all as fully safe', () => {
    const { chunk, safeEnd } = computeSafeChunk('hello world', 0);
    expect(chunk).toBe('hello world');
    expect(safeEnd).toBe(11);
  });

  it('returns nothing new when called again at the same position', () => {
    const text = 'hello world';
    const { chunk, safeEnd } = computeSafeChunk(text, text.length);
    expect(chunk).toBe('');
    expect(safeEnd).toBe(text.length);
  });

  it('only returns the NEW portion since flushedUpTo, not the whole text again', () => {
    const { chunk, safeEnd } = computeSafeChunk('hello world', 6);
    expect(chunk).toBe('world');
    expect(safeEnd).toBe(11);
  });

  it('holds back a trailing partial prefix of the fence marker', () => {
    // "``" could still become "```tool_call" once more text arrives.
    const { chunk, safeEnd } = computeSafeChunk('hello ``', 0);
    expect(chunk).toBe('hello ');
    expect(safeEnd).toBe(6);
  });

  it('holds back progressively longer partial prefixes as the marker builds up', () => {
    expect(computeSafeChunk('x```', 0)).toEqual({ chunk: 'x', safeEnd: 1 });
    expect(computeSafeChunk('x```t', 0)).toEqual({ chunk: 'x', safeEnd: 1 });
    expect(computeSafeChunk('x```tool_ca', 0)).toEqual({ chunk: 'x', safeEnd: 1 });
  });

  it('releases held-back text the moment it can no longer become the marker', () => {
    // "```py" diverges from "```tool_call" at the 4th character (p vs t) —
    // it can never become a tool_call fence, so nothing needs holding back
    // (a legitimate ```python code fence must stream normally).
    const { chunk, safeEnd } = computeSafeChunk('```python', 0);
    expect(chunk).toBe('```python');
    expect(safeEnd).toBe(9);
  });

  it('does not surface any text inside a fence that opened but has not closed yet', () => {
    const text = 'Sending.\n```tool_call\n{"name":"x"}';
    const { chunk, safeEnd } = computeSafeChunk(text, 0);
    expect(chunk).toBe('Sending.\n');
    expect(safeEnd).toBe('Sending.\n'.length);
  });

  it('skips a complete fence entirely and resumes safety scanning right after its closing fence', () => {
    // One newline before the fence, one after its closing ``` — both are
    // real text either side of the excised fence and are preserved as-is;
    // computeSafeChunk does no trimming of its own.
    const text = 'Sending.\n```tool_call\n{"name":"x"}\n```\nDone.';
    const { chunk, safeEnd } = computeSafeChunk(text, 0);
    expect(chunk).toBe('Sending.\n\nDone.');
    expect(chunk).not.toContain('tool_call');
    expect(safeEnd).toBe(text.length);
  });

  it('handles a fence delivered across many small incremental calls the same as one big call', () => {
    const full = 'Before.\n```tool_call\n{"a":1}\n```\nAfter.';
    // Feed it one character at a time, exactly like real per-token deltas.
    let flushedUpTo = 0;
    let assembled = '';
    for (let i = 1; i <= full.length; i++) {
      const { chunk, safeEnd } = computeSafeChunk(full.slice(0, i), flushedUpTo);
      assembled += chunk;
      flushedUpTo = safeEnd;
    }
    expect(assembled).toBe('Before.\n\nAfter.');
    // Must match a single non-incremental call over the complete text too.
    expect(assembled).toBe(computeSafeChunk(full, 0).chunk);
  });

  it('a fence that never closes leaves everything from its opening withheld (final flush handles it, matching TOOL_CALL_RE leaving an unclosed fence untouched)', () => {
    const text = 'Before.\n```tool_call\n{"a":1}';
    const { chunk, safeEnd } = computeSafeChunk(text, 0);
    expect(chunk).toBe('Before.\n');
    expect(safeEnd).toBe('Before.\n'.length);
  });
});

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

  it('streams each fence-safe agent_response text_delta as its own incremental message instead of buffering to DONE', async () => {
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
      // Opts into incremental streaming — agent-exec.ts's own call site sets
      // this; session.ts (the org runtime) never does, and must keep getting
      // exactly one message per step (see the "defaults to buffered" test).
      extras: { includePartialMessages: true },
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    // agy streams per-token; this is the whole point of computeSafeChunk —
    // each delta reaches the caller as soon as it arrives (real-time
    // streaming), not buffered until the step's DONE boundary. Fence safety
    // is what still needs the full accumulated text, and that is what
    // computeSafeChunk's own withholding logic (tested separately above)
    // exists to preserve incrementally rather than by buffering everything.
    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    expect(assistantMsgs.map((m) => m.text)).toEqual(['Hello', ' world']);
    expect(assistantMsgs.map((m) => m.text).join('')).toBe('Hello world');
  });

  it('without extras.includePartialMessages, buffers to the DONE boundary exactly like before incremental streaming existed (session.ts default)', async () => {
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
          result: { conversation_id: 'c1', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } },
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
      // No extras — this is session.ts's shape.
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const assistantMsgs = messages.filter((m) => m.type === 'assistant');
    expect(assistantMsgs.map((m) => m.text)).toEqual(['Hello world']);
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
    for await (const m of runner.run(makeRunArgs({ extras: { includePartialMessages: true } }))) messages.push(m);

    // 'Hello' and ' world' each stream as their own increment (as soon as
    // their ACTIVE delta arrives); the DONE step's repeat of the full text
    // must not add a THIRD, duplicate message on top of those two.
    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['Hello', ' world']);
    expect(texts.join('')).toBe('Hello world');
  });

  it('without extras.includePartialMessages, multiple ACTIVE deltas within one step still collapse into a single DONE-boundary message (session.ts default)', async () => {
    const step = (state: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'c1', step_type: 'agent_response', state, ...extra },
      });
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild([
        { line: step('ACTIVE', { text_delta: 'Hello' }) },
        { line: step('ACTIVE', { text_delta: ' world' }) },
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
    for await (const m of runner.run(makeRunArgs())) messages.push(m); // no extras — session.ts's shape

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

/**
 * Child-process kill ladder (same findings as codex/kimi): the SIGKILL
 * escalation must survive stdout ending, and an abandoned stream must
 * escalate SIGTERM→SIGKILL instead of sending a bare SIGTERM.
 */
describe('AntigravityAgentRunner subprocess kill ladder', () => {
  let runner: AntigravityAgentRunner;

  beforeEach(() => {
    runner = new AntigravityAgentRunner('/usr/bin/agy');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRunArgs() {
    return {
      tools: [],
      prompt: (async function* () {
        yield 'do work';
      })(),
      systemPrompt: 'test role',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    } as any;
  }

  /** A "live" mock child: stdout stays open until the fake CLI decides to
   *  close it; `onKill` scripts what it does with each signal. */
  function makeLiveMockChild(
    onKill: (child: any, signal: string, endStdout: () => void) => void,
    stdoutLines: string[] = [],
  ): cp.ChildProcess {
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    let endStdout: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      endStdout = r;
    });
    child.stdout = new EventEmitter();
    child.stdout[Symbol.asyncIterator] = async function* () {
      for (const line of stdoutLines) yield Buffer.from(`${line}\n`);
      await blocked;
    };
    child.stderr = new EventEmitter();
    child.kill = vi.fn((signal: string) => {
      child.killed = true;
      onKill(child, signal, endStdout);
      return true;
    });
    return child as cp.ChildProcess;
  }

  it('turn timeout: the SIGKILL escalation stays armed after stdout ends, so a CLI that ignores SIGTERM cannot pin the turn open forever', async () => {
    vi.useFakeTimers();
    // Fake CLI that reacts to SIGTERM by closing stdout but NOT exiting;
    // only SIGKILL ends it.
    const child = makeLiveMockChild((c, signal, endStdout) => {
      if (signal === 'SIGTERM') endStdout();
      if (signal === 'SIGKILL') {
        c.signalCode = 'SIGKILL';
        c.emit('close', null);
      }
    });
    vi.mocked(cp.spawn).mockReturnValue(child);

    const gen = runner.run(makeRunArgs())[Symbol.asyncIterator]();
    await gen.next(); // liveness
    const pending = gen.next(); // blocked in stdout
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000); // TURN_TIMEOUT_MS
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // stdout has now ended and the runner's finally has run — the
    // escalation must still fire after the grace period.
    await vi.advanceTimersByTimeAsync(5000 + 10);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(pending).rejects.toThrow(/turn timeout and was killed/);
  });

  it('abandoned stream: iterator.return() mid-turn sends SIGTERM and escalates to SIGKILL if the CLI ignores it', async () => {
    vi.useFakeTimers();
    const child = makeLiveMockChild(
      (c, signal, endStdout) => {
        // Ignores SIGTERM entirely; only SIGKILL ends it.
        if (signal === 'SIGKILL') {
          c.signalCode = 'SIGKILL';
          endStdout();
          c.emit('close', null);
        }
      },
      [JSON.stringify({ type: 'system', subtype: 'init', conversation_id: 'c1' })],
    );
    vi.mocked(cp.spawn).mockReturnValue(child);

    const gen = runner.run(makeRunArgs())[Symbol.asyncIterator]() as AsyncGenerator<any>;
    await gen.next(); // liveness — the generator is now parked at a yield
    const returned = gen.return(undefined);
    returned.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    await vi.advanceTimersByTimeAsync(5000 + 10);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await returned;
  });
});
