// packages/@monomind/cli/__tests__/orgrt/context-log.test.ts
//
// Org sections spec section 9, Phase 1: per-call context logging. Each model
// call a role makes is recorded in the run's context.jsonl with the size of
// its context, how old the session is, and how much of the prompt came from
// cache. The first call of a session shows the prefix cache read vs write at
// session start; the summary turns the log into per-role figures that the
// eval compares across configurations.
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { orgCommand } from '../../src/commands/org.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { readContextLog, summarizeContextLog, type ContextCallRecord } from '../../src/orgrt/context-log.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

const rec = (over: Partial<ContextCallRecord>): ContextCallRecord => ({
  ts: 1, role: 'a', task_key: '_role', session_id: 's1', resumed: false, call_index: 0, session_age_ms: 0,
  first_call: false, parent: false, response_id: 'r', context_tokens: 1000, input: 0, cache_read: 0, cache_creation: 0,
  output: 0, cache_hit_ratio: 0, ...over,
});

describe('summarizeContextLog', () => {
  it('reports per role the calls, sessions, context size and the cache split at session start', () => {
    const [a, b] = summarizeContextLog([
      rec({ role: 'a', session_id: 's1', first_call: true, call_index: 0, context_tokens: 10_000, cache_read: 0, cache_creation: 10_000 }),
      rec({ role: 'a', session_id: 's1', call_index: 1, context_tokens: 12_000, cache_read: 10_000, cache_creation: 2_000, cache_hit_ratio: 10 / 12 }),
      rec({ role: 'a', session_id: 's2', first_call: true, call_index: 0, context_tokens: 10_000, cache_read: 10_000, cache_creation: 0 }),
      rec({ role: 'b', session_id: 's9', first_call: true, context_tokens: 500, cache_read: 0, cache_creation: 500 }),
    ]);
    expect(a).toMatchObject({
      role: 'a', calls: 3, sessions: 2, max_context_tokens: 12_000,
      start_cache_read_tokens: 10_000, start_cache_write_tokens: 10_000,
    });
    expect(a.mean_context_tokens).toBeCloseTo(10_667, 0);
    expect(a.start_write_share).toBeCloseTo(0.5); // one cold start, one warm
    expect(a.cache_hit_ratio).toBeCloseTo(20_000 / 32_000);
    expect(b).toMatchObject({ role: 'b', calls: 1, sessions: 1, start_write_share: 1 });
  });

  it('has no start write share for a role that never started a session in the log', () => {
    expect(summarizeContextLog([rec({ first_call: false })])[0].start_write_share).toBeNull();
  });
});

describe('a session logs one record per model call', () => {
  async function run(messages: unknown[][], opts: { resume?: string } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-log-'));
    const bus = new OrgBus('o', 'r', dir);
    const mailbox = new Mailbox();
    for (let i = 0; i < messages.length; i++) mailbox.push(`m${i}`);
    let _turn = 0;
    const queryFn = ({ prompt }: any) =>
      (async function* () {
        const it = prompt[Symbol.asyncIterator]();
        for (const batch of messages) {
          await it.next();
          for (const m of batch) yield m;
          yield { type: 'result', subtype: 'success', session_id: 'sdk', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 };
          _turn++;
        }
        mailbox.close();
      })();
    const policy = new PolicyEngine('coder', {}, bus, '/work');
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'C', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work', deliver: async () => 'ok', queryFn: queryFn as any,
      ...(opts.resume ? { resumeSessionId: opts.resume } : {}),
    } as any);
    await bus.flush();
    return readContextLog(dir);
  }
  const call = (id: string, u: Record<string, number>, parent: string | null = null) => ({
    type: 'assistant', session_id: 'sdk', parent_tool_use_id: parent,
    message: { id, content: [], usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...u } },
  });

  it('writes one record per response id, however many messages repeat it', async () => {
    const log = await run([[call('a', { cache_creation_input_tokens: 5000 }), call('a', { cache_creation_input_tokens: 5000 }), call('b', { cache_read_input_tokens: 5000, cache_creation_input_tokens: 400 })]]);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ role: 'coder', response_id: 'a', first_call: true, call_index: 0, context_tokens: 5003, cache_creation: 5000, cache_read: 0 });
    expect(log[1]).toMatchObject({ response_id: 'b', first_call: false, call_index: 1, context_tokens: 5403, cache_read: 5000, cache_creation: 400 });
    expect(log[1].cache_hit_ratio).toBeCloseTo(5000 / 5403);
    expect(log[1].session_age_ms).toBeGreaterThanOrEqual(log[0].session_age_ms);
  });

  it('marks a subagent call as parent: true and still logs it', async () => {
    const log = await run([[call('a', {}), call('sub', {}, 'toolu_1')]]);
    expect(log.map((r) => r.parent)).toEqual([false, true]);
  });

  it('counts calls across the mailbox messages of one session', async () => {
    const log = await run([[call('a', {})], [call('b', {})]]);
    expect(log.map((r) => r.call_index)).toEqual([0, 1]);
    expect(log.filter((r) => r.first_call)).toHaveLength(1);
  });

  it('records that a session was resumed', async () => {
    const log = await run([[call('a', {})]], { resume: 'old-session' });
    expect(log[0].resumed).toBe(true);
    expect((await run([[call('a', {})]]))[0].resumed).toBe(false);
  });
});

describe('org report --context', () => {
  function project() {
    const root = mkdtempSync(join(tmpdir(), 'ctx-report-'));
    const runDir = join(root, ORG_DIR, 'o', 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'bus.jsonl'), `${JSON.stringify({ id: 'e', ts: 1, org: 'o', run: 'run-1', type: 'status', msg: 'org started' })}\n`);
    writeFileSync(join(root, ORG_DIR, 'o.json'), JSON.stringify({ name: 'o', roles: [{ id: 'a', title: 'A' }] }));
    const rows = [
      rec({ role: 'a', first_call: true, context_tokens: 4000, cache_creation: 4000 }),
      rec({ role: 'a', call_index: 1, context_tokens: 6000, cache_read: 4000, cache_creation: 2000 }),
    ];
    writeFileSync(join(runDir, 'context.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    return root;
  }
  const report = async (root: string, flags: Record<string, unknown>) => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s: string) => void lines.push(String(s)));
    try {
      const res = await orgCommand.subcommands!.find((c) => c.name === 'report')!.action!({
        args: ['o'], flags: { context: true, ...flags }, cwd: root, interactive: false,
      } as never);
      return { res, text: lines.join('\n') };
    } finally {
      spy.mockRestore();
    }
  };

  it('prints each role\'s context size and its cache split at session start', async () => {
    const { res, text } = await report(project(), {});
    expect(res?.success).toBe(true);
    expect(text).toMatch(/a\s+2 calls.*max 6,?000/);
    expect(text).toMatch(/start .*100%.*written/);
  });

  it('says so when the run has no context log', async () => {
    const root = project();
    writeFileSync(join(root, ORG_DIR, 'o', 'run-1', 'context.jsonl'), '');
    const { text } = await report(root, {});
    expect(text).toMatch(/no context log/i);
  });

  it('does not log anything for an org with no calls', () => {
    expect(readContextLog(mkdtempSync(join(tmpdir(), 'ctx-none-')))).toEqual([]);
  });
});
