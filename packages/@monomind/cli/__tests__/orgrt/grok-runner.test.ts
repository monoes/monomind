/**
 * Unit tests for the Grok Build CLI NDJSON parser (grok-runner).
 *
 * These fixtures are built from grok-runner.ts's documented (not
 * live-captured) event-shape assumptions — see the runner's header comment
 * for why the parser tolerates multiple plausible shapes.
 */
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrokAgentRunner, parseGrokEvents } from '../../src/orgrt/grok-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('parseGrokEvents', () => {
  it('parses a codex-style item.completed/agent_message event', () => {
    const r = parseGrokEvents([
      '{"type":"thread.started","thread_id":"th_123"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
    ]);
    expect(r.texts).toEqual(['Hello']);
    expect(r.sessionId).toBe('th_123');
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(5);
  });

  it('parses a flat role:assistant shape with string content', () => {
    const r = parseGrokEvents(['{"role":"assistant","content":"hi there","session_id":"s1"}']);
    expect(r.texts).toEqual(['hi there']);
    expect(r.sessionId).toBe('s1');
  });

  it('parses a flat role:assistant shape with block-form content', () => {
    const r = parseGrokEvents([
      '{"role":"assistant","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}',
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('parses a flat type:assistant shape', () => {
    const r = parseGrokEvents(['{"type":"assistant","text":"flat text","sessionId":"s2"}']);
    expect(r.texts).toEqual(['flat text']);
    expect(r.sessionId).toBe('s2');
  });

  it('falls back to prompt_tokens/completion_tokens usage naming', () => {
    const r = parseGrokEvents(['{"type":"result","usage":{"prompt_tokens":3,"completion_tokens":7}}']);
    expect(r.inputTokens).toBe(3);
    expect(r.outputTokens).toBe(7);
  });

  it('captures an error message from a turn.failed event', () => {
    const r = parseGrokEvents(['{"type":"turn.failed","error":{"message":"boom"}}']);
    expect(r.error).toBe('boom');
  });

  it('ignores non-JSON and blank lines without throwing', () => {
    const r = parseGrokEvents(['', 'not json', '{"role":"assistant","content":"ok"}']);
    expect(r.texts).toEqual(['ok']);
  });

  it('tolerates malformed JSON lines', () => {
    const r = parseGrokEvents(['{"role":"assistant"', '{"role":"assistant","content":"good"}']);
    expect(r.texts).toEqual(['good']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    const r = parseGrokEvents([JSON.stringify({ role: 'assistant', content: `Sending now.\n${fence}` })]);
    expect(r.texts).toEqual(['Sending now.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });

  it('returns no session id and zero usage when nothing carries one', () => {
    const r = parseGrokEvents(['{"role":"assistant","content":"x"}']);
    expect(r.sessionId).toBeUndefined();
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
  });
});

/**
 * Incremental-streaming tests (#204). The runner used to buffer ALL stdout
 * until the grok subprocess exited, so a turn longer than session.ts's
 * 4-minute silent-stream watchdog (SILENT_SESSION_MS) yielded zero messages
 * in time — abort, retry, kill, circuit breaker. These tests prove messages
 * are yielded DURING the turn: the mock stdout iterator sleeps between
 * lines, so buffered-until-exit delivery is measurably late. Mirrors the
 * template in codex-runner.test.ts / antigravity-runner.test.ts (#204's own
 * referenced examples).
 */
describe('GrokAgentRunner streaming (#204)', () => {
  let runner: GrokAgentRunner;

  beforeEach(() => {
    runner = new GrokAgentRunner('/usr/local/bin/grok');
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
        // Model "thinking", then a first chunk of prose…
        {
          line: JSON.stringify({ role: 'assistant', content: 'working on it', session_id: 's1' }),
          delayMs: 200,
        },
        // …then a LONG tail (e.g. grok finishing up) before the process
        // actually exits — the regression guard below proves the assistant
        // text was NOT held back until this point.
        {
          line: JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 5 } }),
          delayMs: 500,
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
    expect(texts).toEqual(['working on it']);

    // THE regression guard: the assistant text must arrive well BEFORE the
    // subprocess exits (the mock sleeps 500ms after it before the result
    // event). Under the old buffered design every message arrived at
    // process exit.
    const firstAssistantIdx = messages.findIndex((m) => m.type === 'assistant');
    expect(end - times[firstAssistantIdx]).toBeGreaterThanOrEqual(150);

    // The synthesized result carries the captured session id + usage.
    const result = messages.find((m) => m.type === 'result');
    expect(result?.subtype).toBe('success');
    expect(result?.session_id).toBe('s1');
    expect(result?.input_tokens).toBe(10);
  }, 15000);

  it('classifies auth/permission failures as FATAL (non-retryable)', async () => {
    const child = makeDelayedMockChild([], 1);
    setTimeout(
      () => (child.stderr as EventEmitter).emit('data', Buffer.from('auth_error: 401 Unauthorized')),
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
    expect(String(caught)).toContain('grok failed (exit 1)');
    expect(caught.fatal).toBeUndefined();
  });
});
