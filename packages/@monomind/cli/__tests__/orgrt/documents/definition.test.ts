// packages/@monomind/cli/__tests__/orgrt/documents/definition.test.ts
// P3.1: every rule of the sections definition check, failing and passing, with
// the message it gives (it must name the path and a remedy).
import { describe, expect, it } from 'vitest';
import { sectionsDefinitionFindings } from '../../../src/orgrt/documents/definition.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { sectionsRaw } from '../support/sections-defs.js';

const findings = (patch: (raw: Record<string, any>) => void) =>
  sectionsDefinitionFindings(OrgDefSchema.parse(sectionsRaw(patch)));

describe('a valid sections definition', () => {
  it('has no errors and no warnings', () => {
    expect(findings(() => {})).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a definition without run_config.experimental (general availability)', () => {
    expect(findings((r) => delete r.run_config.experimental)).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a one-member section that leads itself', () => {
    const f = findings((r) => {
      r.sections.development = { members: ['coder'], consumes: ['findings'] };
    });
    expect(f.errors).toEqual([]);
  });

  it('accepts a dedicated lead outside members when its scope resolves to role', () => {
    const f = findings((r) => {
      r.sections.development = { lead: 'dev-lead', members: ['coder'], consumes: ['findings'] };
    });
    expect(f.errors).toEqual([]);
  });
});

type Case = [string, (raw: Record<string, any>) => void, string];

const surfaceCases: Case[] = [
  ['requires missing', (r) => delete r.requires, 'requires: a sections org must declare requires'],
  ['requires.sections is 2', (r) => (r.requires = { sections: 2 }), 'requires: a sections org must declare'],
  ['requires with an unknown capability', (r) => (r.requires.budgets = 1), 'requires.budgets: unknown capability "budgets"'],
  ['experimental is another value', (r) => (r.run_config.experimental = 'beta'), '"beta"'],
  ['completion as a string', (r) => (r.run_config.completion = 'dag'), 'run_config.completion: a sections org must set'],
  ['completion missing', (r) => delete r.run_config.completion, 'run_config.completion: a sections org must set'],
  ['completion with another protocol', (r) => (r.run_config.completion.protocol = 'sections-v2'), 'run_config.completion.protocol: must be "sections-v1"'],
  ['documents missing', (r) => delete r.documents, 'documents: a sections org must declare a documents map'],
  ['documents is empty', (r) => (r.documents = {}), 'type "findings" is not declared — add documents.findings'],
  ['schedule set', (r) => (r.schedule = '0 * * * *'), 'schedule: not yet supported: recurring section orgs'],
  [
    'a full-access role',
    (r) => (r.roles[4].policy = { ...r.roles[4].policy, access: 'full' }),
    'roles.coder.policy.access: "full" is refused in a sections org',
  ],
];

const sectionCases: Case[] = [
  ['bad section name', (r) => (r.sections.Research = r.sections.research), 'sections.Research: "Research" is not a valid section name'],
  ['section name with a slash', (r) => (r.sections['a/b'] = { members: ['coder'] }), '"a/b" is not a valid section name'],
  ['section name too long', (r) => (r.sections['a'.repeat(41)] = { members: ['coder'] }), 'is not a valid section name'],
  ['section is not an object', (r) => (r.sections.research = 'x'), 'sections.research: must be an object'],
  ['unknown section field', (r) => (r.sections.research.colour = 'red'), 'sections.research.colour: unknown section field'],
  ['no members', (r) => delete r.sections.research.members, 'sections.research.members: a section needs at least one member'],
  ['empty members', (r) => (r.sections.research.members = []), 'a section needs at least one member'],
  ['members not a list', (r) => (r.sections.research.members = 'researcher'), 'sections.research.members: must be a list of role ids'],
  ['member does not exist', (r) => r.sections.research.members.push('ghost'), 'sections.research: role "ghost" does not exist — roles are: boss'],
  ['lead does not exist', (r) => (r.sections.research.lead = 'ghost'), 'role "ghost" does not exist'],
  ['lead not a string', (r) => (r.sections.research.lead = 7), 'sections.research.lead: must be a role id'],
  ['several members and no lead', (r) => delete r.sections.research.lead, 'sections.research.lead: a section with 2 members must name its lead'],
  ['duplicate member', (r) => r.sections.research.members.push('researcher'), 'role "researcher" is listed twice'],
  ['role in two sections', (r) => r.sections.development.members.push('researcher'), 'role "researcher" is in sections "research" and "development"'],
  ['root in a section', (r) => r.sections.research.members.push('boss'), 'role "boss" is the root'],
  [
    'dedicated lead on task scope',
    (r) => {
      r.run_config.session_scope = 'task';
      r.sections.development = { lead: 'dev-lead', members: ['coder'], consumes: ['findings'] };
    },
    'dedicated lead "dev-lead" resolves to session scope "task"',
  ],
  [
    'dedicated lead with an explicit task scope',
    (r) => {
      r.roles[3].session_scope = 'task';
      r.sections.development = { lead: 'dev-lead', members: ['coder'], consumes: ['findings'] };
    },
    'set session_scope: "role" on role "dev-lead"',
  ],
  ['writes on two sections', (r) => {
    r.sections.research.writes = ['src/a'];
    r.sections.development.writes = ['src/b'];
  }, 'only one section may declare writes'],
  ['writes not a list of strings', (r) => (r.sections.research.writes = [1]), 'sections.research.writes: must be a list of repository paths'],
  ['deliberative mode', (r) => (r.sections.research.mode = 'deliberative'), 'sections.research.mode: "deliberative" is not yet supported'],
  ['direct requests', (r) => (r.sections.research.requests = 'direct'), 'sections.research.requests: "direct" is not yet supported'],
  ['section budget that is not {usd}', (r) => (r.sections.research.budget = 5), 'sections.research.budget: must be {"usd": a positive number}'],
  ['rework rounds zero', (r) => (r.sections.research.max_rework_rounds = 0), 'max_rework_rounds: must be a positive integer'],
  ['max_depth', (r) => (r.sections.research.parallelism = { max_depth: 2 }), 'parallelism.max_depth: not yet supported'],
  ['max_parallel zero', (r) => (r.sections.research.parallelism = { max_parallel: 0 }), 'parallelism.max_parallel: must be a positive integer'],
];

const edgeCases: Case[] = [
  ['consumes a type that is not declared', (r) => r.sections.development.consumes.push('plans'), 'type "plans" is not declared — add documents.plans'],
  ['publishes a type that is not declared', (r) => r.sections.research.publishes.push('plans'), 'type "plans" is not declared'],
  ['duplicate edge', (r) => r.sections.development.consumes.push('findings'), 'type "findings" is listed twice'],
  ['consumes and publishes the same type', (r) => r.sections.research.consumes = ['findings'], 'is both consumed and published by this section'],
  ['reserved type in consumes', (r) => r.sections.development.consumes.push('request'), '"request" is a reserved built-in type'],
  ['reserved type in publishes', (r) => r.sections.research.publishes.push('answer'), '"answer" is a reserved built-in type'],
  ['reserved type under documents', (r) => (r.documents.request = { schema: {} }), 'documents.request: "request" is a reserved built-in type'],
  ['bad type name', (r) => (r.documents['Bad Type'] = { schema: {} }), 'documents.Bad Type: "Bad Type" is not a valid type name'],
  ['type with no publisher', (r) => (r.documents.plans = { schema: {} }), 'documents.plans: no section publishes it'],
  ['type with two publishers', (r) => r.sections.development.publishes = ['findings'], 'published by research and development'],
  ['consumes is not a list', (r) => (r.sections.development.consumes = 'findings'), 'sections.development.consumes: must be a list of document types'],
];

const documentCases: Case[] = [
  ['document is not an object', (r) => (r.documents.findings = 'x'), 'documents.findings: must be an object'],
  ['document with no schema', (r) => delete r.documents.findings.schema, 'documents.findings.schema: must be an object'],
  ['acceptance owner', (r) => (r.documents.findings.acceptance = 'owner'), 'acceptance "owner" is not yet supported'],
  ['acceptance any', (r) => (r.documents.findings.acceptance = 'any'), 'acceptance "any" is not yet supported'],
  ['acceptance junk', (r) => (r.documents.findings.acceptance = 'some'), 'documents.findings.acceptance: must be "each"'],
  ['owner set', (r) => (r.documents.findings.owner = 'development'), 'owner is not yet supported'],
  ['provisional', (r) => (r.documents.findings.provisional = true), 'provisional: true is not yet supported'],
  ['gates', (r) => (r.documents.findings.gates = ['human']), 'gates is not yet supported'],
  ['confidential', (r) => (r.documents.findings.confidential = true), 'confidential: true is not yet supported'],
  ['on_stale keep', (r) => (r.documents.findings.on_stale = 'keep'), 'on_stale "keep" is not yet supported'],
  ['on_stale rebase-queued', (r) => (r.documents.findings.on_stale = 'rebase-queued'), 'on_stale "rebase-queued" is not yet supported'],
  ['visibility junk', (r) => (r.documents.findings.visibility = 'public'), 'documents.findings.visibility: must be "consumers" or "org"'],
  ['evidence not a list', (r) => (r.documents.findings.evidence = 'cited'), 'documents.findings.evidence: must be a list'],
  ['evidence kind unknown', (r) => (r.documents.findings.evidence = [{ kind: 'vibes' }]), 'evidence[0].kind: "vibes" is not an evidence kind'],
  ['evidence verify fetch', (r) => (r.documents.findings.evidence = [{ kind: 'source', verify: 'fetch' }]), 'verify "fetch" is not yet supported'],
  ['evidence verify rerun', (r) => (r.documents.findings.evidence = [{ kind: 'command', verify: 'rerun' }]), 'verify "rerun" is not yet supported'],
  ['evidence verify on a diff', (r) => (r.documents.findings.evidence = [{ kind: 'diff', verify: 'cited' }]), 'only a "source" entry takes verify "cited"'],
];

describe.each([
  ['surface keys', surfaceCases],
  ['sections', sectionCases],
  ['edges and types', edgeCases],
  ['documents', documentCases],
])('refused: %s', (_group, cases) => {
  it.each(cases)('%s', (_n, patch, expected) => {
    const f = findings(patch);
    expect(f.errors.some((e) => e.includes(expected)), JSON.stringify(f.errors)).toBe(true);
  });
});

describe('malformed top-level shapes are refused at parse', () => {
  it.each([['documents', []], ['sections', 'x'], ['requires', 3]])('%s', (key, value) => {
    expect(OrgDefSchema.safeParse(sectionsRaw((r) => (r[key] = value))).success).toBe(false);
  });
});

describe('messages and warnings', () => {
  it('every error starts with the path or role it is about and is long enough to say what to do', () => {
    const all = [...surfaceCases, ...sectionCases, ...edgeCases, ...documentCases];
    for (const [n, patch] of all) {
      for (const e of findings(patch).errors) {
        expect(e, n).toMatch(/^(sections|documents|requires|run_config|roles|schedule|role )[^ ]*[ :]/);
        expect(e.length, n).toBeGreaterThan(40);
      }
    }
  });

  it('a type no section consumes is a warning, not an error', () => {
    const f = findings((r) => delete r.sections.development.consumes);
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([expect.stringContaining('documents.findings: no section consumes it')]);
  });

  it('an unknown contract field is a warning', () => {
    const f = findings((r) => (r.documents.findings.colour = 'red'));
    expect(f.errors).toEqual([]);
    expect(f.warnings.join()).toContain('documents.findings.colour: unknown contract field');
  });

  it('contract fields owned by P3.4 are accepted without a finding', () => {
    const f = findings((r) => {
      Object.assign(r.documents.findings, {
        checks: [],
        max_publish_attempts: 3,
        max_consistency_refusals: 2,
        deliverable_files: [],
      });
    });
    expect(f).toEqual({ errors: [], warnings: [] });
  });

  it('is pure: the definition is not modified', () => {
    const def = OrgDefSchema.parse(sectionsRaw());
    const before = JSON.stringify(def);
    sectionsDefinitionFindings(def);
    expect(JSON.stringify(def)).toBe(before);
  });
});
