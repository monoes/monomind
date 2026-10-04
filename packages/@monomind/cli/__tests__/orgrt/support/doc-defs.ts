// packages/@monomind/cli/__tests__/orgrt/support/doc-defs.ts
// Definitions for the P3.6 document tool tests: the research/development org of sections-defs.ts with extra
// roles and consumers, and the sweep-3 shape (eight per-worker contracts, one synthesising consumer).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionsRaw } from './sections-defs.js';

const NO_SANDBOX = { sandbox: { mode: 'off' } };
export const role = (id: string, reportsTo: string | null) => ({
  id,
  title: id,
  type: reportsTo === null ? 'boss' : 'specialist',
  reports_to: reportsTo,
  responsibilities: ['do the work'],
  policy: NO_SANDBOX,
});

/** research (research-lead, researcher) publishes findings; development (dev-lead, coder) and qa (qa-lead)
 *  consume it; `observer` is in no section. `boss` is the root. */
export function findingsOrg(opts: { qa?: boolean } = {}): Record<string, any> {
  return sectionsRaw((raw) => {
    raw.roles.push(role('observer', 'boss'));
    raw.run_config.max_concurrent_agents = 20; // the default ceiling (4) would defer the lazy spawns a test makes
    if (opts.qa) {
      raw.roles.push(role('qa-lead', 'boss'));
      raw.sections.qa = { lead: 'qa-lead', members: ['qa-lead'], consumes: ['findings'] };
    }
    raw.documents.findings.schema = {
      type: 'object',
      required: ['summary'],
      additionalProperties: false,
      properties: { summary: { type: 'string', minLength: 3 }, notes: { type: 'string' } },
    };
  });
}

export const FINDINGS = { summary: 'Sections ship in 2.22' };
export const SOURCE = [{ kind: 'source', ref: 'doc/concepts/sections.md' }];

/** The parallel-sweep-3 shape: root `lead`, eight workers each publishing their own sheet document, and a
 *  synthesiser that consumes all eight and decides on each. */
export function sweepOrg(): Record<string, any> {
  const pilot = JSON.parse(
    readFileSync(join(__dirname, '../../../../../../tests/eval/org/pilot/parallel-sweep-3.pilot.json'), 'utf8'),
  );
  const workers = Array.from({ length: 8 }, (_, i) => `worker-${i + 1}`);
  const sections: Record<string, any> = {};
  const documents: Record<string, any> = {};
  workers.forEach((w, i) => {
    const c = pilot.contracts[i];
    sections[`sweep-${i + 1}`] = { lead: w, members: [w], publishes: [c.id] };
    documents[c.id] = { schema: c.schema, max_publish_attempts: c.max_attempts };
  });
  sections.synthesis = {
    lead: 'synthesiser',
    members: ['synthesiser'],
    consumes: pilot.contracts.map((c: any) => c.id),
  };
  return {
    name: 'sweep-org',
    goal: 'sweep',
    requires: { sections: 1 },
    run_config: {
      idle_minutes: 0,
      max_concurrent_agents: 20,
      experimental: 'eval',
      completion: { mode: 'dag', protocol: 'sections-v1' },
    },
    roles: [role('lead', null), ...workers.map((w) => role(w, 'lead')), role('synthesiser', 'lead')],
    sections,
    documents,
  };
}
