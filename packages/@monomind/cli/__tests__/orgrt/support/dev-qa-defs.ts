// packages/@monomind/cli/__tests__/orgrt/support/dev-qa-defs.ts
// A dev and QA org on the sections surface. development (dev-lead, coder) publishes `build` and `memo` and
// consumes `report`; qa (qa-lead) publishes `report` and consumes `build` and `memo` (the two sections hand
// documents both ways; a revise cycle is a consumer reject, capped by max_rework_rounds). `boss` is the root.
import { role } from './doc-defs.js';
import { sectionsRaw } from './sections-defs.js';

const schema = {
  type: 'object',
  required: ['summary'],
  additionalProperties: false,
  properties: { summary: { type: 'string', minLength: 3 } },
};

export function devQaOrg(patch: (raw: Record<string, any>) => void = () => {}): Record<string, any> {
  return sectionsRaw((raw) => {
    raw.name = 'dev-qa-org';
    raw.roles = [role('boss', null), role('dev-lead', 'boss'), role('coder', 'dev-lead'), role('qa-lead', 'boss')];
    raw.run_config.max_concurrent_agents = 20;
    raw.sections = {
      development: { lead: 'dev-lead', members: ['dev-lead', 'coder'], publishes: ['build', 'memo'], consumes: ['report'] },
      qa: { lead: 'qa-lead', members: ['qa-lead'], publishes: ['report'], consumes: ['build', 'memo'] },
    };
    raw.documents = { build: { schema }, report: { schema }, memo: { schema } };
    patch(raw);
  });
}

export const SUMMARY = (s: string) => ({ summary: s });
