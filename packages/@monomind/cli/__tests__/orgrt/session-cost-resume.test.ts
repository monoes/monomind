// packages/@monomind/cli/__tests__/orgrt/session-cost-resume.test.ts
//
// The SDK's total_cost_usd and modelUsage are cumulative per CLI PROCESS, and a
// resumed session runs in a new process. Claude Code carries the old total into
// the new process only when the resumed session was the last one to exit in
// that project directory — in an org, with several roles sharing a cwd, it
// usually starts again from zero. Deltas keyed by session id alone turned the
// first turn after such a resume into max(0, small - previous) = 0: on the
// 2.16.0 release run nine turns of >100k tokens were billed at ~$0.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { CumulativeMeter } from '../../src/orgrt/cumulative-meter.js';

const dir = () => mkdtempSync(join(tmpdir(), 'sess-cost-'));
const role = { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any;

/** Process 1 answers one message; every later process answers the rest. Each
 *  process reports its own cumulative series for the SAME session id. */
async function runProcesses(series: number[][], tokens?: number[][]) {
  const bus = new OrgBus('o', 'r', dir());
  const costs: number[] = [];
  const toks: number[] = [];
  bus.subscribe((e) => {
    if (e.type !== 'usage') return;
    costs.push((e.data as { cost_usd: number }).cost_usd);
    toks.push((e.data as { tokens: number }).tokens);
  });
  const mailbox = new Mailbox();
  const total = series.reduce((n, s) => n + s.length, 0);
  for (let i = 0; i < total; i++) mailbox.push(`m${i}`);
  const resumes: (string | undefined)[] = [];
  let call = 0;
  const fakeQuery = ({ prompt, options }: any) =>
    (async function* () {
      const mine = series[call];
      const mineTok = tokens?.[call];
      call++;
      resumes.push(options?.resume);
      const it = prompt[Symbol.asyncIterator]();
      for (let i = 0; i < mine.length; i++) {
        await it.next();
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'sdk-sess',
          usage: { input_tokens: 0, output_tokens: 0 },
          ...(mineTok
            ? { modelUsage: { m: { inputTokens: mineTok[i], outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } }
            : {}),
          total_cost_usd: mine[i],
        };
      }
      if (call === series.length) mailbox.close();
    })();
  const policy = new PolicyEngine('coder', {}, bus, '/work');
  await runAgentSession({
    org: 'o', role, bus, policy, mailbox, cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeQuery as any,
  });
  return { costs, toks, policy, resumes };
}

describe('per-turn cost after a resume in a new process', () => {
  it('counts the new process from its own zero when the cumulative restarted', async () => {
    const { costs, policy, resumes } = await runProcesses([[2.0], [0.3, 0.5]]);
    expect(resumes).toEqual([undefined, 'sdk-sess']); // really a resume of the same session
    expect(costs[0]).toBeCloseTo(2.0);
    expect(costs[1]).toBeCloseTo(0.3);
    expect(costs[2]).toBeCloseTo(0.2);
    expect(policy.usageUsd).toBeCloseTo(2.5);
  });

  it('still counts only the increase when the new process carried the old total over', async () => {
    const { costs, policy } = await runProcesses([[2.0], [2.3, 2.5]]);
    expect(costs.map((c) => Number(c.toFixed(6)))).toEqual([2.0, 0.3, 0.2]);
    expect(policy.usageUsd).toBeCloseTo(2.5);
  });

  it('does the same for cumulative modelUsage tokens', async () => {
    const { toks, policy } = await runProcesses([[1], [1, 1]], [[2000], [300, 500]]);
    expect(toks).toEqual([2000, 300, 200]);
    expect(policy.usage).toBe(2500);
  });
});

describe('CumulativeMeter', () => {
  it('turns a cumulative series into deltas and floors a same-process dip at 0', () => {
    const m = new CumulativeMeter<{ usd: number }>();
    m.newProcess();
    expect(m.delta('s', { usd: 1 }).usd).toBe(1);
    expect(m.delta('s', { usd: 1.5 }).usd).toBe(0.5);
    expect(m.delta('s', { usd: 1.4 }).usd).toBe(0);
  });

  it('keeps sessions apart', () => {
    const m = new CumulativeMeter<{ usd: number }>();
    m.newProcess();
    expect(m.delta('a', { usd: 1 }).usd).toBe(1);
    expect(m.delta('b', { usd: 0.5 }).usd).toBe(0.5);
  });
});
