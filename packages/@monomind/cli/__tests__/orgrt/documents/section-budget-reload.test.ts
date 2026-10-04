// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-reload.test.ts
// P4.5: hot reload of section budgets. The proposed definition goes through the checklist first (an
// over-allocation is refused and the previous definition and caps stay); a raise inside the partition is applied
// with the same resolver the role start path uses, so a role started or replaced afterwards gets the same cap.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBudgetCaps } from '../../../src/orgrt/documents/section-budget.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { budgetedOrg, CAPS, newOrgRoot, ROLES, type Started, startAll } from '../support/section-budget-org.js';

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
async function running() {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  const s = newOrgRoot(budgetedOrg((r) => Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 })));
  started.push(s);
  return { s, run: await startAll(s) };
}
const capOf = (run: any, id: string): number | undefined => run.agents.get(id)?.policy.policy.maxUsd;
const roleOf = (raw: Record<string, any>, id: string) => raw.roles.find((r: any) => r.id === id);
const reloaded = (edit: (r: Record<string, any>) => void) =>
  budgetedOrg((r) => {
    Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
    edit(r);
  });

describe('a reload that stays inside the partition', () => {
  it('raises the role cap and the allocation together, and the running org reads both', async () => {
    const { s, run } = await running();
    s.write(reloaded((r) => {
      roleOf(r, 'coder').budget_usd = 25;
      r.sections.development.budget = { usd: 35 };
    }));
    const res = s.daemon.reloadOrgDef(s.name);
    expect(res.changed).toEqual(expect.arrayContaining(['sections.development.budget', 'role:coder:budget_usd']));
    expect(capOf(run, 'coder')).toBe(25);
    expect((run.def as any).sections.development.budget).toEqual({ usd: 35 });
    // the cap a role gets from the running definition is the resolver's, for every role
    const caps = resolveBudgetCaps(run.def as never);
    for (const id of ROLES) expect(capOf(run, id), id).toBe(caps.roles[id].effectiveUsd);
    expect(caps.roles.coder.effectiveUsd).toBe(25);
  });

  it('start, respawn and reload agree: a replacement after the reload gets the reloaded cap', async () => {
    const { s, run } = await running();
    s.write(reloaded((r) => {
      roleOf(r, 'coder').budget_usd = 25;
      r.sections.development.budget = { usd: 35 };
    }));
    s.daemon.reloadOrgDef(s.name);
    const receipt = await s.daemon.respawnRole(s.name, 'boss', { roleId: 'coder', reason: 'test', briefing: 'test' });
    expect(receipt.success, receipt.error).toBe(true);
    expect(capOf(run, 'coder')).toBe(25);
    const fresh = resolveBudgetCaps(OrgDefSchema.parse(reloaded((r) => {
      roleOf(r, 'coder').budget_usd = 25;
      r.sections.development.budget = { usd: 35 };
    })) as never);
    expect(fresh.roles.coder.effectiveUsd).toBe(capOf(run, 'coder'));
  });

  it('lowering a cap is applied the same way, and the unchanged roles keep theirs', async () => {
    const { s, run } = await running();
    s.write(reloaded((r) => {
      roleOf(r, 'researcher').budget_usd = 15;
      r.sections.research.budget = { usd: 30 };
    }));
    s.daemon.reloadOrgDef(s.name);
    expect(capOf(run, 'researcher')).toBe(15);
    for (const id of ROLES.filter((x) => x !== 'researcher')) expect(capOf(run, id), id).toBe(CAPS[id]);
  });

  it('a raise of the org budget alone is applied to the running definition', async () => {
    const { s, run } = await running();
    s.write(reloaded((r) => (r.run_config.budget_usd = 150)));
    expect(s.daemon.reloadOrgDef(s.name).changed).toContain('run_config.budget_usd');
    expect((run.def.run_config as any).budget_usd).toBe(150);
  });
});

describe('a reload that breaks the partition is refused and changes nothing', () => {
  const refused = async (edit: (r: Record<string, any>) => void, pattern: RegExp) => {
    const { s, run } = await running();
    const before = JSON.stringify(run.def);
    s.write(reloaded(edit));
    expect(() => s.daemon.reloadOrgDef(s.name)).toThrow(pattern);
    expect(JSON.stringify(run.def)).toBe(before);
    for (const id of ROLES) expect(capOf(run, id), id).toBe(CAPS[id]);
  };

  it('a role cap raised above its section allocation', () =>
    refused((r) => (roleOf(r, 'coder').budget_usd = 35), /role caps of section "development"/));

  it('an allocation lowered below its role caps', () =>
    refused((r) => (r.sections.research.budget = { usd: 20 }), /role caps of section "research"/));

  it('allocations raised above the org budget', () =>
    refused((r) => (r.sections.research.budget = { usd: 90 }), /allocations sum to \$120, above run_config.budget_usd \$100/));

  it('a policy.maxUsd that conflicts with budget_usd', () =>
    refused((r) => (roleOf(r, 'coder').policy = { sandbox: { mode: 'off' }, maxUsd: 40 }), /roles\.coder\.policy\.maxUsd/));

  it('a budget mode that is not built', () =>
    refused((r) => (r.run_config.budget_mode = 'strict'), /budget_mode/));

  it('a section budget removed from one section only', () =>
    refused((r) => delete r.sections.development.budget, /section "development" has no budget/));
});
