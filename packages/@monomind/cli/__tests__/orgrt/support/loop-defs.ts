// packages/@monomind/cli/__tests__/orgrt/support/loop-defs.ts
// P4.8 definitions: a dev and QA loop on the sections surface. development (dev-lead, coder) publishes `build` and
// consumes `report`; qa (qa-lead) publishes `report` and consumes `build`; `memo` is a type of development that
// travels to qa but is not a loop type. `boss` is the root.
import { role } from './doc-defs.js';
import { sectionsRaw } from './sections-defs.js';

const schema = {
  type: 'object',
  required: ['summary'],
  additionalProperties: false,
  properties: { summary: { type: 'string', minLength: 3 } },
};

export function loopOrg(maxRounds: number | null = 2, patch: (raw: Record<string, any>) => void = () => {}): Record<string, any> {
  return sectionsRaw((raw) => {
    raw.name = 'loop-org';
    raw.roles = [role('boss', null), role('dev-lead', 'boss'), role('coder', 'dev-lead'), role('qa-lead', 'boss')];
    raw.run_config.max_concurrent_agents = 20;
    raw.sections = {
      development: { lead: 'dev-lead', members: ['dev-lead', 'coder'], publishes: ['build', 'memo'], consumes: ['report'] },
      qa: { lead: 'qa-lead', members: ['qa-lead'], publishes: ['report'], consumes: ['build', 'memo'] },
    };
    raw.documents = { build: { schema }, report: { schema }, memo: { schema } };
    if (maxRounds !== null) raw.loops = [{ between: ['development', 'qa'], types: ['build', 'report'], max_rounds: maxRounds }];
    patch(raw);
  });
}

export const SUMMARY = (s: string) => ({ summary: s });
