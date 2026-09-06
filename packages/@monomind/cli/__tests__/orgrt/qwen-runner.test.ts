/**
 * Unit tests for the Qwen Code stream-json parser (qwen-runner), built from
 * Qwen Code's public "Headless Mode" documentation event schema.
 */
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { parseQwenEvents, QwenAgentRunner } from '../../src/orgrt/qwen-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('parseQwenEvents', () => {
  it('parses an assistant message event with text content', () => {
    const r = parseQwenEvents([
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-1',
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello from qwen' }] },
      }),
    ]);
    expect(r.texts).toEqual(['Hello from qwen']);
    expect(r.sessionId).toBe('sess-1');
  });

  it('joins multiple text blocks with newlines', () => {
    const r = parseQwenEvents([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }),
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('extracts usage tokens from a result event (flat, top-level — confirmed live, not nested under message.usage.tokens)', () => {
    const r = parseQwenEvents([
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 's', usage: { input_tokens: 12, output_tokens: 34 } }),
    ]);
    expect(r.inputTokens).toBe(12);
    expect(r.outputTokens).toBe(34);
  });

  it('captures an error from a result event with subtype error', () => {
    const r = parseQwenEvents([JSON.stringify({ type: 'result', subtype: 'error', error: { message: 'quota exceeded' } })]);
    expect(r.error).toBe('quota exceeded');
  });

  it('captures a string-shaped error too', () => {
    const r = parseQwenEvents([JSON.stringify({ type: 'result', subtype: 'error', error: 'boom' })]);
    expect(r.error).toBe('boom');
  });

  it('ignores system events (no text, no crash)', () => {
    const r = parseQwenEvents([JSON.stringify({ type: 'system', subtype: 'session_start', session_id: 'sid' })]);
    expect(r.texts).toEqual([]);
    expect(r.sessionId).toBe('sid');
  });

  it('ignores blank/non-JSON lines and tolerates malformed JSON', () => {
    const r = parseQwenEvents(['', 'not json', '{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}']);
    expect(r.texts).toEqual(['x']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseQwenEvents([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `Doing it.\n${fence}` }] } }),
    ]);
    expect(r.texts).toEqual(['Doing it.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });
});

/**
 * Incremental-streaming tests (#204). The runner used to buffer ALL stdout
 * until the qwen subprocess exited, so a turn longer than session.ts's
 * 4-minute silent-stream watchdog (SILENT_SESSION_MS) yielded zero messages
 * in time — abort, retry, kill, circuit breaker. These tests prove messages
 * are yielded DURING the turn: the mock stdout iterator sleeps between
 * lines, so buffered-until-exit delivery is measurably late. Mirrors the
 * template in codex-runner.test.ts/antigravity-runner.test.ts (#204's own
 * referenced examples).
 */
describe('QwenAgentRunner streaming (#204)', () => {
  let runner: QwenAgentRunner;

  beforeEach(() => {
    runner = new QwenAgentRunner('/usr/local/bin/qwen');
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
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild([
        {
          line: JSON.stringify({
            type: 'assistant',
            session_id: 'q1',
            message: { content: [{ type: 'text', text: 'working on it' }] },
          }),
          delayMs: 200,
        },
        {
          line: JSON.stringify({
            type: 'assistant',
            session_id: 'q1',
            message: { content: [{ type: 'text', text: 'all done' }] },
          }),
          delayMs: 400,
        },
        {
          line: JSON.stringify({
            type: 'result',
            subtype: 'success',
            session_id: 'q1',
            usage: { input_tokens: 10, output_tokens: 5 },
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

    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['working on it', 'all done']);

    // THE regression guard: the first assistant text must arrive well
    // BEFORE the subprocess exits (the mock sleeps 400ms after the first
    // line before printing the second). Under the old buffered design every
    // message arrived at process exit.
    const firstAssistantIdx = messages.findIndex((m) => m.type === 'assistant');
    expect(end - times[firstAssistantIdx]).toBeGreaterThanOrEqual(350);

    const result = messages.find((m) => m.type === 'result');
    expect(result?.subtype).toBe('success');
    expect(result?.session_id).toBe('q1');
    expect(result?.input_tokens).toBe(10);
  }, 15000);

  it('fence protocol: executes tool_call fences and feeds results back into the SAME session', async () => {
    const fenceTurn = makeDelayedMockChild([
      {
        line: JSON.stringify({
          type: 'assistant',
          session_id: 'session-fence-1',
          message: {
            content: [
              {
                type: 'text',
                text: 'Sending now.\n```tool_call\n{"name":"org_echo","arguments":{"text":"hi"}}\n```',
              },
            ],
          },
        }),
      },
      { line: JSON.stringify({ type: 'result', subtype: 'success', session_id: 'session-fence-1', usage: { input_tokens: 5, output_tokens: 2 } }) },
    ]);
    const finalTurn = makeDelayedMockChild([
      {
        line: JSON.stringify({
          type: 'assistant',
          session_id: 'session-fence-1',
          message: { content: [{ type: 'text', text: 'final answer' }] },
        }),
      },
      { line: JSON.stringify({ type: 'result', subtype: 'success', session_id: 'session-fence-1', usage: { input_tokens: 7, output_tokens: 3 } }) },
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

    expect(handled).toEqual(['hi']);
    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toContain('Sending now.');
    expect(texts).toContain('final answer');
    expect(texts.every((t) => !t?.includes('tool_call'))).toBe(true);

    // Two CLI invocations: first WITHOUT --resume (fresh session), second
    // WITH --resume session-fence-1 and the tool_result prompt.
    const calls = vi.mocked(cp.spawn).mock.calls;
    expect(calls).toHaveLength(2);
    const argv0 = calls[0][1] as string[];
    expect(argv0).not.toContain('--resume');
    const argv1 = calls[1][1] as string[];
    expect(argv1[argv1.indexOf('--resume') + 1]).toBe('session-fence-1');
    const prompt1 = argv1[argv1.indexOf('-p') + 1];
    expect(prompt1).toContain('tool_result');
    expect(prompt1).toContain('echo:hi');

    const results = messages.filter((m) => m.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe('session-fence-1');
    expect(results[0].input_tokens).toBe(12);
  }, 15000);

  it('classifies auth/permission failures as FATAL (non-retryable)', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild(
        [
          {
            line: JSON.stringify({ type: 'result', subtype: 'error', error: 'auth_error: 401 Unauthorized' }),
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
    expect(String(caught)).toContain('qwen failed (exit 1)');
    expect(caught.fatal).toBeUndefined();
  });
});
