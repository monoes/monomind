/**
 * Unit tests for the Crush CLI plain-text output parser and the streaming
 * runner behavior (crush-runner).
 */
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { CrushAgentRunner, parseCrushOutput } from '../../src/orgrt/crush-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('parseCrushOutput', () => {
  it('trims surrounding whitespace', () => {
    const r = parseCrushOutput('\n\n  hello world  \n\n');
    expect(r.text).toBe('hello world');
    expect(r.rawText).toBe('hello world');
  });

  it('strips tool_call fences from text but keeps rawText', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    const r = parseCrushOutput(`Sending now.\n${fence}`);
    expect(r.text).toBe('Sending now.');
    expect(r.rawText).toContain('tool_call');
  });

  it('returns empty text when output is entirely a tool_call fence', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseCrushOutput(fence);
    expect(r.text).toBe('');
    expect(r.rawText).toContain('tool_call');
  });

  it('handles empty output without throwing', () => {
    const r = parseCrushOutput('');
    expect(r.text).toBe('');
    expect(r.rawText).toBe('');
  });
});

/**
 * Incremental-streaming tests (#204). The runner used to buffer ALL of
 * crush's stdout in a local variable until the subprocess closed, so a turn
 * longer than session.ts's 4-minute silent-stream watchdog
 * (SILENT_SESSION_MS) yielded zero messages in time — abort, retry, kill,
 * circuit breaker. These tests prove messages are yielded DURING the turn:
 * the mock stdout iterator sleeps between lines, so buffered-until-close
 * delivery is measurably late. Mirrors codex-runner.test.ts's own template
 * (#204's referenced example) adapted to crush's plain-text (no JSON event)
 * output shape.
 */
describe('CrushAgentRunner streaming (#204)', () => {
  let runner: CrushAgentRunner;

  beforeEach(() => {
    runner = new CrushAgentRunner({ crushBin: '/usr/local/bin/crush' });
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

  it('yields a liveness message immediately, then streams assistant lines DURING the turn (not after exit)', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild([
        { line: 'Working on it...' },
        { line: 'still going', delayMs: 200 },
        { line: 'all done', delayMs: 200 },
        // A long BLANK tail after the last visible line, before the process
        // actually exits (blank lines yield no assistant event) — the
        // regression guard below proves 'all done' was NOT held back until
        // process close.
        { line: '', delayMs: 500 },
      ]),
    );

    const start = Date.now();
    const messages: any[] = [];
    const times: number[] = [];
    for await (const m of runner.run(makeRunArgs())) {
      messages.push(m);
      times.push(Date.now());
    }

    // First message must be the spawn-time liveness yield — this is what
    // deterministically wins session.ts's first-pull watchdog race.
    expect(messages[0]).toEqual({ type: 'tool_use', text: 'turn started' });
    expect(times[0] - start).toBeLessThan(300);

    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['Working on it...', 'still going', 'all done']);

    // THE regression guard: the last visible line must arrive well BEFORE
    // the subprocess exits (the mock sleeps another 500ms, printing only a
    // blank line, before closing). Under the old buffered design every
    // message arrived at process exit.
    const end = Date.now();
    const lastAssistantIdx = messages.findIndex((m) => m.text === 'all done');
    expect(end - times[lastAssistantIdx]).toBeGreaterThanOrEqual(200);

    const result = messages.find((m) => m.type === 'result');
    expect(result?.subtype).toBe('success');
  }, 15000);

  it('withholds tool_call fence lines from the assistant stream, forwards the fence open as tool_use liveness, and executes the call', async () => {
    const fenceTurn = makeDelayedMockChild([
      { line: 'Sending now.' },
      { line: '```tool_call' },
      { line: '{"name":"org_echo","arguments":{"text":"hi"}}' },
      { line: '```' },
    ]);
    const finalTurn = makeDelayedMockChild([{ line: 'final answer' }]);
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
    // …the fence's opening line was forwarded as tool_use liveness…
    expect(messages.some((m) => m.type === 'tool_use' && m.text === 'tool_call')).toBe(true);
    // …and the fence's own lines never leaked into the visible assistant text.
    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toContain('Sending now.');
    expect(texts).toContain('final answer');
    expect(texts.some((t) => t?.includes('tool_call') || t?.includes('org_echo'))).toBe(false);

    // Second invocation resumes the session via --continue.
    const calls = vi.mocked(cp.spawn).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).not.toContain('--continue');
    expect(calls[1][1]).toContain('--continue');
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
    expect(String(caught)).toContain('crush run failed (exit 1)');
    expect(caught.fatal).toBeUndefined();
  });
});
