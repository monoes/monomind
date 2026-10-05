/**
 * #563: the vercel runner yielded every streamed text delta as its own
 * `assistant` message, and session-run.ts turns each one into an org bus
 * `chat` event. Like the claude/codex/aider runners, it now yields one
 * `assistant` message per model step, and streams deltas only when the
 * caller opts in with extras.includePartialMessages (agent exec).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => ({
  parts: [] as unknown[],
  failAfter: -1,
  usageError: undefined as Error | undefined,
}));

vi.mock('ai', () => ({
  tool: (def: unknown) => def,
  isStepCount: (n: number) => n,
  streamText: () => ({
    fullStream: (async function* () {
      for (const [i, part] of stream.parts.entries()) {
        if (i === stream.failAfter) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        yield part;
      }
    })(),
    get usage() {
      return stream.usageError
        ? Promise.reject(stream.usageError)
        : Promise.resolve({ inputTokens: 1, outputTokens: 2 });
    },
  }),
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({}) }));

import type { AgentMessage } from '../orgrt/agent-runner.js';
import { VercelAgentRunner } from '../orgrt/vercel-runner.js';

const delta = (text: string) => ({ type: 'text-delta', id: 't1', text });

let dir: string;
beforeEach(() => {
  stream.failAfter = -1;
  stream.usageError = undefined;
  dir = mkdtempSync(join(tmpdir(), 'vercel-chat-563-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function collect(
  extras?: Record<string, unknown>,
  env: Record<string, string> = {},
): Promise<{ msgs: AgentMessage[]; err?: unknown }> {
  const msgs: AgentMessage[] = [];
  try {
    for await (const m of new VercelAgentRunner().run({
      tools: [],
      prompt: (async function* () {
        yield 'hi';
      })(),
      systemPrompt: '',
      cwd: dir,
      env: { MONOMIND_ORG_DIR: dir, OPENAI_API_KEY: 'x', ...env },
      maxTurns: 1,
      vendor: 'openai',
      model: 'm',
      extras,
    } as any)) {
      msgs.push(m);
    }
  } catch (err) {
    return { msgs, err };
  }
  return { msgs };
}

const assistantTexts = (msgs: AgentMessage[]) =>
  msgs.filter((m) => m.type === 'assistant').map((m) => m.text);

describe('VercelAgentRunner chat events (#563)', () => {
  it('joins several deltas into one assistant message per step', async () => {
    stream.failAfter = -1;
    stream.parts = [
      { type: 'text-start', id: 't1' },
      delta('I'),
      delta("'ve asked"),
      delta(' the question'),
      { type: 'text-end', id: 't1' },
      { type: 'finish-step' },
      { type: 'text-start', id: 't2' },
      delta('Done.'),
      { type: 'text-end', id: 't2' },
      { type: 'finish-step' },
      { type: 'finish' },
    ];
    const { msgs, err } = await collect();
    expect(err).toBeUndefined();
    expect(assistantTexts(msgs)).toEqual(["I've asked the question", 'Done.']);
    expect(msgs.at(-1)?.type).toBe('result');
  });

  it('flushes the text of a turn aborted mid-stream exactly once', async () => {
    stream.parts = [delta('half '), delta('a reply'), delta('never sent')];
    stream.failAfter = 2;
    const { msgs, err } = await collect();
    expect((err as Error)?.name).toBe('AbortError');
    expect(assistantTexts(msgs)).toEqual(['half a reply']);
  });

  it('flushes text left over when the stream ends without finish-step', async () => {
    stream.failAfter = -1;
    stream.parts = [delta('no '), delta('step end'), { type: 'abort' }];
    const { msgs } = await collect();
    expect(assistantTexts(msgs)).toEqual(['no step end']);
  });

  it('still streams deltas when the caller opts into partial messages', async () => {
    stream.failAfter = -1;
    stream.parts = [delta('a'), delta('b'), { type: 'finish-step' }];
    const { msgs } = await collect({ includePartialMessages: true });
    expect(assistantTexts(msgs)).toEqual(['a', 'b']);
  });

  it('emits no assistant message for a tool-only step', async () => {
    stream.parts = [
      { type: 'tool-call', toolCallId: 'c1', toolName: 'org_send', input: {} },
      { type: 'tool-result', toolCallId: 'c1', toolName: 'org_send', output: 'ok' },
      { type: 'finish-step' },
      delta('sent'),
      { type: 'finish-step' },
      { type: 'finish' },
    ];
    const { msgs } = await collect();
    expect(assistantTexts(msgs)).toEqual(['sent']);
  });
});

const resultOf = (msgs: AgentMessage[]) => msgs.filter((m) => m.type === 'result');

describe('VercelAgentRunner failed turns', () => {
  it('reports a turn whose stream carries an error event as a failure', async () => {
    const apiError = Object.assign(new Error('Rate limit exceeded, retry after 20s'), {
      statusCode: 429,
    });
    stream.parts = [
      { type: 'start' },
      { type: 'start-step' },
      delta('partial '),
      { type: 'error', error: apiError },
      { type: 'finish-step' },
      { type: 'finish' },
    ];
    const { msgs, err } = await collect();
    expect(err).toBeUndefined();
    expect(assistantTexts(msgs)).toEqual(['partial ']);
    const [result] = resultOf(msgs);
    expect(result).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
      input_tokens: 1,
      output_tokens: 2,
    });
    expect(result.text).toContain('Rate limit exceeded, retry after 20s');
  });

  it('reports an aborted turn as a failure', async () => {
    stream.parts = [{ type: 'start' }, delta('cut '), { type: 'abort' }];
    const { msgs, err } = await collect();
    expect(err).toBeUndefined();
    expect(assistantTexts(msgs)).toEqual(['cut ']);
    expect(resultOf(msgs)).toEqual([
      expect.objectContaining({ subtype: 'error_during_execution', is_error: true }),
    ]);
    expect(resultOf(msgs)[0].text).toMatch(/aborted/i);
  });

  it('still reports the failure when usage rejects after an error event', async () => {
    stream.parts = [{ type: 'error', error: 'upstream 500' }];
    stream.usageError = new Error('No output generated');
    const { msgs, err } = await collect();
    expect(err).toBeUndefined();
    expect(resultOf(msgs)[0]).toMatchObject({
      subtype: 'error_during_execution',
      is_error: true,
      input_tokens: 0,
      output_tokens: 0,
      text: expect.stringContaining('upstream 500'),
    });
  });

  it('reports a clean stream as success', async () => {
    stream.parts = [delta('ok'), { type: 'finish-step' }, { type: 'finish' }];
    const { msgs } = await collect();
    expect(resultOf(msgs)[0]).toMatchObject({ subtype: 'success', is_error: false });
  });
});

describe('VercelAgentRunner session store in a sections org', () => {
  it('keeps the session file in the role private directory, not the org sessions directory', async () => {
    const own = mkdtempSync(join(tmpdir(), 'vercel-private-'));
    try {
      stream.failAfter = -1;
      stream.parts = [
        { type: 'text-start', id: 't1' },
        delta('ok'),
        { type: 'text-end', id: 't1' },
        { type: 'finish-step' },
        { type: 'finish' },
      ];
      const { err } = await collect(undefined, { MONOMIND_RUNNER_DATA_DIR: own });
      expect(err).toBeUndefined();
      expect(readdirSync(join(own, 'sessions')).length).toBe(1);
      expect(existsSync(join(dir, 'sessions'))).toBe(false);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });
});
