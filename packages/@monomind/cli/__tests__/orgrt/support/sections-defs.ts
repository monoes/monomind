// packages/@monomind/cli/__tests__/orgrt/support/sections-defs.ts
// Raw definitions for the sections surface tests (P3.1): a valid sections org
// and a helper to break one thing at a time.
const NO_SANDBOX = { sandbox: { mode: 'off' } };

const role = (id: string, reportsTo: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  type: reportsTo === null ? 'boss' : 'specialist',
  reports_to: reportsTo,
  responsibilities: ['do the work'],
  policy: NO_SANDBOX,
  ...extra,
});

export function validSectionsRaw(): Record<string, any> {
  return {
    name: 'sec-org',
    goal: 'research then build',
    requires: { sections: 1 },
    run_config: {
      idle_minutes: 0,
      max_concurrent_agents: 5, // P4.9: the roster of five must fit (the default cap of 4 is a validate error on this surface)
      experimental: 'eval',
      completion: { mode: 'dag', protocol: 'sections-v1' },
    },
    roles: [
      role('boss', null),
      role('research-lead', 'boss'),
      role('researcher', 'research-lead'),
      role('dev-lead', 'boss'),
      role('coder', 'dev-lead'),
    ],
    sections: {
      research: { lead: 'research-lead', members: ['research-lead', 'researcher'], publishes: ['findings'] },
      development: { lead: 'dev-lead', members: ['dev-lead', 'coder'], consumes: ['findings'] },
    },
    documents: {
      findings: { schema: { type: 'object', required: ['summary'] }, evidence: [{ kind: 'source', verify: 'cited' }] },
    },
  };
}

/** A valid sections org with `patch` applied to a fresh copy. */
export function sectionsRaw(patch: (raw: Record<string, any>) => void = () => {}): Record<string, any> {
  const raw = validSectionsRaw();
  patch(raw);
  return raw;
}
