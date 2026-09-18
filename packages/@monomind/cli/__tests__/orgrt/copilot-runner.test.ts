/**
 * Unit tests for the GitHub Copilot CLI NDJSON parser (copilot-runner) and,
 * below, for CopilotAgentRunner's incremental streaming (#204) — mirrors the
 * scope of codex-runner.test.ts's own streaming describe block.
 */
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import {
  parseCopilotEvents,
  parseCopilotUsage,
  CopilotAgentRunner,
} from '../../src/orgrt/copilot-runner.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession } from '../../src/orgrt/session.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/**
 * VERBATIM `--usage-output-file` output captured from a real GitHub Copilot
 * CLI 1.0.83 run on 2026-09-18 (`copilot -p "Run the shell command 'echo
 * hello-181' and tell me its output." --output-format json -s
 * --allow-all-tools --no-ask-user --usage-output-file <path>`), trimmed to the
 * fields the parser reads. Two model calls, so it also proves the counts are
 * cumulative for the whole invocation rather than last-call-only.
 * Arithmetic identity worth preserving: inputTokens (30522) ===
 * tokenDetails.input (6) + cache_read (15224) + cache_write (15292), i.e.
 * inputTokens is TOTAL prompt tokens including cache traffic.
 */
const REAL_USAGE_JSON = JSON.stringify({
  totalPremiumRequestCost: 1,
  totalUserRequests: 1,
  totalNanoAiu: 418508000,
  tokenDetails: {
    input: { tokenCount: 6 },
    cache_read: { tokenCount: 15224 },
    cache_write: { tokenCount: 15292 },
    output: { tokenCount: 47 },
  },
  modelMetrics: {
    'gpt-5.6-luna': {
      requests: { count: 2, cost: 1 },
      usage: {
        inputTokens: 30522,
        outputTokens: 47,
        cacheReadTokens: 15224,
        cacheWriteTokens: 15292,
        reasoningTokens: 9,
      },
      totalNanoAiu: 418508000,
    },
  },
  lastCallInputTokens: 15295,
  lastCallOutputTokens: 7,
});

/** VERBATIM usage file from the same CLI when the invocation failed before any
 *  model call (bad `--model`): the file IS written, but with no model metrics. */
const EMPTY_USAGE_JSON = JSON.stringify({
  totalPremiumRequestCost: 0,
  totalUserRequests: 0,
  totalNanoAiu: 0,
  totalApiDurationMs: 0,
  modelMetrics: {},
  agentMetrics: {},
  lastCallInputTokens: 0,
  lastCallOutputTokens: 0,
});

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

  /** VERBATIM assistant event from a real copilot 1.0.83 `--output-format
   *  json` stream: the payload is nested under `data`, not at the top level.
   *  The pre-#181 parser (written against public docs, never byte-verified)
   *  matched the `assistant.message` type but found no text anywhere and
   *  failed closed, so a copilot role produced NO assistant output at all. */
  it('parses the real assistant.message shape (payload nested under data)', () => {
    const r = parseCopilotEvents([
      JSON.stringify({
        type: 'assistant.message',
        data: {
          messageId: '96e0d076-7c91-4ad9-9500-26bcc02ba6a2',
          model: 'gpt-5.6-luna',
          content: 'hello-181',
          toolRequests: [],
          phase: 'final_answer',
        },
      }),
    ]);
    expect(r.texts).toEqual(['hello-181']);
  });

  it('ignores a real tool-request assistant.message with empty content', () => {
    const r = parseCopilotEvents([
      JSON.stringify({
        type: 'assistant.message',
        data: { content: '', toolRequests: [{ toolCallId: 'call_1', name: 'bash' }] },
      }),
    ]);
    expect(r.texts).toEqual([]);
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

describe('parseCopilotUsage (#181)', () => {
  it('sums real per-model token counts out of the --usage-output-file JSON', () => {
    expect(parseCopilotUsage(REAL_USAGE_JSON)).toEqual({
      inputTokens: 30522,
      outputTokens: 47,
    });
  });

  it('sums across models when a session switched model mid-run', () => {
    const two = JSON.stringify({
      modelMetrics: {
        'gpt-5.6-luna': { usage: { inputTokens: 100, outputTokens: 10 } },
        'claude-sonnet-4.5': { usage: { inputTokens: 40, outputTokens: 5 } },
      },
    });
    expect(parseCopilotUsage(two)).toEqual({ inputTokens: 140, outputTokens: 15 });
  });

  it('returns undefined when the file carries no model metrics (no model call happened)', () => {
    expect(parseCopilotUsage(EMPTY_USAGE_JSON)).toBeUndefined();
  });

  it('returns undefined rather than 0 for unparseable/unexpected content', () => {
    expect(parseCopilotUsage('not json')).toBeUndefined();
    expect(parseCopilotUsage('{"modelMetrics":"nope"}')).toBeUndefined();
  });
});

describe('CopilotAgentRunner token accounting (#181)', () => {
  let runner: CopilotAgentRunner;

  beforeEach(() => {
    runner = new CopilotAgentRunner('/usr/local/bin/copilot');
    vi.clearAllMocks();
  });

  function makeMockChild(lines: string[], exitCode = 0, stderr?: string): cp.ChildProcess {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stdout[Symbol.asyncIterator] = async function* () {
      for (const line of lines) yield Buffer.from(`${line}\n`);
    };
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    if (stderr) setTimeout(() => (child.stderr as EventEmitter).emit('data', Buffer.from(stderr)), 5);
    setTimeout(() => child.emit('close', exitCode), 20);
    return child as cp.ChildProcess;
  }

  function runArgs() {
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

  /** Stand-in for the real CLI: writes the captured usage JSON to whatever
   *  path the runner passed via --usage-output-file, then streams one real
   *  assistant event. Returns the path so the test can assert cleanup. */
  function mockCopilotWritingUsage(usageJson: string): { usagePath: () => string } {
    let captured = '';
    vi.mocked(cp.spawn).mockImplementation(((_bin: string, argv: string[]) => {
      const i = argv.indexOf('--usage-output-file');
      captured = i >= 0 ? argv[i + 1] : '';
      if (captured) writeFileSync(captured, usageJson);
      return makeMockChild([
        JSON.stringify({ type: 'assistant.message', data: { content: 'hello-181' } }),
      ]);
    }) as any);
    return { usagePath: () => captured };
  }

  it('reports the real token counts copilot wrote, not 0', async () => {
    mockCopilotWritingUsage(REAL_USAGE_JSON);

    const messages: any[] = [];
    for await (const m of runner.run(runArgs())) messages.push(m);

    const result = messages.find((m) => m.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      subtype: 'success',
      input_tokens: 30522,
      output_tokens: 47,
    });
    // Copilot reports spend in AI credits / premium requests, never USD —
    // leave cost unset rather than inventing a conversion rate.
    expect(result.cost_usd).toBeUndefined();
    expect(messages.filter((m) => m.type === 'assistant').map((m) => m.text)).toEqual([
      'hello-181',
    ]);
  });

  it('passes --usage-output-file and deletes the temp file afterwards', async () => {
    const mock = mockCopilotWritingUsage(REAL_USAGE_JSON);

    for await (const _m of runner.run(runArgs())) {
      /* consume */
    }

    expect(mock.usagePath()).toBeTruthy();
    expect(existsSync(mock.usagePath())).toBe(false);
  });

  it('reports 0 when copilot genuinely made no model call', async () => {
    mockCopilotWritingUsage(EMPTY_USAGE_JSON);

    const messages: any[] = [];
    for await (const m of runner.run(runArgs())) messages.push(m);

    expect(messages.find((m) => m.type === 'result')).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it('fails the turn with an actionable error when copilot is too old for --usage-output-file', async () => {
    vi.mocked(cp.spawn).mockImplementation((() =>
      makeMockChild([], 1, "error: unknown option '--usage-output-file'")) as any);

    let caught: any;
    try {
      for await (const _m of runner.run(runArgs())) {
        /* consume */
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toContain('--usage-output-file');
    expect(String(caught)).toContain('copilot update');
  });

  it('feeds the org budget and the usage bus event the same way every other runner does', async () => {
    mockCopilotWritingUsage(REAL_USAGE_JSON);

    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'copilot-usage-')));
    const usageEvents: Array<{ tokens?: number; cost_usd?: number }> = [];
    bus.subscribe((e) => {
      if (e.type === 'usage') usageEvents.push(e.data as { tokens?: number; cost_usd?: number });
    });
    // maxTokens well under the captured spend, so a real number MUST trip the
    // cap — under the old always-0 accounting it never would.
    const policy = new PolicyEngine('coder', { maxTokens: 1000 }, bus, '/work');
    const budgetTrips: string[] = [];
    bus.subscribe((e) => {
      if (e.type === 'status' && e.reason === 'budget-exhausted') budgetTrips.push(e.msg ?? '');
    });
    const mailbox = new Mailbox();
    mailbox.push('do work');
    mailbox.close();

    await runAgentSession({
      org: 'o',
      role: {
        id: 'coder',
        title: 'Coder',
        type: 'specialist',
        reports_to: 'boss',
        responsibilities: [],
      } as any,
      bus,
      policy,
      mailbox,
      cwd: '/work',
      deliver: async () => 'delivered',
      runner: new CopilotAgentRunner('/usr/local/bin/copilot'),
    });

    expect(usageEvents).toEqual([{ tokens: 30569, cost_usd: undefined, subtype: 'success' }]);
    expect(policy.usage).toBe(30569);
    expect(budgetTrips.length).toBeGreaterThan(0);
  });
});
