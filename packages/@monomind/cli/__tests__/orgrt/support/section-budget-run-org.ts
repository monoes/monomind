// packages/@monomind/cli/__tests__/orgrt/support/section-budget-run-org.ts
// Shared by the P4.6 tests: `CostRunner` of the P4.5 support that also records what each role was sent, so a test
// can see the budget notices arrive. The org is `budgetedOrg`: research 30 (research-lead 10, researcher 20),
// development 30 (dev-lead 10, coder 20), root reserve 40 (boss 20, observer 10), org 100.
import { rmSync } from 'node:fs';
import { afterEach, expect } from 'vitest';
import type { AgentMessage, AgentRunArgs, AgentRunner } from '../../../src/orgrt/agent-runner.js';
import type { BusEvent } from '../../../src/orgrt/types.js';
import { budgetedOrg, newOrgRoot, type Started, startAll, waitUntil } from './section-budget-org.js';

export class RecordingCostRunner implements AgentRunner {
  private sessions = 0;
  /** Everything each role was sent, in order. */
  readonly turns = new Map<string, string[]>();
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const role = args.env.MONOMIND_ORG_ROLE;
    const sid = `cost-${++this.sessions}`;
    let total = 0;
    for await (const m of args.prompt as AsyncIterable<{ message?: { content?: unknown } }>) {
      const text = String(m.message?.content ?? '');
      this.turns.set(role, [...(this.turns.get(role) ?? []), text]);
      total += Number(/cost=([\d.]+)/.exec(text)?.[1] ?? 0);
      yield { type: 'assistant', text: 'ok', session_id: sid } as AgentMessage;
      yield {
        type: 'result',
        subtype: 'success',
        input_tokens: 1,
        output_tokens: 1,
        session_id: sid,
        cost_usd: total,
      } as AgentMessage;
    }
  }
  /** The subjects of the budget notices a role was sent (`[message from org-docs] subject: budget: ...`), in order. */
  budget(role: string): string[] {
    return (this.turns.get(role) ?? [])
      .flatMap((t) => [...t.matchAll(/\[message from org-docs\] subject: (budget: [^\n]*)/g)].map((m) => m[1]));
  }
  /** The whole text of the budget notices a role was sent (header, subject and body). */
  budgetTexts(role: string): string[] {
    return (this.turns.get(role) ?? []).flatMap((t) =>
      [...t.matchAll(/\[message from org-docs\] subject: budget: [^\n]*\n\n[^\n]*/g)].map((m) => m[0]),
    );
  }
}

/** The harness of the P4.6 daemon tests: one temp org root per test, torn down after it. */
export function harness() {
  const started: Started[] = [];
  const saved = { ...process.env };
  afterEach(async () => {
    await Promise.all(
      started.splice(0).map(async (s) => {
        await s.daemon.stopAll().catch(() => {});
        rmSync(s.root, { recursive: true, force: true });
      }),
    );
    for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  });
  async function run(patch: (r: Record<string, any>) => void = () => {}, base = budgetedOrg) {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    const runner = new RecordingCostRunner();
    const raw = base((r) => {
      Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
      patch(r);
    });
    const s = newOrgRoot(raw, runner);
    started.push(s);
    return { s, runner, running: await startAll(s), raw };
  }
  /** Send `cost=<usd>` to a role and wait until its live metrics show `total` (this incarnation's spend). */
  async function spend(s: Started, running: any, roleId: string, usd: number, total: number) {
    await s.daemon.deliver(s.name, 'human', roleId, `work cost=${usd}`, 'work');
    expect(
      await waitUntil(() => Math.abs((running.agents.get(roleId)?.metrics.costUsd ?? 0) - total) < 1e-9),
      `${roleId} spend`,
    ).toBe(true);
  }
  return { started, run, spend };
}

export const eventsOf = (running: { busEvents: () => BusEvent[] }, reason: string): BusEvent[] =>
  running.busEvents().filter((e) => e.reason === reason);

/** Wait until `role` has been sent `n` budget notices; returns their subjects. */
export async function budgetNotices(runner: RecordingCostRunner, role: string, n: number): Promise<string[]> {
  await waitUntil(() => runner.budget(role).length >= n, 5000);
  return runner.budget(role);
}

/** Wait a little for a thing that must NOT happen. */
export const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));
