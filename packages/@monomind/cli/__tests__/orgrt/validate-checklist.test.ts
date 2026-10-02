// packages/@monomind/cli/__tests__/orgrt/validate-checklist.test.ts
//
// Org sections spec, section 7.3: the caveat checklist, as shared findings.
// Mandatory constraints are errors, efficiency advice is warnings. Only the
// checks whose capability exists today are here; the section-only items
// (11-13, 15-18) activate when sections ship, and deferred features fail
// with "not yet supported" instead of being silently ignored.
import { describe, expect, it } from 'vitest';
import { checklistFindings } from '../../src/orgrt/validate-checklist.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const org = (over: Record<string, unknown> = {}, role: Record<string, unknown> = {}) =>
  OrgDefSchema.parse({
    name: 'x',
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', responsibilities: ['Write self-contained task briefs.'], adapter_config: { model: 'claude-opus-5' } },
      { id: 'worker', title: 'Worker', reports_to: 'boss', responsibilities: ['Do the work.'], adapter_config: { model: 'claude-sonnet-5' }, ...role },
    ],
    run_config: { max_concurrent_agents: 4, ...((over.run_config as object) ?? {}) },
    autonomy: { level: 'full' },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'run_config')),
  });

const hit = (list: string[], tag: string) => list.some((m) => m.includes(tag));

describe('section 7.3 checklist findings', () => {
  it('passes a clean org with no findings', () => {
    const f = checklistFindings(org({}, { budget_usd: 1 }));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([]);
  });

  describe('deferred features fail with "not yet supported"', () => {
    for (const key of ['sections', 'documents', 'loops', 'requires']) {
      it(`top-level ${key}`, () => {
        const f = checklistFindings(org({ [key]: key === 'loops' ? [] : {} }));
        expect(f.errors.some((e) => e.includes(key) && e.includes('not yet supported'))).toBe(true);
      });
    }
    for (const key of ['budget_usd', 'budget_mode', 'experimental']) {
      it(`run_config.${key}`, () => {
        const f = checklistFindings(org({ run_config: { [key]: 1 } }));
        expect(f.errors.some((e) => e.includes(`run_config.${key}`) && e.includes('not yet supported'))).toBe(true);
      });
    }
  });

  it('warns on an unknown top-level or run_config key, which would be ignored silently', () => {
    const f = checklistFindings(org({ run_config: { max_concurent_agents: 9 }, goall: 'x' }));
    expect(f.warnings.some((w) => w.includes('run_config.max_concurent_agents'))).toBe(true);
    expect(f.warnings.some((w) => w.includes('"goall"'))).toBe(true);
    expect(f.errors).toEqual([]);
  });

  describe('#1 file scopes cover the files a role names', () => {
    const duty = ['Read /srv/plan/PLAN.md before acting.', 'Write reports to /srv/plan/reports/week.md.'];
    it('warns when a named read path is outside fileRead', () => {
      const f = checklistFindings(org({}, { responsibilities: duty, policy: { fileRead: ['/srv/other'], fileWrite: ['/srv/plan/reports'] } }));
      expect(hit(f.warnings, '#1')).toBe(true);
      expect(f.warnings.join()).toContain('/srv/plan/PLAN.md');
    });
    it('warns when a named write path is outside fileWrite', () => {
      const f = checklistFindings(org({}, { responsibilities: duty, policy: { fileRead: ['/srv/plan'], fileWrite: ['/srv/other'] } }));
      expect(f.warnings.join()).toContain('/srv/plan/reports/week.md');
    });
    it('ignores URL and API paths that are not filesystem paths', () => {
      const f = checklistFindings(org({}, { responsibilities: ['Write the report from `gh api repos/x/y/traffic/views`, /popular/referrers and /repos/x/y.'], policy: { fileWrite: ['/srv/plan'], fileRead: ['/srv/plan'] } }));
      expect(hit(f.warnings, '#1')).toBe(false);
    });
    it('is quiet when the scopes cover the paths, or are the default', () => {
      expect(hit(checklistFindings(org({}, { responsibilities: duty, policy: { fileRead: ['/srv/plan'], fileWrite: ['/srv/plan/reports'] } })).warnings, '#1')).toBe(false);
      expect(hit(checklistFindings(org({}, { responsibilities: duty })).warnings, '#1')).toBe(false);
    });
  });

  describe('#2 shell duties need Bash', () => {
    it('warns when duties name shell commands and Bash is denied', () => {
      const f = checklistFindings(org({}, { responsibilities: ['Run `gh api repos/x/y/traffic/views` weekly.'], policy: { denyTools: ['Bash'] } }));
      expect(hit(f.warnings, '#2')).toBe(true);
    });
    it('is quiet when Bash is available, or no shell work is named', () => {
      expect(hit(checklistFindings(org({}, { responsibilities: ['Run `gh api x` weekly.'] })).warnings, '#2')).toBe(false);
      expect(hit(checklistFindings(org({}, { responsibilities: ['Write notes.'], policy: { denyTools: ['Bash'] } })).warnings, '#2')).toBe(false);
    });
  });

  describe('#3 capacity', () => {
    const many = (n: number, cap: number) =>
      OrgDefSchema.parse({
        name: 'x',
        autonomy: { level: 'full' },
        roles: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: 'R', reports_to: i ? 'r0' : null, adapter_config: { model: 'claude-sonnet-5' } })),
        run_config: { max_concurrent_agents: cap },
      });
    it('warns when max_concurrent_agents is below the role count (idle workers keep their slot)', () => {
      const f = checklistFindings(many(11, 6));
      expect(hit(f.warnings, '#3')).toBe(true);
      expect(f.warnings.join()).toContain('11 roles');
    });
    it('is quiet when the cap covers every role', () => {
      expect(hit(checklistFindings(many(6, 6)).warnings, '#3')).toBe(false);
    });
    it('does not count endpoint roles', () => {
      const d = OrgDefSchema.parse({
        name: 'x',
        autonomy: { level: 'full' },
        roles: [
          { id: 'boss', title: 'B', adapter_config: { model: 'm' } },
          { id: 'e1', title: 'E', kind: 'endpoint', reports_to: 'boss', endpoint: { url: 'http://x' } },
        ],
        run_config: { max_concurrent_agents: 1 },
      });
      expect(hit(checklistFindings(d).warnings, '#3')).toBe(false);
    });
  });

  describe('#4 budgets', () => {
    it('warns when no priced role has a USD budget', () => {
      expect(hit(checklistFindings(org()).warnings, '#4')).toBe(true);
    });
    it('is quiet once a priced role has budget_usd', () => {
      expect(checklistFindings(org({}, { budget_usd: 2 })).warnings.some((w) => w.includes('#4') && w.includes('USD ceiling'))).toBe(false);
    });
    it('warns that budget_usd never closes a codex or antigravity role (they report no USD)', () => {
      for (const runtime of ['codex', 'antigravity']) {
        const f = checklistFindings(org({}, { runtime, budget_usd: 2 }));
        expect(f.warnings.some((w) => w.includes('#4') && w.includes('worker') && w.includes(runtime))).toBe(true);
      }
    });
    it('is quiet about budget_usd on a priced runtime', () => {
      expect(checklistFindings(org({}, { budget_usd: 2 })).warnings.some((w) => w.includes('never closes'))).toBe(false);
    });
  });

  describe('#5 and #14 approvals nobody answers', () => {
    const noDecider = (role: Record<string, unknown> = {}, schedule: string | null = null) =>
      OrgDefSchema.parse({
        name: 'x',
        schedule,
        roles: [
          { id: 'boss', title: 'B', adapter_config: { model: 'claude-opus-5' } },
          { id: 'w', title: 'W', reports_to: 'boss', adapter_config: { model: 'claude-sonnet-5' }, ...role },
        ],
      });
    it('warns that Bash/WebFetch/WebSearch wait for a human when nothing resolves approvals', () => {
      const f = checklistFindings(noDecider());
      expect(hit(f.warnings, '#5')).toBe(true);
    });
    it('is quiet with an autonomy decider, or when roles pre-approve or deny the tools', () => {
      expect(hit(checklistFindings(org()).warnings, '#5')).toBe(false);
      const pre = noDecider({ policy: { autoApproveTools: ['Bash', 'WebFetch', 'WebSearch'] } });
      pre.roles[0].policy = { ...pre.roles[0].policy, autoApproveTools: ['Bash', 'WebFetch', 'WebSearch'] } as never;
      expect(hit(checklistFindings(pre).warnings, '#5')).toBe(false);
    });
    it('#14: a scheduled org that can wait on an unanswered approval is warned separately', () => {
      expect(hit(checklistFindings(noDecider({}, '24h')).warnings, '#14')).toBe(true);
      expect(hit(checklistFindings(noDecider({}, null)).warnings, '#14')).toBe(false);
    });
  });

  it('#7 warns on role text that tells a role to use SendMessage', () => {
    const f = checklistFindings(org({}, { responsibilities: ['Reply with SendMessage to the boss.'] }));
    expect(hit(f.warnings, '#7')).toBe(true);
    expect(hit(checklistFindings(org()).warnings, '#7')).toBe(false);
  });

  it('#8 warns when the boss prompt does not require self-contained briefs', () => {
    const d = OrgDefSchema.parse({
      name: 'x',
      autonomy: { level: 'full' },
      roles: [
        { id: 'boss', title: 'B', type: 'boss', responsibilities: ['Lead the org.'], adapter_config: { model: 'm' } },
        { id: 'w', title: 'W', reports_to: 'boss', adapter_config: { model: 'm' } },
      ],
    });
    expect(hit(checklistFindings(d).warnings, '#8')).toBe(true);
    expect(hit(checklistFindings(org()).warnings, '#8')).toBe(false);
  });

  it('#9 warns on dated detail in role text, which breaks the cached prefix', () => {
    const f = checklistFindings(org({}, { responsibilities: ['This week (2026-10-01) focus on listings.'] }));
    expect(hit(f.warnings, '#9')).toBe(true);
    expect(hit(checklistFindings(org()).warnings, '#9')).toBe(false);
  });

  it('#10 warns on a role without an explicit model', () => {
    const f = checklistFindings(org({}, { adapter_config: undefined }));
    expect(f.warnings.some((w) => w.includes('#10') && w.includes('worker'))).toBe(true);
    expect(hit(checklistFindings(org()).warnings, '#10')).toBe(false);
  });
});
