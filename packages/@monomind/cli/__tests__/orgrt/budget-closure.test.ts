/**
 * #343: a role closed because its budget_usd ran out left every task later
 * assigned to it 'ready' forever, with only a bus warning that the assignee was
 * "crashed or unreachable" — the coordinator read it as a dispatch stall. And
 * budget_usd could not be raised on a running org: reload ignored it.
 *
 * These drive a real OrgDaemon with a fake SDK whose per-message cost is read
 * from the message text (`cost=<usd>`).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon, type RunningOrg } from '../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../src/orgrt/decisions.js';

function writeDef(root: string, devBudgetUsd: number): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/o.json'),
    JSON.stringify({
      name: 'o',
      goal: 'g',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss', budget_usd: devBudgetUsd },
      ],
    }),
  );
}

let seq = 0;
// Each process is a new SDK session; its total_cost_usd is cumulative within it.
const costQuery = ({ prompt }: any) =>
  (async function* () {
    const sid = `sess-${++seq}`;
    let total = 0;
    for await (const m of prompt) {
      const text = String(m.message.content);
      // Coalesced lines arrive joined; a turn-end nudge repeats the task
      // title, so only the dispatch lines cost.
      for (const part of text.split('\n\n')) {
        if (!part.includes('STILL OPEN')) total += Number(/cost=([\d.]+)/.exec(part)?.[1] ?? 0);
      }
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
      yield {
        type: 'result',
        subtype: 'success',
        session_id: sid,
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: total,
      };
    }
  })();

async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

/** Every message pushed into the boss's mailbox. */
function recordBossMail(running: RunningOrg): string[] {
  const got: string[] = [];
  const box = running.agents.get('boss')!.mailbox;
  const push = box.push.bind(box);
  box.push = (m: string) => {
    got.push(m);
    return push(m);
  };
  return got;
}

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

async function start(devBudgetUsd: number) {
  const root = mkdtempSync(join(tmpdir(), 'budget-closure-'));
  writeDef(root, devBudgetUsd);
  daemon = new OrgDaemon(root, { queryFn: costQuery as any, forward: false });
  const running = await daemon.startOrg('o');
  const bossMail = recordBossMail(running);
  return { root, d: daemon, running, bossMail };
}

async function exhaustDev(d: OrgDaemon, running: RunningOrg) {
  const first = JSON.parse(dagCreateTask(d, 'o', 'boss', 'first cost=1.2', 'dev', []));
  expect(
    await waitUntil(() => running.agents.get('dev')?.mailbox.closeReason === 'usd-budget'),
  ).toBe(true);
  return first.id as string;
}

describe('#343 — task assigned to a budget-closed role', () => {
  it('is blocked with the budget reason, the warning says so, and the coordinator is told once', async () => {
    const { d, running, bossMail } = await start(1);
    const firstId = await exhaustDev(d, running);
    const reason = /assignee "dev" closed: budget_usd exhausted \(\$1\.20 \/ \$1\)/;
    // the task it was working when it closed is held too, not left 'running'
    expect(running.taskDag!.get(firstId)?.status).toBe('blocked');
    expect(running.taskDag!.get(firstId)?.blockedReason).toMatch(reason);

    const second = JSON.parse(dagCreateTask(d, 'o', 'boss', 'second cost=0.1', 'dev', []));
    const task = running.taskDag!.get(second.id)!;
    expect(task.status).toBe('blocked');
    expect(task.blockedReason).toMatch(reason);

    const warnings = running
      .busEvents()
      .filter((e) => e.reason === 'dispatch-recipient-unavailable' && e.data?.taskId === second.id);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toMatch(/budget exhausted/);
    expect(warnings[0].msg).not.toMatch(/crashed or unreachable/);

    await waitUntil(() => bossMail.some((m) => m.includes(second.id)), 2000);
    const notices = bossMail.filter((m) => m.includes('budget_usd exhausted'));
    expect(notices.some((m) => m.includes(second.id))).toBe(true);
    // one notice for the closure, one for the task assigned afterwards
    expect(notices.filter((m) => m.includes(second.id))).toHaveLength(1);
  }, 20_000);
});

describe('#343 — budget_usd hot reload', () => {
  it('keeps the role closed when the new cap is still spent, and reopens it when raised enough', async () => {
    const { root, d, running } = await start(1);
    const firstId = await exhaustDev(d, running);
    const second = JSON.parse(dagCreateTask(d, 'o', 'boss', 'second cost=0.1', 'dev', []));

    writeDef(root, 1.1);
    const res = d.reloadOrgDef('o');
    expect(res.changed).toContain('role:dev:budget_usd');
    expect(running.agents.get('dev')!.mailbox.isClosed).toBe(true);
    expect(running.taskDag!.get(second.id)?.status).toBe('blocked');
    expect(running.taskDag!.get(second.id)?.blockedReason).toMatch(/\(\$1\.20 \/ \$1\.1\)/);

    writeDef(root, 5);
    d.reloadOrgDef('o');
    const dev = running.agents.get('dev')!;
    expect(dev.mailbox.isClosed).toBe(false);
    // cumulative: the new cap applies to total spend, not a fresh meter
    expect(dev.policy.usageUsd).toBeCloseTo(1.2);
    expect(dev.policy.policy.maxUsd).toBe(5);
    for (const id of [firstId, second.id]) {
      expect(running.taskDag!.get(id)?.status).toBe('running');
      expect(running.taskDag!.get(id)?.blockedReason).toBeUndefined();
    }
    expect(running.busEvents().some((e) => e.reason === 'role-budget-reopened')).toBe(true);
    // the reopened role actually works the re-dispatched tasks
    expect(await waitUntil(() => dev.policy.usageUsd > 1.2 + 1e-9)).toBe(true);
    expect(dev.mailbox.isClosed).toBe(false);
  }, 20_000);
});

describe('#343 — 80% budget_usd warning', () => {
  it('tells the coordinator once when a role passes 80% of its budget_usd', async () => {
    const { d, running, bossMail } = await start(1);
    dagCreateTask(d, 'o', 'boss', 'a cost=0.85', 'dev', []);
    expect(
      await waitUntil(() => running.busEvents().some((e) => e.reason === 'budget-warning')),
    ).toBe(true);
    dagCreateTask(d, 'o', 'boss', 'b cost=0.05', 'dev', []);
    expect(await waitUntil(() => running.agents.get('dev')!.policy.usageUsd > 0.89)).toBe(true);
    await waitUntil(() => bossMail.some((m) => m.includes('budget_usd')), 2000);
    expect(running.busEvents().filter((e) => e.reason === 'budget-warning')).toHaveLength(1);
    const notices = bossMail.filter((m) => m.includes('budget_usd'));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/"dev" has spent \$0\.85 of its \$1 budget_usd \(85%\)/);
    expect(running.agents.get('dev')!.mailbox.isClosed).toBe(false);
  }, 20_000);
});
