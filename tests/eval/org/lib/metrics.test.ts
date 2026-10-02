// Run metrics for the org eval (spec section 10), computed from the files a
// run leaves: bus.jsonl and context.jsonl. Spend counts every attempt; a run
// with no accepted units is a failure, never a zero cost.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioManifest } from './manifest.js';
import { costPerAcceptedUnit, fixtureOutcome, runMetrics } from './metrics.js';

let t = 1_000_000;
const ev = (type: string, from: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: `e${t}`,
  ts: (t += 1000),
  org: 'o',
  run: 'r',
  type,
  ...(from ? { from } : {}),
  ...extra,
});

function run(events: unknown[], context: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bus.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  if (context.length)
    writeFileSync(
      join(dir, 'context.jsonl'),
      `${context.map((e) => JSON.stringify(e)).join('\n')}\n`,
    );
  return dir;
}
const usage = (from: string, cost: number | null, tokens: number, cacheRead = 0) =>
  ev('usage', from, {
    data: {
      tokens,
      cost_usd: cost,
      tokens_in: 1,
      tokens_out: 2,
      cache_read: cacheRead,
      cache_creation: 3,
    },
  });

describe('runMetrics', () => {
  it('sums spend and tokens over every usage event, per role and in total', () => {
    const m = runMetrics(
      run([
        ev('status', undefined, { msg: 'org started' }),
        usage('a', 0.5, 1000, 800),
        usage('a', 0.25, 500, 400),
        usage('b', 1, 2000, 1500),
      ]),
    );
    expect(m.usd_reported).toBeCloseTo(1.75);
    expect(m.cost_complete).toBe(true);
    expect(m.tokens_total).toBe(3500);
    expect(m.cache_read_share).toBeCloseTo(2700 / 3500);
    expect(m.roles.a).toMatchObject({ usd: 0.75, tokens: 1500 });
    expect(m.roles.b.usd).toBe(1);
  });

  it('marks cost incomplete when a usage event reported no USD (unknown is not zero)', () => {
    const m = runMetrics(run([usage('a', 0.5, 100), usage('c', null, 900)]));
    expect(m.cost_complete).toBe(false);
    expect(m.usd_reported).toBeCloseTo(0.5);
  });

  it('measures wall time from the first to the last event', () => {
    const m = runMetrics(
      run([ev('status', undefined), ev('status', undefined), ev('status', undefined)]),
    );
    expect(m.wall_ms).toBe(2000);
  });

  it('counts crashes, budget closures, human questions, gates, deferrals and session starts', () => {
    const m = runMetrics(
      run([
        ev('status', 'a', { reason: 'agent-restart' }),
        ev('status', 'a', { reason: 'agent-fatal' }),
        ev('status', 'a', {
          reason: 'budget-exhausted',
          msg: 'USD budget exhausted - closing session',
        }),
        ev('status', 'b', {
          reason: 'budget-exhausted',
          msg: 'token budget exhausted - closing session',
        }),
        ev('question', 'a', { data: { question: 'which one?' } }),
        ev('question', 'a', {
          data: { question: 'Approval required for Bash', requestId: 'apr-1' },
        }), // a tool approval, not a human
        ev('audit', 'a', { reason: 'concurrency-limit' }),
        ev('audit', 'a', { reason: 'session-run' }),
        ev('audit', 'b', { reason: 'session-run' }),
        ev('audit', undefined, { reason: 'idle-stop' }),
      ]),
    );
    expect(m).toMatchObject({
      crashes: 2,
      budget_closures: { usd: 1, tokens: 1 },
      human_questions: 1,
      tool_approvals: 1,
      concurrency_deferrals: 1,
      session_starts: 2,
      idle_stopped: true,
    });
  });

  it('adds the per-role context figures when the run kept a context log', () => {
    const rec = (role: string, first: boolean, ctx: number, read: number, write: number) => ({
      ts: 1,
      role,
      task_key: '_role',
      resumed: false,
      call_index: 0,
      session_age_ms: 0,
      first_call: first,
      parent: false,
      context_tokens: ctx,
      input: 0,
      cache_read: read,
      cache_creation: write,
      output: 0,
      cache_hit_ratio: read / ctx,
    });
    const m = runMetrics(
      run(
        [usage('a', 1, 10)],
        [rec('a', true, 19_000, 0, 19_000), rec('a', false, 21_000, 19_000, 2_000)],
      ),
    );
    expect(m.context).toHaveLength(1);
    expect(m.context[0]).toMatchObject({ role: 'a', calls: 2, start_write_share: 1 });
  });

  it('reads an empty or missing context log as no figures', () => {
    expect(runMetrics(run([usage('a', 1, 10)])).context).toEqual([]);
  });

  it('survives a torn final line in the bus file', () => {
    const dir = run([usage('a', 1, 10)]);
    writeFileSync(join(dir, 'bus.jsonl'), `${JSON.stringify(usage('a', 1, 10))}\n{"id":"torn`);
    expect(runMetrics(dir).usd_reported).toBe(1);
  });
});

describe('costPerAcceptedUnit', () => {
  it('is spend over accepted units', () => {
    expect(costPerAcceptedUnit(6, 3)).toEqual({ value: 2, failed: false });
  });
  it('reports failure, not zero cost, when nothing was accepted', () => {
    expect(costPerAcceptedUnit(6, 0)).toEqual({ value: null, failed: true });
    expect(costPerAcceptedUnit(0, 0)).toEqual({ value: null, failed: true });
  });
});

describe('fixtureOutcome', () => {
  const manifest = {
    units: [
      { id: 'content', count: 1 },
      { id: 'research', count: 2 },
    ],
  } as unknown as ScenarioManifest;

  it('counts accepted units against the required counts, capped so fragments add nothing', () => {
    const r = fixtureOutcome(manifest, { content: 1, research: 5 });
    expect(r.accepted_units).toBe(3); // research capped at its required 2
    expect(r.required_units).toBe(3);
    expect(r.completed).toBe(true);
    expect(r.coverage).toBe(1);
  });

  it('is incomplete when any required unit is short, with partial coverage', () => {
    const r = fixtureOutcome(manifest, { content: 1, research: 1 });
    expect(r).toMatchObject({ accepted_units: 2, required_units: 3, completed: false });
    expect(r.coverage).toBeCloseTo(2 / 3);
    expect(r.missing).toEqual(['research']);
  });

  it('treats a unit absent from the review as zero accepted', () => {
    expect(fixtureOutcome(manifest, {}).accepted_units).toBe(0);
  });
});
