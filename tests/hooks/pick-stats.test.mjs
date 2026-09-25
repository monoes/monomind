/**
 * .claude/helpers/pick-stats.cjs — incremental aggregation of pick adherence
 * and outcomes into .monomind/pick-stats.json, and the bounded ranking prior.
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PS_PATH = path.resolve(__dirname, '../../.claude/helpers/pick-stats.cjs');
const PC_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/pick-core.cjs');
const ps = require(PS_PATH);

let tmp;
let mono;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-stats-'));
  mono = path.join(tmp, '.monomind');
  fs.mkdirSync(mono, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const append = (name, recs) =>
  fs.appendFileSync(path.join(mono, name), recs.map((r) => `${JSON.stringify(r)}\n`).join(''));
const rewrite = (name, text) => {
  // Same shape as atomicWrite: a new inode renamed over the old one.
  const f = path.join(mono, name);
  fs.writeFileSync(`${f}.tmp`, text);
  fs.renameSync(`${f}.tmp`, f);
};

let clock = 1_000_000;
const route = (o) => ({ routeId: `r${clock}`, ts: clock++, shown: true, ...o });
// Each adherence record is its own route unless a test says otherwise.
const adh = (o) => ({ ts: clock, routeId: `a${clock++}`, ...o });
const fb = (o) => ({ timestamp: new Date(clock++).toISOString(), ...o });

describe('update: aggregation', () => {
  it('counts routes, adherence and outcomes per agent and in totals', () => {
    append('route-outcomes.jsonl', [
      route({ agentName: 'coder', skill: '/tdd' }),
      route({ agentName: 'coder' }),
      route({ agentName: null, shown: false }),
    ]);
    append('pick-adherence.jsonl', [
      adh({ recommended: 'coder', actual: 'coder', followed: true }),
      adh({ recommended: 'coder', actual: 'reviewer', followed: false }),
      adh({ recommended: null, actual: 'tester', followed: null }),
    ]);
    append('routing-feedback.jsonl', [
      fb({ actualAgent: 'coder', followed: true, intelligenceFeedback: true }),
      fb({ actualAgent: 'reviewer', followed: false, intelligenceFeedback: false }),
      fb({ suggestedAgent: 'coder', intelligenceFeedback: true }), // session-level: no actualAgent
    ]);
    const s = ps.update(tmp);
    expect(s.totals).toMatchObject({
      routes: 3,
      shown: 2,
      spawns: 3,
      unpicked: 1,
      followed: 1,
      overridden: 1,
      followedSuccess: 1,
      overriddenFailure: 1,
    });
    expect(s.agents.coder).toMatchObject({
      recommended: 2,
      followed: 1,
      overridden: 1,
      success: 1,
    });
    expect(s.agents.reviewer).toMatchObject({ chosen: 1, failure: 1 });
    expect(s.skills['/tdd']).toEqual({ recommended: 1 });
    expect(
      JSON.parse(fs.readFileSync(path.join(mono, 'pick-stats.json'), 'utf-8')).totals.routes,
    ).toBe(3);
  });

  it('reads only new lines on the next update (stored offset)', () => {
    append('pick-adherence.jsonl', [
      adh({ recommended: 'coder', actual: 'coder', followed: true }),
    ]);
    ps.update(tmp);
    append('pick-adherence.jsonl', [
      adh({ recommended: 'coder', actual: 'coder', followed: true }),
    ]);
    const s = ps.update(tmp);
    expect(s.totals.followed).toBe(2);
    expect(ps.update(tmp).totals.followed).toBe(2);
  });

  it('skips corrupt lines and leaves a partial trailing line for later', () => {
    const f = path.join(mono, 'pick-adherence.jsonl');
    fs.writeFileSync(
      f,
      '{not json\n' +
        JSON.stringify(adh({ recommended: 'a', actual: 'a', followed: true })) +
        '\n[1,2]\n{"recommended":"a","actual":"a","follo',
    );
    expect(ps.update(tmp).totals.followed).toBe(1);
    fs.appendFileSync(f, `wed":true,"ts":${clock++}}\n`);
    expect(ps.update(tmp).totals.followed).toBe(2);
  });

  it('does not double count after rotation or an in-place rewrite', () => {
    const lines = [1, 2, 3, 4].map(() => route({ agentName: 'coder' }));
    append('route-outcomes.jsonl', lines);
    expect(ps.update(tmp).totals.routes).toBe(4);
    // joinOutcome: same records, grown in place, new inode — plus one new line.
    const joined = lines.map((r) => ({ ...r, measuredSuccess: true }));
    const fresh = route({ agentName: 'coder' });
    rewrite(
      'route-outcomes.jsonl',
      `${[...joined, fresh].map((r) => JSON.stringify(r)).join('\n')}\n`,
    );
    expect(ps.update(tmp).totals.routes).toBe(5);
    // Rotation: only the last two lines survive; nothing new.
    rewrite(
      'route-outcomes.jsonl',
      `${[joined[3], fresh].map((r) => JSON.stringify(r)).join('\n')}\n`,
    );
    expect(ps.update(tmp).totals.routes).toBe(5);
  });

  it('keeps records sharing the watermark timestamp apart', () => {
    const ts = clock++;
    append('pick-adherence.jsonl', [
      { ts, routeId: 'x', recommended: 'a', actual: 'a', followed: true },
    ]);
    ps.update(tmp);
    rewrite(
      'pick-adherence.jsonl',
      JSON.stringify({ ts, routeId: 'x', recommended: 'a', actual: 'a', followed: true }) +
        '\n' +
        JSON.stringify({ ts, routeId: 'y', recommended: 'a', actual: 'a', followed: true }) +
        '\n',
    );
    expect(ps.update(tmp).totals.followed).toBe(2);
  });

  it('caps the bytes read per update and the agents kept', () => {
    const recs = [];
    for (let i = 0; i < 20000; i++)
      recs.push(
        adh({
          recommended: `agent-${i}`,
          actual: `agent-${i}`,
          followed: true,
          pad: 'x'.repeat(40),
        }),
      );
    append('pick-adherence.jsonl', recs);
    const s = ps.update(tmp);
    expect(s.totals.spawns).toBeLessThan(20000);
    expect(s.totals.spawns).toBeGreaterThan(1000);
    expect(Object.keys(s.agents).length).toBeLessThanOrEqual(ps.MAX_ENTRIES);
    expect(s.cursors.adherence.offset).toBe(
      fs.statSync(path.join(mono, 'pick-adherence.jsonl')).size,
    );
  });

  it('never throws: missing files, corrupt stats, unwritable dir', () => {
    expect(ps.update(tmp).totals.routes).toBe(0);
    fs.writeFileSync(path.join(mono, 'pick-stats.json'), '{oops');
    expect(ps.update(tmp).totals.routes).toBe(0);
    expect(ps.update(path.join(tmp, 'file-not-dir', '\0bad'))).toBeNull();
  });

  it('persist:false computes without writing', () => {
    append('route-outcomes.jsonl', [route({ agentName: 'coder' })]);
    expect(ps.update(tmp, { persist: false }).totals.routes).toBe(1);
    expect(fs.existsSync(path.join(mono, 'pick-stats.json'))).toBe(false);
  });
});

describe('priorFactor / applyPriors', () => {
  it('is neutral below MIN_OBS and bounded to [0.85, 1.15]', () => {
    expect(ps.priorFactor(undefined)).toBe(1);
    expect(ps.priorFactor({ success: 2, failure: 0, followed: 1 })).toBe(1);
    const best = ps.priorFactor({ success: 1e6, followed: 1e6 });
    const worst = ps.priorFactor({ failure: 1e6, overridden: 1e6 });
    expect(best).toBeLessThanOrEqual(1.15);
    expect(best).toBeGreaterThan(1.1);
    expect(worst).toBeGreaterThanOrEqual(0.85);
    expect(worst).toBeLessThan(0.9);
  });

  const stats = {
    agents: {
      good: { name: 'good', success: 30, followed: 30 },
      bad: { name: 'bad', failure: 30, overridden: 30 },
    },
  };

  it('breaks a near-tie toward the historically successful agent', () => {
    const out = ps.applyPriors(
      [
        { id: 'bad', name: 'bad', score: 3.0 },
        { id: 'good', name: 'good', score: 2.9 },
      ],
      stats,
    );
    expect(out.map((r) => r.name)).toEqual(['good', 'bad']);
    expect(out[0]).toMatchObject({ baseScore: 2.9 });
    expect(out[0].prior).toBeGreaterThan(1);
  });

  it('cannot flip a strong relevance gap (a lead that qualifies as a pick)', () => {
    const pc = require(PC_PATH);
    const out = ps.applyPriors(
      [
        { id: 'bad', name: 'bad', score: 3.0 * pc.KEYWORD_AGENT_LEAD },
        { id: 'good', name: 'good', score: 3.0 },
      ],
      stats,
    );
    expect(out[0].name).toBe('bad');
  });

  it('never promotes a zero-overlap item', () => {
    const out = ps.applyPriors(
      [
        { id: 'x', name: 'x', score: 0.01 },
        { id: 'good', name: 'good', score: 0 },
      ],
      stats,
    );
    expect(out[1]).toMatchObject({ name: 'good', score: 0, prior: 1 });
  });
});

describe('summarize', () => {
  it('reports rates and top agents', () => {
    append('pick-adherence.jsonl', [
      adh({ recommended: 'coder', actual: 'coder', followed: true }),
      adh({ recommended: 'coder', actual: 'reviewer', followed: false }),
    ]);
    append('routing-feedback.jsonl', [
      fb({ actualAgent: 'coder', followed: true, intelligenceFeedback: true }),
    ]);
    const sum = ps.summarize(ps.update(tmp));
    expect(sum).toMatchObject({
      routes: 0,
      shown: 0,
      spawns: 2,
      adherenceRate: 0.5,
      followedSuccessRate: 1,
      notFollowedSuccessRate: null,
    });
    expect(sum.topAgents[0]).toMatchObject({
      name: 'coder',
      followed: 1,
      overridden: 1,
      success: 1,
      successRate: 1,
      prior: 1,
    });
    expect(ps.summarize(null)).toMatchObject({ routes: 0, adherenceRate: null, topAgents: [] });
  });
});

describe('untrusted pick-stats.json', () => {
  const put = (s) => fs.writeFileSync(path.join(mono, 'pick-stats.json'), JSON.stringify(s));
  const file = (agents, totals = {}) => ({ version: 1, totals, cursors: {}, agents, skills: {} });

  it('keeps the prior inside [0.85, 1.15] whatever the counts claim', () => {
    expect(ps.priorFactor({ failure: -1.99, followed: 10 })).toBeLessThanOrEqual(1.15);
    expect(ps.priorFactor({ failure: -1.99, followed: 10 })).toBeGreaterThanOrEqual(0.85);
    expect(ps.priorFactor({ success: -1e9, overridden: 20 })).toBeGreaterThanOrEqual(0.85);
    expect(Number.isFinite(ps.priorFactor({ success: 'x', followed: 10 }))).toBe(true);
    expect(
      ps.priorFactor({ success: Number.NaN, followed: Number.POSITIVE_INFINITY }),
    ).toBeLessThanOrEqual(1.15);
  });

  it('sanitizes counts on load to finite non-negative integers', () => {
    put(
      file(
        { coder: { name: 'coder', failure: -1.99, followed: 10.7, success: 'x', chosen: null } },
        { routes: -4, shown: 'lots', spawns: 2.5 },
      ),
    );
    const s = ps.load(tmp);
    expect(s.agents.coder).toMatchObject({ failure: 0, followed: 10, success: 0, chosen: 0 });
    expect(s.totals).toMatchObject({ routes: 0, shown: 0, spawns: 2 });
  });

  it('drops malformed agent entries and never yields a NaN score', () => {
    put(file({ coder: 'nope', good: { name: 'good', success: 'x', followed: 10 }, arr: [1] }));
    const s = ps.load(tmp);
    expect(s.agents.coder).toBeUndefined();
    expect(s.agents.arr).toBeUndefined();
    const out = ps.applyPriors([{ id: 'good', name: 'good', score: 2 }], s);
    expect(Number.isFinite(out[0].score)).toBe(true);
    expect(out[0].score).toBeLessThanOrEqual(2 * 1.15);
  });
});

describe('dedupe across a rewrite', () => {
  it('counts two same-agent outcomes that share a millisecond', () => {
    const timestamp = new Date(clock++).toISOString();
    const one = { timestamp, actualAgent: 'coder', sessionId: 's', intelligenceFeedback: true };
    append('routing-feedback.jsonl', [one]);
    expect(ps.update(tmp).agents.coder.success).toBe(1);
    // A second subagent of the same type finishes in the same ms, then the
    // file is rotated (rewritten, new inode).
    rewrite('routing-feedback.jsonl', `${JSON.stringify(one)}\n${JSON.stringify(one)}\n`);
    expect(ps.update(tmp).agents.coder.success).toBe(2);
    // Nothing new: stays at 2.
    rewrite('routing-feedback.jsonl', `${JSON.stringify(one)}\n${JSON.stringify(one)}\n`);
    expect(ps.update(tmp).agents.coder.success).toBe(2);
  });

  it('tells subagents apart by agentId', () => {
    const timestamp = new Date(clock++).toISOString();
    const a = { timestamp, actualAgent: 'coder', agentId: 'a1', intelligenceFeedback: true };
    const b = { ...a, agentId: 'b2' };
    append('routing-feedback.jsonl', [a]);
    ps.update(tmp);
    rewrite('routing-feedback.jsonl', `${JSON.stringify(b)}\n${JSON.stringify(a)}\n`);
    expect(ps.update(tmp).agents.coder.success).toBe(2);
  });
});

describe('adherence counts once per route', () => {
  it('counts one follow per route, at its first matching spawn', () => {
    append('pick-adherence.jsonl', [
      // r1: the pick, spawned three times — one follow, not three.
      adh({ routeId: 'r1', recommended: 'coder', actual: 'coder', followed: true }),
      adh({ routeId: 'r1', recommended: 'coder', actual: 'coder', followed: true }),
      adh({ routeId: 'r1', recommended: 'coder', actual: 'coder', followed: true }),
      // r2: another agent first, then the pick — the route was followed.
      adh({ routeId: 'r2', recommended: 'coder', actual: 'reviewer', followed: false }),
    ]);
    ps.update(tmp);
    append('pick-adherence.jsonl', [
      adh({ routeId: 'r2', recommended: 'coder', actual: 'coder', followed: true }),
      // r3: never the pick — one override, its first choice counted.
      adh({ routeId: 'r3', recommended: 'coder', actual: 'reviewer', followed: false }),
      adh({ routeId: 'r3', recommended: 'coder', actual: 'tester', followed: false }),
    ]);
    const s = ps.update(tmp);
    expect(s.totals).toMatchObject({ spawns: 7, followed: 2, overridden: 1 });
    expect(s.agents.coder).toMatchObject({ followed: 2, overridden: 1 });
    expect(s.agents.reviewer.chosen).toBe(1);
    expect(s.agents.tester?.chosen ?? 0).toBe(0);
  });
});

describe('only registry agents are tracked', () => {
  const registry = (names) =>
    fs.writeFileSync(
      path.join(mono, 'registry.json'),
      JSON.stringify({ agents: names.map((n) => ({ slug: n, name: n })) }),
    );

  it('ignores names the registry does not hold, and drops ones already stored', () => {
    registry(['coder', 'reviewer']);
    fs.writeFileSync(
      path.join(mono, 'pick-stats.json'),
      JSON.stringify({
        version: 1,
        totals: {},
        agents: {
          'issue-337': { name: 'issue-337', chosen: 4 },
          coder: { name: 'coder', followed: 1 },
        },
      }),
    );
    append('pick-adherence.jsonl', [
      adh({ recommended: 'coder', actual: 'issue-337', followed: false }),
    ]);
    append('routing-feedback.jsonl', [
      fb({ actualAgent: 'issue-338', intelligenceFeedback: true }),
    ]);
    const s = ps.update(tmp);
    expect(Object.keys(s.agents).sort()).toEqual(['coder']);
    expect(s.agents.coder).toMatchObject({ followed: 1, overridden: 1 });
    expect(s.totals.overridden).toBe(1);
  });

  it('keeps every name when there is no registry to check against', () => {
    append('pick-adherence.jsonl', [
      adh({ recommended: 'coder', actual: 'issue-337', followed: false }),
    ]);
    expect(ps.update(tmp).agents['issue-337'].chosen).toBe(1);
  });
});

describe('slash-command routes', () => {
  it('are not picks: no route, no recommendation, no adherence', () => {
    append('route-outcomes.jsonl', [
      route({
        routeId: 'cmd',
        agentName: 'planner',
        promptPreview: '/mastermind:plan add caching',
      }),
      route({ agentName: 'coder', promptPreview: '/var/log/app.log shows a crash' }),
    ]);
    append('pick-adherence.jsonl', [
      adh({ routeId: 'cmd', recommended: 'planner', actual: 'planner', followed: true }),
    ]);
    const s = ps.update(tmp);
    expect(s.totals).toMatchObject({ routes: 1, shown: 1, followed: 0, unpicked: 1 });
    expect(s.agents.planner).toBeUndefined();
  });
});
