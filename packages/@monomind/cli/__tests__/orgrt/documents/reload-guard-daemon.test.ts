// packages/@monomind/cli/__tests__/orgrt/documents/reload-guard-daemon.test.ts
// P4.10 through a real OrgDaemon with a scripted runner (no model): a structural reload is refused whole and the
// running org is left exactly as it was; the keys a reload carries live (budgets, caps, rounds, role policy) still
// apply; a sections-off reload is what it was; the policy replaced on a reload keeps a section cap in maxUsd.
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sandboxAvailability } from '../../../src/orgrt/role-sandbox-restrictions.js';
import { loopOrg } from '../support/loop-defs.js';
import { budgetedOrg, CAPS, newOrgRoot, ROLES, type Started, startAll, waitUntil } from '../support/section-budget-org.js';
import { eventsOf, harness, settle } from '../support/section-budget-run-org.js';

type Raw = Record<string, any>;
const { run, spend } = harness();
const roleOf = (raw: Raw, id: string) => raw.roles.find((r: Raw) => r.id === id);
const capOf = (running: any, id: string): number | undefined => running.agents.get(id)?.policy.policy.maxUsd;
const caps = (running: any) => Object.fromEntries(ROLES.map((id) => [id, capOf(running, id)]));
const snapshot = (running: any) => JSON.stringify({ def: running.def, caps: caps(running) });
const reloaded = (edit: (r: Raw) => void, base: (p?: (r: Raw) => void) => Raw = budgetedOrg) =>
  base((r) => {
    Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
    edit(r);
  });
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
/** One writing section: its lead keeps no file tools and no Bash, so the checklist accepts the single writer. */
const oneWriter = (r: Raw) => {
  r.sections.research.writes = ['src/**'];
  roleOf(r, 'research-lead').policy = { sandbox: { mode: 'off' }, denyTools: [...NO_FILE_TOOLS, 'Bash'] };
};
const extra = { id: 'extra', title: 'extra', type: 'specialist', reports_to: 'research-lead', responsibilities: ['help'], policy: { sandbox: { mode: 'off' } }, budget_usd: 5 };

describe('a structural reload is refused whole and the running org is untouched', () => {
  const refused: Array<[string, (r: Raw) => void, RegExp]> = [
    ['writes added to a section', oneWriter, /sections\.research\.writes: .*single-writer assignment is applied .* when the role starts/],
    ['a role added to a section', (r) => (r.roles.push(extra), r.sections.research.members.push('extra'), (r.sections.research.budget = { usd: 40 })), /sections\.research\.members: .*added extra.*old section map/],
    ['a lead changed', (r) => (r.sections.research.lead = 'researcher'), /sections\.research\.lead: /],
    ['a section removed', (r) => delete r.sections.development, /sections\.development: section "development" was removed/],
    ['a document contract changed', (r) => (r.documents.findings.schema.required = ['summary', 'notes']), /documents\.findings: document type "findings" changed/],
    ['the completion policy changed', (r) => (r.run_config.completion = { mode: 'boss', protocol: 'sections-v1' }), /run_config\.completion: /],
  ];
  for (const [label, edit, pattern] of refused)
    it(label, async () => {
      const { s, running } = await run();
      const before = snapshot(running);
      const reloads = eventsOf(running, 'hot-reload').length;
      s.write(reloaded(edit));
      let message = '';
      try {
        s.daemon.reloadOrgDef(s.name);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/^org sec-org: reload refused, the running org keeps its definition and nothing was applied: /);
      expect(message).toMatch(pattern);
      expect(message).toMatch(/stop and start the org to apply it/);
      expect(snapshot(running)).toBe(before);
      const audit = eventsOf(running, 'hot-reload-refused');
      expect(audit).toHaveLength(1);
      expect(audit[0].data).toMatchObject({ reason: 'structural' });
      expect(eventsOf(running, 'hot-reload')).toHaveLength(reloads);
    });

  it('a mixed reload (goal, a role cap, an allocation and a structural key) applies nothing and says why', async () => {
    const { s, running } = await run();
    const before = snapshot(running);
    s.write(
      reloaded((r) => {
        r.goal = 'a new goal';
        roleOf(r, 'coder').budget_usd = 25;
        r.sections.development.budget = { usd: 35 };
        r.run_config.budget_usd = 110;
        r.sections.research.lead = 'researcher';
      }),
    );
    expect(() => s.daemon.reloadOrgDef(s.name)).toThrow(/sections\.research\.lead: /);
    expect(() => s.daemon.reloadOrgDef(s.name)).not.toThrow(/budget|goal/);
    expect(snapshot(running)).toBe(before);
    expect(running.def.goal).not.toBe('a new goal');
    expect(capOf(running, 'coder')).toBe(CAPS.coder);
    // the same file without the structural key is applied whole
    s.write(
      reloaded((r) => {
        r.goal = 'a new goal';
        roleOf(r, 'coder').budget_usd = 25;
        r.sections.development.budget = { usd: 35 };
        r.run_config.budget_usd = 110;
      }),
    );
    const res = s.daemon.reloadOrgDef(s.name);
    expect(res.changed).toEqual(expect.arrayContaining(['goal', 'run_config.budget_usd', 'sections.development.budget', 'role:coder:budget_usd']));
    expect(capOf(running, 'coder')).toBe(25);
    expect(running.def.goal).toBe('a new goal');
  });

  it('a reload of the unchanged file is accepted and changes nothing (the running definition has the shape the guard compares)', async () => {
    const { s, running } = await run();
    const before = snapshot(running);
    s.write(reloaded(() => {}));
    expect(s.daemon.reloadOrgDef(s.name)).toEqual({ changed: [], newRoles: [], removedRoles: [] });
    expect(snapshot(running)).toBe(before);
  });
});

describe('the keys a reload carries live still apply', () => {
  it('an allocation raise reopens a closed section with the spend kept', async () => {
    const { s, running } = await run();
    await spend(s, running, 'researcher', 22, 22);
    await spend(s, running, 'research-lead', 8, 8);
    expect(await waitUntil(() => running.sectionBudget!.closed.has('section:research'))).toBe(true);
    s.write(reloaded((r) => (r.sections.research.budget = { usd: 40 })));
    expect(s.daemon.reloadOrgDef(s.name).changed).toContain('sections.research.budget');
    expect(running.sectionBudget!.closed.size).toBe(0);
    expect(running.agents.get('research-lead')!.mailbox.isClosed).toBe(false);
    expect(running.agents.get('research-lead')!.metrics.costUsd).toBe(8);
    expect(eventsOf(running, 'section-budget-reopened')).toHaveLength(1);
  });

  it('a raise of the org budget alone applies', async () => {
    const { s, running } = await run();
    s.write(reloaded((r) => (r.run_config.budget_usd = 150)));
    expect(s.daemon.reloadOrgDef(s.name).changed).toEqual(['run_config.budget_usd']);
    expect((running.def.run_config as any).budget_usd).toBe(150);
  });

  it('max_rework_rounds applies: added, raised and removed', async () => {
    const { s, running } = await run((r) => (r.sections.development.max_rework_rounds = 2));
    s.write(reloaded((r) => (r.sections.development.max_rework_rounds = 3)));
    expect(s.daemon.reloadOrgDef(s.name).changed).toEqual(['sections.development.max_rework_rounds']);
    expect((running.def as any).sections.development.max_rework_rounds).toBe(3);
    s.write(reloaded(() => {}));
    expect(s.daemon.reloadOrgDef(s.name).changed).toEqual(['sections.development.max_rework_rounds']);
    expect((running.def as any).sections.development.max_rework_rounds).toBeUndefined();
  });

  it('a role policy and a role cap apply', async () => {
    const { s, running } = await run();
    s.write(reloaded((r) => (roleOf(r, 'observer').policy = { sandbox: { mode: 'off' }, denyTools: ['WebFetch'] })));
    expect(s.daemon.reloadOrgDef(s.name).changed).toEqual(['role:observer:policy']);
    expect(running.agents.get('observer')!.policy.policy.denyTools).toEqual(['WebFetch']);
  });
});

describe('loops[i].max_rounds', () => {
  const started: Started[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map(async (s) => (await s.daemon.stopAll().catch(() => {}), rmSync(s.root, { recursive: true, force: true }))));
  });
  async function loops(rounds = 2) {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    const s = newOrgRoot(loopOrg(rounds));
    started.push(s);
    const running = await s.daemon.startOrg(s.name, undefined, { evalGate: true });
    return { s, running };
  }

  it('a change of max_rounds alone applies', async () => {
    const { s, running } = await loops(2);
    s.write(loopOrg(5));
    expect(s.daemon.reloadOrgDef(s.name).changed).toEqual(['loops[0].max_rounds']);
    expect((running.def as any).loops[0].max_rounds).toBe(5);
  });

  it('max_rounds together with between or types is refused whole, max_rounds not applied', async () => {
    const { s, running } = await loops(2);
    const before = JSON.stringify(running.def);
    s.write(loopOrg(5, (r) => (r.loops[0].types = ['build'])));
    expect(() => s.daemon.reloadOrgDef(s.name)).toThrow(/loops\[0\]\.types: loop 0: types changed .*only max_rounds reloads/);
    expect(JSON.stringify(running.def)).toBe(before);
  });
});

describe('the policy a reload replaces keeps the section cap (the caveat of P4.4 and P4.5)', () => {
  const policyEdit = (id: string, extraPolicy: Raw) => (r: Raw) => (roleOf(r, id).policy = { sandbox: { mode: 'off' }, ...extraPolicy });

  it('a policy-only reload leaves the section cap in maxUsd, with and without an explicit policy.maxUsd', async () => {
    const { s, running } = await run((r) => (roleOf(r, 'researcher').policy = { sandbox: { mode: 'off' }, maxUsd: 20 }));
    const first = s.daemon.reloadOrgDef;
    expect(first).toBeTypeOf('function');
    for (const id of ['coder', 'researcher']) expect(capOf(running, id), id).toBe(CAPS[id]);
    s.write(reloaded((r) => {
      policyEdit('coder', { denyTools: ['WebFetch'] })(r);
      roleOf(r, 'researcher').policy = { sandbox: { mode: 'off' }, maxUsd: 20, denyTools: ['WebFetch'] };
      r.sections.research.budget = { usd: 30 };
    }, (p) => budgetedOrg((r) => { roleOf(r, 'researcher').policy = { sandbox: { mode: 'off' }, maxUsd: 20 }; p?.(r); })));
    const changed = s.daemon.reloadOrgDef(s.name).changed;
    expect(changed).toEqual(expect.arrayContaining(['role:coder:policy', 'role:researcher:policy']));
    for (const id of ['coder', 'researcher']) {
      expect(running.agents.get(id)!.policy.policy.denyTools, id).toEqual(['WebFetch']);
      expect(capOf(running, id), id).toBe(CAPS[id]);
    }
  });

  it('a policy and a cap changed together end on the new cap, and a later policy-only reload keeps it', async () => {
    const { s, running } = await run();
    s.write(reloaded((r) => {
      roleOf(r, 'coder').budget_usd = 25;
      r.sections.development.budget = { usd: 35 };
      policyEdit('coder', { denyTools: ['WebFetch'] })(r);
    }));
    s.daemon.reloadOrgDef(s.name);
    expect(capOf(running, 'coder')).toBe(25);
    s.write(reloaded((r) => {
      roleOf(r, 'coder').budget_usd = 25;
      r.sections.development.budget = { usd: 35 };
      policyEdit('coder', { denyTools: ['WebFetch', 'WebSearch'] })(r);
    }));
    s.daemon.reloadOrgDef(s.name);
    expect(running.agents.get('coder')!.policy.policy.denyTools).toEqual(['WebFetch', 'WebSearch']);
    expect(capOf(running, 'coder')).toBe(25);
  });

  it.skipIf(!sandboxAvailability().available)('with a single writer: a read-only role keeps both the overlay and the cap through a policy reload', async () => {
    const { s, running } = await run(oneWriter);
    s.write(reloaded((r) => {
      oneWriter(r);
      policyEdit('coder', { denyTools: ['WebFetch'] })(r);
    }));
    s.daemon.reloadOrgDef(s.name);
    const live = running.agents.get('coder')!.policy.policy;
    expect(live.denyTools).toEqual(['WebFetch']);
    expect(live.fileWrite).toEqual([]);
    expect(live.maxUsd).toBe(CAPS.coder);
  });
});

describe('an org off the sections surface reloads as it did', () => {
  const plain = (edit: (r: Raw) => void = () => {}): Raw => {
    const raw = budgetedOrg((r) => {
      for (const k of ['sections', 'documents', 'requires']) delete r[k];
      delete r.run_config.completion;
      delete r.run_config.experimental;
      delete r.run_config.budget_usd;
      for (const role of r.roles) delete role.budget_usd;
      Object.assign(r.run_config, { max_role_respawns: 2, respawn_start_timeout_ms: 100 });
      edit(r);
    });
    raw.name = 'plain-org';
    return raw;
  };

  it('reports and applies exactly what it did, with no refusal event', async () => {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    const s = newOrgRoot(plain());
    try {
      const running = await s.daemon.startOrg(s.name, undefined, {});
      s.write(plain((r) => ((r.goal = 'a new goal'), (r.run_config.idle_minutes = 7), (roleOf(r, 'coder').budget_usd = 9), r.roles.push({ ...extra, id: 'late', reports_to: 'boss', budget_usd: undefined }))));
      const res = s.daemon.reloadOrgDef(s.name);
      expect(res).toEqual({ changed: ['goal', 'run_config.idle_minutes', 'role:coder:budget_usd'], newRoles: ['late'], removedRoles: [] });
      expect(eventsOf(running, 'hot-reload-refused')).toEqual([]);
      const audit = eventsOf(running, 'hot-reload');
      expect(audit).toHaveLength(1);
      expect(audit[0].msg).toBe('org def reloaded: 3 fields changed, 1 new roles, 0 removed roles');
      expect(audit[0].data).toEqual(res);
      await settle(20);
    } finally {
      await s.daemon.stopAll().catch(() => {});
      rmSync(s.root, { recursive: true, force: true });
    }
  });
});
