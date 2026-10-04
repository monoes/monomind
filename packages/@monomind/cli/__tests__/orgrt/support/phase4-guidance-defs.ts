// packages/@monomind/cli/__tests__/orgrt/support/phase4-guidance-defs.ts
// P4.11: the synthetic orgs of the Phase 4 role text tests. One base (the dev and QA org of loop-defs.ts, plus an
// `observer` in no section) and one patch per Phase 4 key set, so a fixture is "this key set, these roles".
import { role } from './doc-defs.js';
import { loopOrg } from './loop-defs.js';

export type Phase4Key = 'writer' | 'budget' | 'rework' | 'loop' | 'unusable' | 'cycle';
export const KEY_SETS: Record<string, Phase4Key[]> = {
  none: [],
  writer: ['writer'],
  budget: ['budget'],
  rework: ['rework'],
  loop: ['loop'],
  all: ['writer', 'budget', 'rework', 'loop'],
  // The loop topology (the sections trade documents both ways) with no key set: the P3.12 text of a loop org. It cannot
  // start (an undeclared cycle is an error), so only the text of the definition is compared, never a daemon.
  cycle: ['cycle'],
};
/** The key set whose P3.12 text the set's added lines are measured against: same topology, no Phase 4 key. */
export const baseOf = (set: string): string => (KEY_SETS[set].includes('loop') || set === 'cycle' ? 'cycle' : 'none');
/** The four keys present but with values that give them no effect (an empty list, zero): the text must not change. */
export const UNUSABLE: Phase4Key[] = ['unusable'];
/** `boss` is the root; development (dev-lead, coder) publishes `build` and qa (qa-lead) consumes it (with a loop, qa also publishes `report` back); `observer` is in no section. */
export const ROLES = ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer'];
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];

export function phase4Org(keys: readonly Phase4Key[]): Record<string, any> {
  return loopOrg(keys.includes('loop') ? 2 : null, (raw) => {
    raw.name = `p4-${keys.join('-') || 'none'}`;
    raw.roles.push(role('observer', 'boss'));
    if (!keys.includes('loop') && !keys.includes('cycle')) {
      // Without a loop the two sections must not trade documents both ways (an undeclared cycle is an error).
      raw.sections.development.consumes = [];
      raw.sections.qa.publishes = [];
      delete raw.documents.report;
    }
    if (keys.includes('writer')) {
      raw.sections.development.writes = ['src/**', 'docs/**'];
      raw.roles.find((r: any) => r.id === 'dev-lead').policy = { denyTools: NO_FILE_TOOLS };
    }
    if (keys.includes('budget')) {
      raw.sections.development.budget = { usd: 30 };
      raw.sections.qa.budget = { usd: 20 };
      raw.run_config.budget_usd = 100;
      // Every role needs its own cap inside its allocation; boss and observer draw on the root reserve (100 - 50).
      const caps: Record<string, number> = { 'dev-lead': 10, coder: 20, 'qa-lead': 20, boss: 30, observer: 20 };
      for (const r of raw.roles) r.budget_usd = caps[r.id];
    }
    if (keys.includes('rework')) {
      raw.sections.qa.max_rework_rounds = 2;
      if (keys.includes('loop')) raw.sections.development.max_rework_rounds = 3;
    }
    if (keys.includes('unusable')) {
      raw.sections.development.writes = [];
      raw.sections.development.budget = { usd: 0 };
      raw.sections.qa.max_rework_rounds = 0;
      raw.loops = [];
    }
  });
}

/** The all-keys org with other values for the allocation, the cap, the round limit and the globs: the text follows them. */
export function phase4Variant(): Record<string, any> {
  const raw = phase4Org(KEY_SETS.all);
  raw.sections.development.budget = { usd: 45.5 };
  raw.sections.qa.max_rework_rounds = 7;
  raw.loops[0].max_rounds = 5;
  raw.sections.development.writes = ['lib/**'];
  return raw;
}
