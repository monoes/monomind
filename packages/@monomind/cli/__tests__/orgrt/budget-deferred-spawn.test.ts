/**
 * #552: once run_config.budget_tokens was spent, enforceOrgBudget closed every
 * open mailbox and cleared pendingRoles — but a role whose spawn was already
 * deferred by max_concurrent_agents kept its retry loop, which spawned it with
 * an open mailbox after "closing all roles" as soon as the closure freed a
 * slot. It then ran until idle-stop.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRoleCount, OrgDaemon, type RunningOrg } from '../../src/orgrt/daemon.js';
import { orgBudgetedUsage } from '../../src/orgrt/budget-closure.js';
import { dagCreateTask } from '../../src/orgrt/decisions.js';

function writeOrg(
  root: string,
  budgetTokens: number,
  opts: { maxConcurrent?: number; extraRoles?: string[]; runConfig?: object } = {},
): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  const role = (id: string) => ({
    id,
    title: id,
    type: id === 'boss' ? 'boss' : 'specialist',
    reports_to: id === 'boss' ? null : 'boss',
    // Own large caps, so only the org-wide ceiling can close them.
    budget_tokens: 50_000,
  });
  writeFileSync(
    join(root, '.monomind/orgs/o.json'),
    JSON.stringify({
      name: 'o',
      goal: 'g',
      run_config: {
        budget_tokens: budgetTokens,
        max_concurrent_agents: opts.maxConcurrent ?? 2,
        ...opts.runConfig,
      },
      roles: ['boss', 'workerA', 'workerB', 'workerC', ...(opts.extraRoles ?? [])].map(role),
    }),
  );
}

// A message's input tokens are read from its text: the largest `tok=<n>` in
// it (a coalesced turn-end nudge can repeat an earlier task's title).
const received = new Map<string, string[]>();
// Tokens every session has reported and had consumed (input + output: the
// budgeted basis) — the org's true spend, counted outside the runtime.
let reported = 0;
const got = (role: string, text: string) => (received.get(role) ?? []).some((m) => m.includes(text));
const tokQuery = ({ prompt, options }: any) =>
  (async function* () {
    const roleId = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1] ?? '?';
    for await (const m of prompt) {
      received.set(roleId, [...(received.get(roleId) ?? []), String(m.message.content)]);
      const toks = [...String(m.message.content).matchAll(/tok=(\d+)/g)].map((x) => Number(x[1]));
      const tok = Math.max(1, ...toks);
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'sess',
        usage: { input_tokens: tok, output_tokens: 1 },
        total_cost_usd: 0,
      };
      // Runs once the session pulled past the result, i.e. recorded it.
      reported += tok + 1;
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

const events = (running: RunningOrg, reason: string) =>
  running.busEvents().filter((e) => e.reason === reason);

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

/** boss + workerA fill max_concurrent_agents: 2, then a task for workerB
 *  defers its spawn. */
async function startWithDeferredWorkerB() {
  const root = mkdtempSync(join(tmpdir(), 'budget-deferred-spawn-'));
  received.clear();
  writeOrg(root, 1000);
  daemon = new OrgDaemon(root, {
    queryFn: tokQuery as any,
    forward: false,
    stopWaitMs: 200,
    crashBackoffsMs: [],
    concurrencyDeferPollMs: 30,
  });
  const running = await daemon.startOrg('o');
  const a1 = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'warm up tok=5', 'workerA', []));
  expect(running.agents.has('workerA')).toBe(true);
  expect(await waitUntil(() => running.taskDag!.get(a1.id)?.status === 'running')).toBe(true);
  const b = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'b work tok=5', 'workerB', []));
  expect(running.deferredSpawns?.has('workerB')).toBe(true);
  return { root, d: daemon, running, bTask: b.id as string };
}

describe('#552 — budget closure cancels deferred lazy spawns', () => {
  it('a spawn deferred by max_concurrent_agents does not start after the org-wide ceiling closes the org', async () => {
    const { root, d, running, bTask } = await startWithDeferredWorkerB();
    expect(await d.deliver('o', 'boss', 'workerB', 'note', 'hello B')).toMatch(/queued/);
    dagCreateTask(d, 'o', 'boss', 'spend tok=1200', 'workerA', []);
    expect(await waitUntil(() => events(running, 'org-budget-exhausted').length === 1)).toBe(true);
    // The closure frees the slots: from here on nothing but the closure
    // stops the deferred loop (polling every 30ms) from spawning workerB.
    expect(await waitUntil(() => activeRoleCount(running) < 2, 3000)).toBe(true);
    const polls = events(running, 'concurrency-limit').length;
    await new Promise((r) => setTimeout(r, 400)); // > 10 poll intervals with a free slot
    expect(activeRoleCount(running)).toBeLessThan(2);
    expect(events(running, 'concurrency-limit').length).toBe(polls); // the loop is gone

    expect(running.agents.has('workerB')).toBe(false);
    expect(events(running, 'concurrency-recovered')).toEqual([]);
    const cancelled = events(running, 'deferred-spawn-cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].from).toBe('workerB');
    expect(cancelled[0].msg).toMatch(/org-wide budget_tokens exhausted/);
    // Its task is held with the reason, not reported as an unknown assignee.
    const task = running.taskDag!.get(bTask)!;
    expect(task.status).toBe('blocked');
    expect(task.blockedReason).toMatch(
      /assignee "workerB" closed: org-wide budget_tokens exhausted \(\d+ \/ 1000\)/,
    );
    expect(events(running, 'dispatch-assignee-unresolved')).toEqual([]);

    // A reload that is not enough keeps it closed; its held task gets the
    // new numbers although workerB never spawned.
    writeOrg(root, 1100);
    d.reloadOrgDef('o');
    expect(running.taskDag!.get(bTask)?.blockedReason).toMatch(/\(\d+ \/ 1100\)/);

    // A reload that raises the ceiling brings it back: dispatch spawns it,
    // hands it its task and delivers the message queued while it waited.
    writeOrg(root, 100_000, { maxConcurrent: 5 });
    d.reloadOrgDef('o');
    expect(running.orgBudgetClosed).toBeUndefined();
    expect(running.agents.has('workerB')).toBe(true);
    expect(running.taskDag!.get(bTask)?.status).toBe('running');
    expect(await waitUntil(() => got('workerB', 'hello B'))).toBe(true);
  }, 20_000);

  it('a role a reload adds while the org is closed is set aside, and its task is held, not unresolved', async () => {
    const { root, d, running } = await startWithDeferredWorkerB();
    dagCreateTask(d, 'o', 'boss', 'spend tok=1200', 'workerA', []);
    expect(await waitUntil(() => events(running, 'org-budget-exhausted').length === 1)).toBe(true);
    writeOrg(root, 1100, { extraRoles: ['workerD'] });
    d.reloadOrgDef('o');
    expect(running.pendingRoles?.has('workerD')).toBe(false);
    expect(running.orgBudgetPendingRoles?.has('workerD')).toBe(true);
    const t = JSON.parse(dagCreateTask(d, 'o', 'boss', 'd work', 'workerD', []));
    expect(running.taskDag!.get(t.id)?.status).toBe('blocked');
    expect(running.taskDag!.get(t.id)?.blockedReason).toMatch(/org-wide budget_tokens exhausted/);
    expect(events(running, 'dispatch-assignee-unresolved')).toEqual([]);

    // spawnRole refusing a role a caller took out of pendingRoles keeps it too.
    const workerC = running.def.roles.find((r) => r.id === 'workerC')!;
    running.pendingRoles?.delete('workerC');
    running.spawnRole!(workerC);
    expect(running.orgBudgetPendingRoles?.has('workerC')).toBe(true);

    writeOrg(root, 100_000, { maxConcurrent: 6, extraRoles: ['workerD'] });
    d.reloadOrgDef('o');
    expect(running.agents.has('workerD')).toBe(true);
    expect(running.taskDag!.get(t.id)?.status).toBe('running');
  }, 20_000);

  it('spawnRole refuses while the org-wide ceiling is spent', async () => {
    const { d, running } = await startWithDeferredWorkerB();
    dagCreateTask(d, 'o', 'boss', 'spend tok=1200', 'workerA', []);
    expect(await waitUntil(() => events(running, 'org-budget-exhausted').length === 1)).toBe(true);
    const workerB = running.def.roles.find((r) => r.id === 'workerB')!;
    running.spawnRole!(workerB);
    expect(running.agents.has('workerB')).toBe(false);
    expect(events(running, 'spawn-refused').map((e) => e.from)).toEqual(['workerB']);
  }, 20_000);

  it("a deferred spawn re-checks the role's own budget closure before it starts", async () => {
    const { d, running } = await startWithDeferredWorkerB();
    // workerC's spawn is deferred, and by the time a slot frees it is closed
    // for its own budget (its own caps or #550's turn floor).
    const role = running.def.roles.find((r) => r.id === 'workerC')!;
    running.pendingRoles!.delete('workerC');
    const spawned: string[] = [];
    d.scheduleConcurrencyDeferredSpawn('o', running, role, (r) => spawned.push(r.id));
    running.spawnRole!(role);
    const rt = running.agents.get('workerC')!;
    (running.budgetClosed ??= new Set()).add('workerC');
    rt.mailbox.close('token-budget');
    // Free a slot: close workerA the same way.
    running.agents.get('workerA')!.mailbox.close('token-budget');
    expect(
      await waitUntil(() =>
        events(running, 'deferred-spawn-cancelled').some((e) => e.from === 'workerC'),
      ),
    ).toBe(true);
    expect(spawned).toEqual([]);
    expect(running.deferredSpawns?.has('workerC')).toBe(false);
  }, 20_000);
});

describe('#557 review — budget closure during a role replacement', () => {
  it('the ceiling closing while the replacement starts stops it instead of publishing it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'budget-respawn-'));
    received.clear();
    reported = 0;
    writeOrg(root, 1000, {
      maxConcurrent: 4,
      runConfig: { max_role_respawns: 1, respawn_start_timeout_ms: 2000 },
    });
    daemon = new OrgDaemon(root, { queryFn: tokQuery as any, forward: false, stopWaitMs: 200 });
    const d = daemon;
    const running = await d.startOrg('o');
    const a1 = JSON.parse(dagCreateTask(d, 'o', 'boss', 'a work tok=5', 'workerA', []));
    expect(await waitUntil(() => running.taskDag!.get(a1.id)?.status === 'running')).toBe(true);
    const oldRuntime = running.agents.get('workerA')!;
    const starts = () =>
      running.busEvents().filter((e) => e.from === 'workerA' && e.msg === 'session starting').length;
    const startsBefore = starts();
    // Before: the org's spend is exactly what the sessions reported.
    expect(await waitUntil(() => orgBudgetedUsage(running) === reported)).toBe(true);

    const pending = d.respawnRole('o', 'boss', {
      roleId: 'workerA',
      reason: 'test',
      briefing: 'carry on',
    });
    // The replacement incarnation is up and inside its start window...
    expect(await waitUntil(() => starts() > startsBefore, 5000)).toBe(true);
    // ...when the org-wide ceiling closes the org.
    dagCreateTask(d, 'o', 'boss', 'spend tok=1200', 'boss', []);
    expect(await waitUntil(() => events(running, 'org-budget-exhausted').length === 1)).toBe(true);

    const receipt = await pending;
    expect(receipt.success).toBe(false);
    expect(receipt.error).toMatch(/replacement cancelled: org-wide budget_tokens exhausted/);
    expect(events(running, 'role-respawned')).toEqual([]);
    expect(events(running, 'role-respawn-cancelled')).toHaveLength(1);
    // The closed old incarnation stays; the role is closed like the others and
    // its task is held with the reason.
    expect(running.agents.get('workerA')).toBe(oldRuntime);
    expect(oldRuntime.mailbox.isClosed).toBe(true);
    expect(running.orgBudgetClosed?.has('workerA')).toBe(true);
    expect(running.taskDag!.get(a1.id)?.status).toBe('blocked');
    expect(running.taskDag!.get(a1.id)?.blockedReason).toMatch(/org-wide budget_tokens exhausted/);

    // Spend stays exact: the old incarnation counted once (it is still in
    // `agents`), the stopped replacement's start-window spend counted too.
    const slot = running.roleSlots.get('workerA')!;
    expect(slot.retiredUsage.tokens).toBeGreaterThan(0); // the replacement spent something
    expect(await waitUntil(() => orgBudgetedUsage(running) === reported)).toBe(true);
    // The cancelled replacement did not use up the one allowed respawn.
    expect(slot.respawnCount).toBe(0);

    // And after the reopen, nothing is carried over twice.
    writeOrg(root, 100_000, {
      maxConcurrent: 4,
      runConfig: { max_role_respawns: 1, respawn_start_timeout_ms: 2000 },
    });
    d.reloadOrgDef('o');
    expect(running.agents.get('workerA')).not.toBe(oldRuntime);
    expect(running.agents.get('workerA')!.mailbox.isClosed).toBe(false);
    expect(await waitUntil(() => orgBudgetedUsage(running) === reported)).toBe(true);
  }, 20_000);

  it("a resource deferral registered after the ceiling closed sets the role aside and holds its tasks at once", async () => {
    const { d, running } = await startWithDeferredWorkerB();
    dagCreateTask(d, 'o', 'boss', 'spend tok=1200', 'workerA', []);
    expect(await waitUntil(() => events(running, 'org-budget-exhausted').length === 1)).toBe(true);
    // As if deliver() had taken workerC out of pendingRoles, then waited out
    // its 60s host-capacity check while the ceiling closed.
    running.orgBudgetPendingRoles!.delete('workerC');
    const t = JSON.parse(dagCreateTask(d, 'o', 'boss', 'c work', 'workerC', []));
    expect(running.taskDag!.get(t.id)?.status).toBe('ready');
    const workerC = running.def.roles.find((r) => r.id === 'workerC')!;
    const spawned: string[] = [];
    d.scheduleDeferredSpawn('o', running, workerC, (r) => spawned.push(r.id));

    expect(running.deferredSpawns?.has('workerC')).toBe(false);
    expect(running.orgBudgetPendingRoles?.has('workerC')).toBe(true);
    expect(running.taskDag!.get(t.id)?.status).toBe('blocked');
    expect(running.taskDag!.get(t.id)?.blockedReason).toMatch(
      /assignee "workerC" closed: org-wide budget_tokens exhausted/,
    );
    expect(spawned).toEqual([]);
  }, 20_000);
});
