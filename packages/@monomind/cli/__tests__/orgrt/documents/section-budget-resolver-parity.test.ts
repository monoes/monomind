// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-resolver-parity.test.ts
// P4.5: the ONE resolver (`resolveBudgetCaps`, through `sectionRoleCap`) gives every role the same effective USD
// cap at start, at resume and after a respawn; a conflicting policy.maxUsd cannot reach a running role; an org
// that uses no section budget keeps today's expression. Real OrgDaemon, scripted runner, no model.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBudgetCaps } from '../../../src/orgrt/documents/section-budget.js';
import { sectionRoleCap } from '../../../src/orgrt/documents/section-budget-wire.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { budgetedOrg, CAPS, newOrgRoot, ROLES, type Started, startAll, waitUntil } from '../support/section-budget-org.js';

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
const org = (raw: Record<string, any>): Started => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  const s = newOrgRoot(raw);
  started.push(s);
  return s;
};
const capOf = (running: any, id: string): number | undefined => running.agents.get(id)?.policy.policy.maxUsd;
const roleOf = (raw: Record<string, any>, id: string) => raw.roles.find((r: any) => r.id === id);

describe('the resolver and the role start path', () => {
  it("every role starts with the resolver's effective cap", async () => {
    const s = org(budgetedOrg());
    const running = await startAll(s);
    const caps = resolveBudgetCaps(OrgDefSchema.parse(budgetedOrg()) as never);
    for (const id of ROLES) {
      expect(capOf(running, id), id).toBe(caps.roles[id].effectiveUsd);
      expect(capOf(running, id), id).toBe(CAPS[id]);
    }
  });

  it('a policy.maxUsd that conflicts with budget_usd is refused at start, before any role runs', async () => {
    const s = org(budgetedOrg((r) => (roleOf(r, 'coder').policy = { sandbox: { mode: 'off' }, maxUsd: 99 })));
    await expect(s.daemon.startOrg(s.name, undefined, { evalGate: true })).rejects.toThrow(/roles\.coder\.policy\.maxUsd/);
  });

  it('a replacement incarnation gets the same cap as the one it replaces', async () => {
    const s = org(budgetedOrg((r) => (Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 }))));
    const running = await startAll(s);
    const receipt = await s.daemon.respawnRole(s.name, 'boss', { roleId: 'coder', reason: 'test', briefing: 'test' });
    expect(receipt.success, receipt.error).toBe(true);
    expect(running.roleSlots.get('coder')!.generation).toBe(1);
    expect(capOf(running, 'coder')).toBe(20);
  });

  it('a resumed run starts every role with the same caps', async () => {
    const s = org(budgetedOrg());
    await startAll(s);
    await s.daemon.stopOrg(s.name);
    const running = await startAll(s, { resume: true });
    expect(await waitUntil(() => ROLES.every((id) => running.agents.has(id)))).toBe(true);
    for (const id of ROLES) expect(capOf(running, id), id).toBe(CAPS[id]);
  });
});

describe("sections-off and surface-on without section budgets keep today's expression", () => {
  it('a plain org: maxUsd is budget_usd, or policy.maxUsd when set (the policy wins, as it always did)', async () => {
    const role = (id: string, extra: object) => ({
      id,
      title: id,
      type: id === 'boss' ? 'boss' : 'specialist',
      reports_to: id === 'boss' ? null : 'boss',
      responsibilities: ['x'],
      ...extra,
    });
    const s = org({
      name: 'plain',
      goal: 'g',
      run_config: { idle_minutes: 0 },
      roles: [
        role('boss', { budget_usd: 5 }),
        role('a', { budget_usd: 3, policy: { maxUsd: 9 } }),
        role('b', { budget_usd: 4 }),
      ],
    });
    const running = await s.daemon.startOrg('plain');
    await s.daemon.deliver('plain', 'human', 'a', 'hi', 'hi');
    await s.daemon.deliver('plain', 'human', 'b', 'hi', 'hi');
    expect(capOf(running, 'boss')).toBe(5);
    expect(capOf(running, 'a')).toBe(9);
    expect(capOf(running, 'b')).toBe(4);
  });

  it('a sections org with no section budget (with or without run_config.budget_usd) resolves no cap of its own', () => {
    const noSections = (r: Record<string, any>) => {
      delete r.sections.research.budget;
      delete r.sections.development.budget;
      delete r.sections.watch.budget;
    };
    const orgOnly = budgetedOrg(noSections);
    expect(sectionRoleCap(OrgDefSchema.parse(orgOnly) as never, 'coder')).toBeUndefined();
    const none = budgetedOrg((r) => {
      noSections(r);
      delete r.run_config.budget_usd;
    });
    expect(sectionRoleCap(OrgDefSchema.parse(none) as never, 'coder')).toBeUndefined();
  });

  it('a sections org with no section budget keeps policy.maxUsd over budget_usd, as before', async () => {
    const raw = budgetedOrg((r) => {
      delete r.sections.research.budget;
      delete r.sections.development.budget;
      delete r.sections.watch.budget;
      delete r.run_config.budget_usd;
      roleOf(r, 'coder').policy = { sandbox: { mode: 'off' }, maxUsd: 7 };
    });
    const s = org(raw);
    const running = await startAll(s);
    expect(capOf(running, 'coder')).toBe(7);
    expect(capOf(running, 'researcher')).toBe(20);
  });
});
