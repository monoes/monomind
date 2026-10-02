// packages/@monomind/cli/__tests__/orgrt/session-cap.test.ts
//
// Org sections spec 6.10, Phase 2: the session cap is a between-turn rotation
// threshold (R8). `tasks` counts distinct task ids admitted to a generation and
// `tokens` the de-duplicated main-session tokens it processed; native-child
// history is excluded. It is checked before admitting each mailbox message and
// on every session start (initial, respawn, deferred, untagged-mail fallback).
// At or above a threshold the session rotates before the next turn: a turn that
// crosses it may finish, the overshoot is logged, and the next generation
// starts fresh with a runtime-built digest. Counters persist across resumes
// and process cycles.
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { readPacketLog } from '../../src/orgrt/packet.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildRotationDigest, MAX_DIGEST_CHARS } from '../../src/orgrt/rotation-digest.js';
import { loadCounters, saveCounters, SessionCounters, capReached } from '../../src/orgrt/session-cap.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dir = () => mkdtempSync(join(tmpdir(), 'session-cap-'));

describe('capReached', () => {
  const c = (over: Record<string, unknown> = {}) => ({ generation: 0, tasks: [] as string[], tokens: 0, ...over }) as never;
  it('is false below both thresholds and with no thresholds', () => {
    expect(capReached(c({ tasks: ['a'], tokens: 10 }), { tasks: 3, tokens: 100 })).toBeUndefined();
    expect(capReached(c({ tasks: ['a', 'b', 'c', 'd'], tokens: 1e9 }), {})).toBeUndefined();
    expect(capReached(c(), undefined)).toBeUndefined();
  });
  it('is true at or above a threshold, naming which', () => {
    expect(capReached(c({ tasks: ['a', 'b', 'c'] }), { tasks: 3 })).toMatchObject({ reason: 'tasks', value: 3, cap: 3 });
    expect(capReached(c({ tokens: 150 }), { tasks: 9, tokens: 100 })).toMatchObject({ reason: 'tokens', value: 150, cap: 100 });
  });
});

describe('capReached for an incoming message', () => {
  const c = (tasks: string[]) => ({ generation: 0, tasks, tokens: 0 }) as never;
  it('rotates on the tasks cap only when the message brings a task the generation lacks', () => {
    expect(capReached(c(['a']), { tasks: 1 }, ['a'])).toBeUndefined(); // a reminder for a task already in it
    expect(capReached(c(['a']), { tasks: 1 }, [])).toBeUndefined(); // untagged mail adds no task
    expect(capReached(c(['a']), { tasks: 1 }, ['b'])).toMatchObject({ reason: 'tasks' });
    expect(capReached(c(['a']), { tasks: 1 })).toMatchObject({ reason: 'tasks' }); // no message: the plain check
  });
  it('never excuses the tokens cap', () => {
    expect(capReached({ generation: 0, tasks: ['a'], tokens: 500 } as never, { tokens: 100 }, ['a'])).toMatchObject({ reason: 'tokens' });
  });
});

describe('SessionCounters persistence', () => {
  it('counts distinct task ids and de-duplicated tokens, and survives a reload', () => {
    const d = dir();
    const a = new SessionCounters(d, 'w', '_role');
    a.admit(['t1']);
    a.admit(['t1']);
    a.admit(['t2']);
    a.admit([]); // an untagged message: a turn, but no task
    a.addTokens(500);
    a.addTokens(250);
    const b = new SessionCounters(d, 'w', '_role'); // a new process cycle
    expect(b.state).toMatchObject({ generation: 0, tasks: ['t1', 't2'], tokens: 750 });
  });
  it('keeps each (role, key) apart', () => {
    const d = dir();
    new SessionCounters(d, 'w', 'task-1').addTokens(10);
    expect(new SessionCounters(d, 'w', 'task-2').state.tokens).toBe(0);
    expect(new SessionCounters(d, 'x', 'task-1').state.tokens).toBe(0);
  });
  it('rotation starts the next generation with empty counters and tracks progress', () => {
    const d = dir();
    const s = new SessionCounters(d, 'w', '_role');
    s.admit(['t1']);
    s.addTokens(900);
    const r = s.rotate({ reason: 'tokens', cap: 800 }, 2);
    expect(r).toMatchObject({ from: { generation: 0, tokens: 900, tasks: ['t1'] }, overshoot: 100 });
    expect(s.state).toMatchObject({ generation: 1, tasks: [], tokens: 0, pending_rotation: { reason: 'tokens' } });
    // a rotation with no new task done is a stall (R22); one with progress resets it
    s.rotate({ reason: 'tokens', cap: 800 }, 2);
    expect(s.state.stalled_rotations).toBe(1);
    s.rotate({ reason: 'tokens', cap: 800 }, 3);
    expect(s.state.stalled_rotations).toBe(0);
  });
  it('reads a missing or corrupt file as fresh state', () => {
    const d = dir();
    expect(loadCounters(d, 'w', 'k').tokens).toBe(0);
    saveCounters(d, 'w', 'k', { ...loadCounters(d, 'w', 'k'), tokens: 5 });
    expect(loadCounters(d, 'w', 'k').tokens).toBe(5);
  });
});

describe('buildRotationDigest', () => {
  const task = (id: string, status: string, assignee = 'w', title = `Task ${id}`) => ({ id, title, assignee, status });
  const base = {
    role: 'w',
    generation: 2,
    previous: { tasks: 7, tokens: 1_900_000, cap: { tasks: 6, tokens: 2_000_000 }, reason: 'tasks' as const },
    stalled: 0,
    budget: { usd: 0.62, maxUsd: 1, tokens: 120_000, maxTokens: 300_000 },
  };

  it('lists the role\'s open tasks with ids for org_tasks, counts the done ones, and states the budget', () => {
    const d = buildRotationDigest({
      ...base,
      tasks: [task('t1', 'done'), task('t2', 'in_progress'), task('t3', 'ready'), task('t9', 'ready', 'other')],
    });
    expect(d).toMatch(/generation 2/);
    expect(d).toMatch(/t2.*Task t2.*in_progress/);
    expect(d).toMatch(/t3/);
    expect(d).not.toMatch(/t9/); // another role's task
    expect(d).toMatch(/1 done/);
    expect(d).toMatch(/org_tasks/);
    expect(d).toMatch(/\$0\.62 of \$1\.00/);
    expect(d).toMatch(/120,000 of 300,000/);
    expect(d).toMatch(/7 task.*1,900,000 token/);
  });

  it('stays within the digest limit and counts what it leaves out', () => {
    const many = Array.from({ length: 300 }, (_, i) => task(`t${i}`, 'ready', 'w', `A fairly long task title number ${i} ${'x'.repeat(40)}`));
    const d = buildRotationDigest({ ...base, tasks: many });
    expect(d.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(d).toMatch(/and \d+ more open task/);
  });

  it('warns after consecutive rotations that finished nothing (R22)', () => {
    expect(buildRotationDigest({ ...base, tasks: [], stalled: 2 })).toMatch(/2 rotations in a row.*coordinator/i);
    expect(buildRotationDigest({ ...base, tasks: [], stalled: 0 })).not.toMatch(/in a row/);
  });

  it('omits budget lines the role has no cap for', () => {
    const d = buildRotationDigest({ ...base, tasks: [], budget: { usd: 0.4, tokens: 5000 } });
    expect(d).not.toMatch(/ of \$/);
    expect(d).toMatch(/\$0\.40 used/);
  });
});

// --- through the session loop -----------------------------------------------------------------

const def = (cap: unknown) =>
  OrgDefSchema.parse({
    name: 'o', goal: 'g',
    run_config: cap === undefined ? {} : { context: { session_cap: cap } },
    roles: [{ id: 'boss', title: 'B', type: 'boss' }, { id: 'w', title: 'W', type: 'specialist', reports_to: 'boss' }],
  });

const msg = (task: string | undefined, body = 'go') =>
  `[message from boss] subject: ${task ? `[task:${task}] ` : ''}work\n\n${body}`;

interface Turn { tokens?: number; response?: string; parent?: string | null; extra?: { id: string; tokens: number; parent: string }[] }

/** A role that answers each message with the scripted usage; records every query() it starts. */
async function run(opts: {
  cap: unknown;
  messages: string[];
  turns?: Turn[];
  runDir?: string;
  resume?: string;
  tasks?: unknown[];
}) {
  const runDir = opts.runDir ?? dir();
  const bus = new OrgBus('o', 'r', runDir);
  const events: { reason?: string; msg?: string; data?: any }[] = [];
  bus.subscribe((e) => events.push(e as never));
  const mailbox = new Mailbox();
  for (const m of opts.messages) mailbox.push(m);
  const queries: { resume?: string; first?: string; messages: string[] }[] = [];
  let turn = 0;
  const queryFn = (({ prompt, options }: any) => {
    const q: { resume?: string; first?: string; messages: string[] } = { resume: options.resume, messages: [] };
    queries.push(q);
    return (async function* () {
      for await (const m of prompt) {
        q.messages.push(String(m.message.content));
        q.first ??= String(m.message.content);
        const t = opts.turns?.[turn] ?? { tokens: 100 };
        turn++;
        yield {
          type: 'assistant', session_id: 'sdk', parent_tool_use_id: null,
          message: { id: t.response ?? `r${turn}`, content: [], usage: { input_tokens: t.tokens ?? 100, output_tokens: 0 } },
        };
        for (const x of t.extra ?? [])
          yield { type: 'assistant', session_id: 'sdk', parent_tool_use_id: x.parent, message: { id: x.id, content: [], usage: { input_tokens: x.tokens, output_tokens: 0 } } };
        yield { type: 'result', subtype: 'success', session_id: 'sdk', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 };
        if (turn >= opts.messages.length) mailbox.close();
      }
    })();
  }) as never;
  const policy = new PolicyEngine('w', { maxUsd: 1 }, bus, '/work');
  await runAgentSession({
    org: 'o', role: { id: 'w', title: 'W', type: 'specialist', reports_to: 'boss', responsibilities: [] } as never,
    bus, policy, mailbox, cwd: '/work', def: def(opts.cap), deliver: async () => 'ok', queryFn,
    listTasks: () => JSON.stringify(opts.tasks ?? []),
    ...(opts.resume ? { resumeSessionId: opts.resume } : {}),
  } as never);
  await bus.flush();
  return { queries, events, runDir, bus };
}

describe('the session cap in the session loop', () => {
  it('rotates before the next turn once the tokens cap is reached, and the turn that crossed it finishes', async () => {
    const { queries, events } = await run({
      cap: { tokens: 250 },
      messages: [msg('t1'), msg('t1'), msg('t1'), msg('t1')],
      turns: [{ tokens: 100 }, { tokens: 200 }, { tokens: 100 }, { tokens: 100 }],
    });
    // turns 1 and 2 ran in the first session (300 >= 250 after turn 2, which finished); turn 3 starts a new generation
    expect(queries).toHaveLength(2);
    expect(queries[0].messages).toHaveLength(2);
    expect(queries[1].resume).toBeUndefined(); // fresh, not a resume
    const rotated = events.filter((e) => e.reason === 'session-rotated');
    expect(rotated).toHaveLength(1);
    expect(rotated[0].data).toMatchObject({ reason: 'tokens', cap: 250, tokens: 300, overshoot: 50, generation: 1 });
  });

  it('starts the new generation with the rotation digest ahead of the pending message', async () => {
    const { queries } = await run({
      cap: { tokens: 150 }, turns: [{ tokens: 200 }, { tokens: 100 }],
      messages: [msg('t1'), msg('t2', 'next task')],
      tasks: [{ id: 't2', title: 'Second job', assignee: 'w', status: 'in_progress' }],
    });
    expect(queries).toHaveLength(2);
    expect(queries[1].first).toMatch(/^You are continuing after a session rotation \(generation 1\)/);
    expect(queries[1].first).toMatch(/t2.*Second job/);
    expect(queries[1].first).toMatch(/next task$/);
    expect(queries[0].first).not.toMatch(/session rotation/);
  });

  it('records the rotated generation\'s first message, digest included', async () => {
    const { queries, runDir } = await run({ cap: { tokens: 150 }, messages: [msg("t1"), msg("t2")], turns: [{ tokens: 200 }, { tokens: 100 }] });
    const gens = readPacketLog(runDir).filter((r) => r.kind === 'generation');
    expect(gens).toHaveLength(2);
    expect(gens[1].first_message_sha256).toBe(sha(queries[1].first!));
    expect(gens[1]).toMatchObject({ generation: 1, rotation_generation: 1 });
    expect(gens[1].rotation_digest_sha256).toBeTruthy();
  });

  it('rotates on distinct task ids, counting a repeated id once', async () => {
    const { queries } = await run({ cap: { tasks: 2 }, messages: [msg('a'), msg('a'), msg('b'), msg('c')] });
    // a, a, b admitted (2 distinct = the cap); c would be the next turn, so it rotates
    expect(queries).toHaveLength(2);
    expect(queries[0].messages).toHaveLength(3);
    expect(queries[1].messages).toHaveLength(1);
  });

  it('counts only the main session: a native child\'s response does not move the counter', async () => {
    const { queries } = await run({
      cap: { tokens: 250 },
      messages: [msg('t1'), msg('t1'), msg('t1')],
      turns: [{ tokens: 100, extra: [{ id: 'kid', tokens: 5000, parent: 'toolu_1' }] }, { tokens: 100 }, { tokens: 100 }],
    });
    expect(queries[0].messages).toHaveLength(3); // 300 main tokens >= 250 only after the third; nothing left to rotate before
    expect(queries).toHaveLength(1);
  });

  it('counts a response split across messages once', async () => {
    const { queries } = await run({
      cap: { tokens: 250 },
      messages: [msg('t1'), msg('t1'), msg('t1')],
      turns: [{ tokens: 100, response: 'same' }, { tokens: 100, response: 'same' }, { tokens: 100 }],
    });
    expect(queries).toHaveLength(1); // 100 + 0 + 100 = 200 < 250
  });

  it('checks on session start too: persisted counters at the cap rotate a resumed session before its first turn', async () => {
    const runDir = dir();
    const c = new SessionCounters(runDir, 'w', '_role');
    c.admit(['t1']);
    c.addTokens(500);
    const { queries, events } = await run({ cap: { tokens: 400 }, messages: [msg('t2')], runDir, resume: 'old-sdk-session' });
    expect(queries[0].resume).toBeUndefined(); // the resume was dropped
    expect(queries[0].first).toMatch(/session rotation/);
    expect(events.some((e) => e.reason === 'session-rotated')).toBe(true);
  });

  it('keeps the counters across a process cycle, so a second loop continues the same generation', async () => {
    const runDir = dir();
    await run({ cap: { tokens: 1000 }, messages: [msg('t1')], runDir, turns: [{ tokens: 600 }] });
    const second = await run({ cap: { tokens: 1000 }, messages: [msg('t1')], runDir, turns: [{ tokens: 600 }] });
    expect(new SessionCounters(runDir, 'w', '_role').state.tokens).toBeGreaterThanOrEqual(1200 - 600); // second run counted on top of the first
    expect(second.queries).toHaveLength(1);
  });

  it('counts an untagged message (the #319 fallback path) toward tokens', async () => {
    const { queries } = await run({ cap: { tokens: 150 }, messages: [msg(undefined), msg(undefined)], turns: [{ tokens: 100 }, { tokens: 100 }] });
    expect(queries).toHaveLength(1); // 100 < 150 before the 2nd; 200 >= 150 only after it
    const { queries: q2 } = await run({ cap: { tokens: 90 }, messages: [msg(undefined), msg(undefined)], turns: [{ tokens: 100 }, { tokens: 100 }] });
    expect(q2).toHaveLength(2);
  });

  it('makes missing usage visible instead of counting it as zero', async () => {
    const { events } = await run({ cap: { tokens: 1000 }, messages: [msg('t1')], turns: [{ tokens: 0 }] });
    expect(events.some((e) => e.reason === 'session-cap-usage-missing')).toBe(true);
  });

  it('does nothing for an org with no cap: no counters, no rotation, no extra audit', async () => {
    const { queries, events, runDir } = await run({ cap: undefined, messages: [msg('a'), msg('b'), msg('c')], turns: [{ tokens: 1e6 }, { tokens: 1e6 }, { tokens: 1e6 }] });
    expect(queries).toHaveLength(1);
    expect(events.some((e) => e.reason === 'session-rotated')).toBe(false);
    expect(new SessionCounters(runDir, 'w', '_role').state.tokens).toBe(0);
  });

  it('does not rotate for a STILL OPEN reminder about a task already in the generation', async () => {
    const reminder = `[task:t1] STILL OPEN — your turn ended and "Alpha" is still assigned to you and not closed.`;
    const { queries, events, runDir } = await run({
      cap: { tasks: 1 },
      messages: [`[task:t1] Alpha\n\nobjective`, reminder],
      turns: [{ tokens: 100 }, { tokens: 100 }],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].messages).toHaveLength(2);
    expect(events.some((e) => e.reason === 'session-rotated')).toBe(false);
    expect(new SessionCounters(runDir, 'w', '_role').state.tasks).toEqual(['t1']); // not counted twice
  });

  it('still rotates for a reminder about a different task, and for tokens whatever the message', async () => {
    const other = await run({
      cap: { tasks: 1 },
      messages: [`[task:t1] Alpha`, `[task:t2] STILL OPEN — Beta`],
      turns: [{ tokens: 100 }, { tokens: 100 }],
    });
    expect(other.queries).toHaveLength(2);
    const tokens = await run({
      cap: { tokens: 150 },
      messages: [`[task:t1] Alpha`, `[task:t1] STILL OPEN — Alpha`],
      turns: [{ tokens: 200 }, { tokens: 100 }],
    });
    expect(tokens.queries).toHaveLength(2);
  });
});

describe('the cap counts every task a batched message names', () => {
  const batch = (...ids: string[]) => ids.map((id) => `[task:${id}] Title ${id}`).join('\n\n');

  it('counts each distinct task id of a batch toward the tasks cap', async () => {
    const { queries, runDir, events } = await run({
      cap: { tasks: 3 },
      messages: [batch('a', 'b', 'c'), batch('d')],
      turns: [{ tokens: 10 }, { tokens: 10 }],
    });
    expect(new SessionCounters(runDir, 'w', '_role').state.tasks).toEqual(['d']); // rotated: the new generation holds only d
    expect(queries).toHaveLength(2);
    expect(events.find((e) => e.reason === 'session-rotated')?.data).toMatchObject({ reason: 'tasks', tasks: 3 });
  });

  it('does not rotate while the distinct ids stay below the cap, and a repeated id counts once', async () => {
    const { queries, runDir } = await run({
      cap: { tasks: 4 },
      messages: [batch('a', 'b'), batch('a', 'b', 'c')],
      turns: [{ tokens: 10 }, { tokens: 10 }],
    });
    expect(queries).toHaveLength(1);
    expect(new SessionCounters(runDir, 'w', '_role').state.tasks).toEqual(['a', 'b', 'c']);
  });

  it('rotates for a reminder batched with a new task, since the batch brings a task the generation lacks', async () => {
    const { queries } = await run({
      cap: { tasks: 1 },
      messages: [batch('a'), `[task:a] STILL OPEN — Alpha\n\n[task:b] Beta`],
      turns: [{ tokens: 10 }, { tokens: 10 }],
    });
    expect(queries).toHaveLength(2);
    expect(queries[1].first).toMatch(/^You are continuing after a session rotation/);
  });
});
