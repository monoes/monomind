/**
 * #343: a role closed because its budget_usd ran out left every task later
 * assigned to it 'ready' forever, with only a bus warning that the assignee was
 * "crashed or unreachable" — the coordinator read it as a dispatch stall. And
 * budget_usd could not be raised on a running org: reload ignored it.
 *
 * These drive a real OrgDaemon with a fake SDK whose per-message cost is read
 * from the message text (`cost=<usd>`), and its input tokens (`tok=<n>`).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon, type RunningOrg } from '../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../src/orgrt/decisions.js';

function writeOrg(root: string, runConfig: object, roleBudgets: Record<string, object>): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  const role = (id: string, extra: object) => ({
    id,
    title: id,
    type: id === 'boss' ? 'boss' : 'specialist',
    reports_to: id === 'boss' ? null : 'boss',
    ...extra,
  });
  writeFileSync(
    join(root, '.monomind/orgs/o.json'),
    JSON.stringify({
      name: 'o',
      goal: 'g',
      run_config: runConfig,
      roles: Object.entries(roleBudgets).map(([id, extra]) => role(id, extra)),
    }),
  );
}

function writeDef(root: string, devBudgetUsd: number): void {
  writeOrg(root, {}, { boss: {}, dev: { budget_usd: devBudgetUsd } });
}

let seq = 0;
// Each process is a new SDK session; its total_cost_usd is cumulative within it.
const costQuery = ({ prompt }: any) =>
  (async function* () {
    const sid = `sess-${++seq}`;
    let total = 0;
    for await (const m of prompt) {
      const text = String(m.message.content);
      let tok = 0;
      // Coalesced lines arrive joined; a turn-end nudge repeats the task
      // title, so only the dispatch lines cost.
      for (const part of text.split('\n\n')) {
        if (part.includes('STILL OPEN')) continue;
        total += Number(/cost=([\d.]+)/.exec(part)?.[1] ?? 0);
        tok += Number(/tok=(\d+)/.exec(part)?.[1] ?? 0);
      }
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
      yield {
        type: 'result',
        subtype: 'success',
        session_id: sid,
        usage: { input_tokens: tok || 1, output_tokens: 1 },
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

async function start(devBudgetUsd: number, write?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'budget-closure-'));
  if (write) write(root);
  else writeDef(root, devBudgetUsd);
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

/** Roles with their own large budget_tokens, so only the org-wide
 *  run_config.budget_tokens ceiling can close them. */
const orgCapped = (orgTokens: number) => (root: string) =>
  writeOrg(
    root,
    { budget_tokens: orgTokens },
    { boss: { budget_tokens: 50_000 }, dev: { budget_tokens: 50_000 } },
  );

const orgExhausted = (running: RunningOrg) =>
  running.busEvents().filter((e) => e.reason === 'org-budget-exhausted').length;

describe('#343 — run_config.budget_tokens hot reload', () => {
  it('reopens roles the org-wide ceiling closed once raised past org spend, and keeps enforcing it', async () => {
    const { root, d, running } = await start(0, orgCapped(1000));
    const first = JSON.parse(dagCreateTask(d, 'o', 'boss', 'first tok=1200', 'dev', []));
    expect(await waitUntil(() => orgExhausted(running) === 1)).toBe(true);
    const orgReason = /assignee "dev" closed: org-wide budget_tokens exhausted \(\d+ \/ 1000\)/;
    // the task dev was working is held too, not left 'running'
    expect(await waitUntil(() => running.taskDag!.get(first.id)?.status === 'blocked')).toBe(true);
    expect(running.taskDag!.get(first.id)?.blockedReason).toMatch(orgReason);
    const second = JSON.parse(dagCreateTask(d, 'o', 'boss', 'second tok=5', 'dev', []));
    expect(running.taskDag!.get(second.id)?.status).toBe('blocked');

    // Not enough: still closed, the reason carries the new ceiling.
    orgCapped(1100)(root);
    expect(d.reloadOrgDef('o').changed).toContain('run_config.budget_tokens');
    expect(running.agents.get('dev')!.mailbox.isClosed).toBe(true);
    expect(running.agents.get('boss')!.mailbox.isClosed).toBe(true);
    expect(running.taskDag!.get(second.id)?.blockedReason).toMatch(/\(\d+ \/ 1100\)/);

    orgCapped(10_000)(root);
    d.reloadOrgDef('o');
    const dev = running.agents.get('dev')!;
    expect(dev.mailbox.isClosed).toBe(false);
    expect(running.agents.get('boss')!.mailbox.isClosed).toBe(false);
    // spend carried over: the ceiling applies to the whole run's total
    expect(dev.policy.budgetedUsage).toBeGreaterThanOrEqual(1201);
    for (const id of [first.id, second.id]) {
      expect(running.taskDag!.get(id)?.status).toBe('running');
      expect(running.taskDag!.get(id)?.blockedReason).toBeUndefined();
    }
    expect(running.busEvents().some((e) => e.reason === 'org-budget-reopened')).toBe(true);

    // The limit is re-armed at the new value, not switched off.
    dagCreateTask(d, 'o', 'boss', 'third tok=9000', 'dev', []);
    expect(await waitUntil(() => orgExhausted(running) === 2)).toBe(true);
    expect(await waitUntil(() => running.agents.get('dev')!.mailbox.isClosed)).toBe(true);
    const last = running.busEvents().filter((e) => e.reason === 'org-budget-exhausted')[1];
    expect(last.msg).toMatch(/\/10000\)/);
  }, 20_000);
});

describe('#343 — even split of run_config.budget_tokens on reload', () => {
  const split = (orgTokens: number, devTokens?: number) => (root: string) =>
    writeOrg(
      root,
      { budget_tokens: orgTokens },
      { boss: {}, dev: devTokens == null ? {} : { budget_tokens: devTokens }, qa: {} },
    );

  it("recomputes live roles' split caps and reopens a role closed on its old share", async () => {
    const { root, d, running } = await start(0, split(3000));
    const boss = running.agents.get('boss')!;
    expect(boss.policy.policy.maxTokens).toBe(1000);
    dagCreateTask(d, 'o', 'boss', 'big tok=1200', 'dev', []);
    expect(
      await waitUntil(() => running.agents.get('dev')?.mailbox.closeReason === 'token-budget'),
    ).toBe(true);

    split(9000)(root);
    d.reloadOrgDef('o');
    expect(boss.policy.policy.maxTokens).toBe(3000);
    const dev = running.agents.get('dev')!;
    expect(dev.mailbox.isClosed).toBe(false);
    expect(dev.policy.policy.maxTokens).toBe(3000);

    // A role taking its own budget_tokens shrinks the others' share.
    split(9000, 5000)(root);
    d.reloadOrgDef('o');
    expect(boss.policy.policy.maxTokens).toBe(2000);
    expect(running.agents.get('dev')!.policy.policy.maxTokens).toBe(5000);
  }, 20_000);
});
