/**
 * #387: a Claude turn that delegates to a native subagent (Task/Agent tool).
 *
 * Drives the REAL ClaudeAgentRunner through runAgentExec with a fake Agent
 * SDK stream (the `queryFn` injection seam), shaped after the SDK 0.3.226
 * messages: `system/task_started|task_progress|task_notification`, and the
 * subagent's own `stream_event`/`assistant`/`user` messages, which carry a
 * non-null `parent_tool_use_id`.
 *
 * Asserts: (1) the subagent's text never reaches main-stream `assistant`
 * events or `result.text` (the leak); (2) it is emitted as
 * `assistant {text, parent_tool_use_id}` instead; (3) the lifecycle comes out
 * as `subagent started → progress → finished`, joined to the Task call's
 * `tool_activity` id via `tool_use_id`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runAgentExec } from '../orgrt/agent-exec.js';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';

const S = 'sess_387';
const TASK = 'toolu_task';

const delta = (text: string, parent: string | null) => [
  {
    type: 'stream_event',
    session_id: S,
    parent_tool_use_id: parent,
    event: { type: 'message_start' },
  },
  {
    type: 'stream_event',
    session_id: S,
    parent_tool_use_id: parent,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  },
];

const usage = { total_tokens: 900, tool_uses: 1, duration_ms: 1500 };

/** One turn: main text → Task call → subagent works → main text. */
const SDK_STREAM: Record<string, unknown>[] = [
  { type: 'system', subtype: 'init', session_id: S },
  ...delta('Delegating.', null),
  {
    type: 'assistant',
    session_id: S,
    parent_tool_use_id: null,
    message: {
      content: [
        { type: 'text', text: 'Delegating.' },
        {
          type: 'tool_use',
          id: TASK,
          name: 'Task',
          input: {
            subagent_type: 'Explore',
            description: 'find config',
            prompt: 'Find the config',
          },
        },
      ],
    },
  },
  {
    type: 'system',
    subtype: 'task_started',
    session_id: S,
    task_id: 'task_1',
    tool_use_id: TASK,
    subagent_type: 'Explore',
    description: 'find config',
    prompt: 'Find the config',
  },
  ...delta('SUBAGENT PROSE', TASK),
  {
    type: 'assistant',
    session_id: S,
    parent_tool_use_id: TASK,
    message: {
      content: [
        { type: 'text', text: 'SUBAGENT PROSE' },
        { type: 'tool_use', id: 'toolu_sub_grep', name: 'Grep', input: { pattern: 'config' } },
      ],
    },
  },
  {
    type: 'user',
    session_id: S,
    parent_tool_use_id: TASK,
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_sub_grep', content: 'a.ts' }] },
  },
  {
    type: 'system',
    subtype: 'task_progress',
    session_id: S,
    task_id: 'task_1',
    tool_use_id: TASK,
    description: 'find config',
    usage,
    last_tool_name: 'Grep',
    summary: 'searching for config',
  },
  {
    type: 'system',
    subtype: 'task_notification',
    session_id: S,
    task_id: 'task_1',
    tool_use_id: TASK,
    status: 'completed',
    output_file: '',
    summary: 'config is in a.ts',
    usage,
  },
  {
    type: 'user',
    session_id: S,
    parent_tool_use_id: null,
    message: {
      content: [{ type: 'tool_result', tool_use_id: TASK, content: 'config is in a.ts' }],
    },
  },
  ...delta('Done.', null),
  {
    type: 'assistant',
    session_id: S,
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'Done.' }] },
  },
  {
    type: 'result',
    session_id: S,
    subtype: 'success',
    is_error: false,
    usage: { input_tokens: 100, output_tokens: 20 },
    total_cost_usd: 0.01,
  },
];

async function runFixture(stream = SDK_STREAM): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const runner = new ClaudeAgentRunner((() =>
    (async function* () {
      for (const m of stream) yield m;
    })()) as any);
  await runAgentExec({
    runtime: 'claude',
    prompt: 'find the config',
    maxTurns: 5,
    toolTimeoutMs: 60_000,
    runnerOverride: runner,
    emit: (ev: Record<string, any>) => events.push(ev),
    stdin: new PassThrough(),
  } as any);
  return events;
}

describe('#387: claude subagent events on agent exec', () => {
  // With and without the subagent's own partial `stream_event`s: its text
  // leaked through either path.
  const variants: [string, Record<string, unknown>[]][] = [
    ['with subagent stream_events', SDK_STREAM],
    [
      'without subagent stream_events',
      SDK_STREAM.filter((m) => !(m.type === 'stream_event' && m.parent_tool_use_id)),
    ],
  ];

  it.each(variants)(
    'keeps subagent text out of main assistant events and result.text (%s)',
    async (_, stream) => {
      const events = await runFixture(stream);
      const main = events.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id);
      expect(main.map((e) => e.text).join('')).toBe('Delegating.Done.');
      const result = events.find((e) => e.type === 'result')!;
      expect(result.text).toBe('Delegating.Done.');
    },
  );

  it.each(variants)(
    'emits subagent text as assistant {text, parent_tool_use_id} (%s)',
    async (_, stream) => {
      const events = await runFixture(stream);
      const sub = events.filter((e) => e.type === 'assistant' && e.parent_tool_use_id);
      expect(sub).toEqual([
        { v: 1, type: 'assistant', text: 'SUBAGENT PROSE', parent_tool_use_id: TASK },
      ]);
    },
  );

  it('emits subagent started → progress → finished joined to the Task tool_activity id', async () => {
    const events = await runFixture();
    const taskStart = events.find(
      (e) => e.type === 'tool_activity' && e.phase === 'start' && e.name === 'Task',
    )!;
    const sub = events.filter((e) => e.type === 'subagent');
    expect(sub.map((e) => e.phase)).toEqual(['started', 'progress', 'finished']);
    for (const e of sub) expect(e.tool_use_id).toBe(taskStart.id);
    expect(sub[0]).toEqual({
      v: 1,
      type: 'subagent',
      phase: 'started',
      id: 'task_1',
      tool_use_id: TASK,
      subagent_type: 'Explore',
      description: 'find config',
      prompt: 'Find the config',
    });
    expect(sub[1]).toMatchObject({
      phase: 'progress',
      id: 'task_1',
      last_tool: 'Grep',
      summary: 'searching for config',
      usage,
    });
    expect(sub[2]).toMatchObject({
      phase: 'finished',
      id: 'task_1',
      status: 'completed',
      summary: 'config is in a.ts',
      usage,
    });
    // started precedes the subagent's own tool calls; finished precedes the
    // Task call's own end.
    const idx = (p: (e: Record<string, unknown>) => boolean) => events.findIndex(p);
    expect(idx((e) => e.type === 'subagent' && e.phase === 'started')).toBeLessThan(
      idx((e) => e.type === 'tool_activity' && e.id === 'toolu_sub_grep'),
    );
    expect(idx((e) => e.type === 'subagent' && e.phase === 'finished')).toBeLessThan(
      idx((e) => e.type === 'tool_activity' && e.phase === 'end' && e.id === TASK),
    );
  });

  it('produces the event sequence of the published subagent.ndjson golden fixture', async () => {
    const fixture = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'doc',
        'agent-exec-protocol',
        'fixtures',
        'subagent.ndjson',
      ),
      'utf8',
    )
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const shape = (e: Record<string, unknown>) =>
      `${e.type}:${e.phase ?? ''}:${e.parent_tool_use_id ? 'sub' : ''}`;
    expect((await runFixture()).map(shape)).toEqual(fixture.map(shape));
  });

  it('fills tool_use_id from task_started when a later task message omits it', async () => {
    const stream = SDK_STREAM.map((m) =>
      m.subtype === 'task_progress' || m.subtype === 'task_notification'
        ? { ...m, tool_use_id: undefined }
        : m,
    );
    const sub = (await runFixture(stream)).filter((e) => e.type === 'subagent');
    expect(sub.map((e) => e.tool_use_id)).toEqual([TASK, TASK, TASK]);
  });

  it('drops housekeeping tasks (skip_transcript) and tasks with no tool_use_id', async () => {
    const stream = SDK_STREAM.flatMap((m) =>
      m.subtype === 'task_started'
        ? [
            m,
            { ...m, task_id: 'task_hidden', skip_transcript: true },
            { ...m, task_id: 'task_orphan', tool_use_id: undefined },
            { ...m, subtype: 'task_notification', task_id: 'task_hidden', status: 'completed' },
          ]
        : [m],
    );
    const sub = (await runFixture(stream)).filter((e) => e.type === 'subagent');
    expect(sub.map((e) => e.id)).toEqual(['task_1', 'task_1', 'task_1']);
  });
});
