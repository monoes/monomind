// Planning, cost estimate, spend guard, agent-exec output parsing and summaries
// of the paid A/B runner. Nothing here spawns an agent or spends money.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without type declarations
import {
  estimatePlan,
  parseExecOutput,
  planRuns,
  runCostUsd,
  SpendGuard,
  summarizeRuns,
  wilson,
} from './lib.mjs';

describe('planRuns', () => {
  const tasks = [{ id: 't1' }, { id: 't2' }];
  const arms = ['off', 'lean', 'full'];

  it('plans every task x arm x rep once and is deterministic per seed', () => {
    const a = planRuns({ tasks, arms, reps: 2, seed: 7 });
    const b = planRuns({ tasks, arms, reps: 2, seed: 7 });
    expect(a).toHaveLength(12);
    expect(a).toEqual(b);
    const keys = new Set(
      a.map(
        (r: { task: { id: string }; arm: string; rep: number }) => `${r.task.id}/${r.arm}/${r.rep}`,
      ),
    );
    expect(keys.size).toBe(12);
    expect(planRuns({ tasks, arms, reps: 2, seed: 8 })).not.toEqual(a);
  });
});

describe('cost estimate', () => {
  const price = { inPerMtok: 3, outPerMtok: 15 };
  const specs = {
    off: { assume: { inputTokens: 100_000, outputTokens: 10_000 } },
    full: { assume: { inputTokens: 200_000, outputTokens: 10_000 } },
  };

  it('prices a run from tokens per million', () => {
    expect(runCostUsd(specs.off.assume, price)).toBeCloseTo(0.45);
  });

  it('sums a plan per arm', () => {
    const runs = [{ arm: 'off' }, { arm: 'off' }, { arm: 'full' }];
    const e = estimatePlan(runs, specs, price);
    expect(e.perArm.off).toMatchObject({ runs: 2 });
    expect(e.perArm.off.usd).toBeCloseTo(0.9);
    expect(e.perArm.full.perRunUsd).toBeCloseTo(0.75);
    expect(e.totalUsd).toBeCloseTo(1.65);
  });
});

describe('SpendGuard', () => {
  it('refuses a run that would pass the cap and charges the estimate for unreported cost', () => {
    const g = new SpendGuard(1);
    expect(g.canStart(0.6)).toBe(true);
    expect(g.record(0.6, 0.6)).toEqual({ chargedUsd: 0.6, costKnown: true });
    expect(g.canStart(0.5)).toBe(false);
    expect(g.canStart(0.4)).toBe(true);
    expect(g.record(null, 0.3)).toEqual({ chargedUsd: 0.3, costKnown: false });
    expect(g.spentUsd).toBeCloseTo(0.9);
    expect(g.remainingUsd).toBeCloseTo(0.1);
  });

  it('rejects a missing or non-positive cap', () => {
    for (const bad of [0, -1, Number.NaN, undefined]) expect(() => new SpendGuard(bad)).toThrow();
  });
});

describe('parseExecOutput', () => {
  it('reads result, error, exit code and counts native and monomind tool calls', () => {
    const lines = [
      '{"v":1,"type":"start","runtime":"claude"}',
      '{"v":1,"type":"tool_activity","phase":"start","name":"Bash","kind":"shell","id":"a"}',
      '{"v":1,"type":"tool_activity","phase":"end","name":"Bash","id":"a","ok":true}',
      '{"v":1,"type":"tool_activity","phase":"start","name":"mcp__monomind__monograph_query","kind":"mcp","id":"b"}',
      'not json',
      '{"v":1,"type":"result","subtype":"success","input_tokens":1200,"output_tokens":300,"cost_usd":0.12,"stop_reason":"end_turn"}',
      '{"v":1,"type":"done","exit_code":0}',
    ].join('\n');
    const p = parseExecOutput(lines);
    expect(p.result).toMatchObject({ input_tokens: 1200, cost_usd: 0.12 });
    expect(p.exitCode).toBe(0);
    expect(p.toolCalls).toEqual({ total: 2, byKind: { shell: 1, mcp: 1 }, monomind: 1 });
    expect(p.error).toBeNull();
  });

  it('keeps the first error and tolerates empty output', () => {
    expect(
      parseExecOutput(
        '{"v":1,"type":"error","code":"budget","message":"over"}\n{"v":1,"type":"done","exit_code":1}',
      ).error,
    ).toEqual({ code: 'budget', message: 'over' });
    expect(parseExecOutput('').result).toBeNull();
  });
});

describe('wilson and summarizeRuns', () => {
  it('gives a sane interval and a zero for no runs', () => {
    const w = wilson(8, 10);
    expect(w.rate).toBe(0.8);
    expect(w.lo).toBeLessThan(0.8);
    expect(w.hi).toBeGreaterThan(0.8);
    expect(wilson(0, 0)).toEqual({ rate: 0, lo: 0, hi: 0 });
  });

  it('summarizes per arm, leaves skipped runs out of the rates and null cost out of the means', () => {
    const runs = [
      {
        arm: 'off',
        status: 'done',
        success: true,
        tokens: { input: 900, output: 100 },
        costUsd: 0.2,
        wallMs: 1000,
      },
      {
        arm: 'off',
        status: 'done',
        success: false,
        tokens: { input: 1900, output: 100 },
        costUsd: null,
        wallMs: 3000,
      },
      { arm: 'off', status: 'skipped' },
      {
        arm: 'full',
        status: 'done',
        success: true,
        tokens: { input: 500, output: 500 },
        costUsd: 0.4,
        wallMs: 2000,
      },
    ];
    const s = summarizeRuns(runs);
    expect(s.off).toMatchObject({
      runs: 3,
      completed: 2,
      skipped: 1,
      tokensMean: 1500,
      wallMsMean: 2000,
      costUsdMean: 0.2,
      costUsdTotal: 0.2,
    });
    expect(s.off.success).toMatchObject({ count: 1, rate: 0.5 });
    expect(s.off.costUsdPerSuccess).toBeCloseTo(0.2);
    expect(s.full.success.rate).toBe(1);
  });
});
