/**
 * Unit tests for the GitHub Copilot CLI NDJSON parser (copilot-runner) and,
 * below, for CopilotAgentRunner's incremental streaming (#204) — mirrors the
 * scope of codex-runner.test.ts's own streaming describe block.
 */
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { parseCopilotEvents, CopilotAgentRunner } from '../../src/orgrt/copilot-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('parseCopilotEvents', () => {
  it('parses an assistant.message event with string content', () => {
    const r = parseCopilotEvents(['{"type":"assistant.message","content":"hi"}']);
    expect(r.texts).toEqual(['hi']);
  });

  it('parses an assistant.message event with block-form content', () => {
    const r = parseCopilotEvents([
      JSON.stringify({ type: 'assistant.message', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('falls back to a nested message.text field', () => {
    const r = parseCopilotEvents([JSON.stringify({ kind: 'assistant', message: { text: 'nested' } })]);
    expect(r.texts).toEqual(['nested']);
  });

  it('falls back to role:assistant shape', () => {
    const r = parseCopilotEvents([JSON.stringify({ role: 'assistant', content: 'role-shaped' })]);
    expect(r.texts).toEqual(['role-shaped']);
  });

  it('ignores non-assistant events (tool/system) without throwing', () => {
    const r = parseCopilotEvents([
      JSON.stringify({ type: 'tool.execution', content: 'ls' }),
      JSON.stringify({ type: 'assistant.message', content: 'done' }),
    ]);
    expect(r.texts).toEqual(['done']);
  });

  it('ignores blank/non-JSON lines and tolerates malformed JSON', () => {
    const r = parseCopilotEvents(['', 'not json', '{"type":"assistant.message"', '{"type":"assistant.message","content":"ok"}']);
    expect(r.texts).toEqual(['ok']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseCopilotEvents([JSON.stringify({ type: 'assistant.message', content: `Working.\n${fence}` })]);
    expect(r.texts).toEqual(['Working.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });
});

describe('CopilotAgentRunner streaming (#204)', () => {
  let runner: CopilotAgentRunner;

  beforeEach(() => {
    runner = new CopilotAgentRunner('/usr/local/bin/copilot');
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

  it('yields a liveness message immediately, then streams assistant text DURING the turn (not after exit)', async () => {
    vi.mocked(cp.spawn).mockReturnValue(
      makeDelayedMockChild([
        // The final text arrives quickly…
        { line: JSON.stringify({ type: 'assistant.message', content: 'all done' }) },
        // …then a LONG tail (e.g. copilot's stats footer / cleanup) before
        // the process actually exits — the regression guard below proves
        // the assistant text was NOT held back until this point.
        { line: JSON.stringify({ type: 'result' }), delayMs: 500 },
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
    expect(messages[0]).toEqual({ type: 'tool_use', text: 'turn started' });
    expect(times[0] - start).toBeLessThan(300);

    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['all done']);

    // THE regression guard: the assistant text must arrive well BEFORE the
    // subprocess exits (the mock sleeps 500ms after the text line before
    // closing). Under the old buffered design every message arrived at
    // process exit.
    const firstAssistantIdx = messages.findIndex((m) => m.type === 'assistant');
    expect(end - times[firstAssistantIdx]).toBeGreaterThanOrEqual(150);
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
    expect(String(caught)).toContain('copilot failed (exit 1)');
    expect(caught.fatal).toBeUndefined();
  });
});
