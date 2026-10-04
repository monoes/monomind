// P3.12: the role text of a sections org (documents/guidance.ts). Pure tests over definitions: the text per kind
// of role, that it is built from the definition and not hard-coded, that it carries nothing from any trial,
// its size, its determinism, that a sections-off definition gets nothing, and that the prompt differs from the
// sections-off prompt only by the block. No daemon, no model.
import { describe, expect, it } from 'vitest';
import { MAX_TYPES_LISTED, documentGuidance } from '../../../src/orgrt/documents/guidance.js';
import { schemaSummary } from '../../../src/orgrt/documents/guidance-schema.js';
import { rolePromptFor } from '../../../src/orgrt/session-prompt.js';
import { buildRolePrompt } from '../../../src/orgrt/session.js';
import { type OrgDef, OrgDefSchema, type OrgRole } from '../../../src/orgrt/types.js';
import { findingsOrg, role } from '../support/doc-defs.js';

const parse = (raw: Record<string, any>): OrgDef => OrgDefSchema.parse(raw);

const FILES = [
  { file: 'out/findings.json', select: { array: 'items', key: 'id', value: 'x' }, compare: ['summary'] },
];
/** research publishes findings (with a deliverable file and a check); development and qa consume it. */
const withContract = (patch: (raw: Record<string, any>) => void = () => {}): OrgDef =>
  parse(
    (() => {
      const raw = findingsOrg({ qa: true });
      raw.documents.findings.deliverable_files = FILES;
      raw.documents.findings.checks = [{ type: 'value_type', is: 'integer' }];
      patch(raw);
      return raw;
    })(),
  );

const ROLES = ['boss', 'research-lead', 'researcher', 'dev-lead', 'coder', 'qa-lead', 'observer'];
const text = (def: OrgDef, id: string): string => documentGuidance(def, id) as string;

describe('nothing for an org that is not on the sections surface', () => {
  it('a definition with no sections, with empty sections, and an unknown role', () => {
    const raw = findingsOrg();
    const plain = { ...raw, sections: undefined, documents: undefined, requires: undefined };
    for (const r of ROLES) expect(documentGuidance(plain as unknown as OrgDef, r)).toBeUndefined();
    expect(documentGuidance({ ...raw, sections: {} } as unknown as OrgDef, 'boss')).toBeUndefined();
    expect(documentGuidance(withContract(), 'nobody')).toBeUndefined();
  });
});

describe('text per kind of role', () => {
  const def = withContract();

  it('producer: its section and lead, the type with schema, evidence, files and attempts, and what to do', () => {
    const t = text(def, 'researcher');
    expect(t).toContain('You are in section "research" (lead: research-lead).');
    expect(t).toContain('- findings: {summary: string, notes?: string}');
    expect(t).toContain('1 source');
    expect(t).toContain('out/findings.json');
    expect(t).toContain('3 publish attempts');
    expect(t).toContain('consumer(s) development, qa');
    expect(t).toMatch(/verify it on disk/);
    expect(t).toMatch(/refused with every problem named/);
    expect(t).toMatch(/Repeating an identical publish call is safe/);
    expect(t).toMatch(/"document rejected: <id> v<n>"/);
    expect(t).toMatch(/supersedes set to the head id@vN/);
    expect(t).toMatch(/Nobody has to relay it/);
    expect(t).toContain('then tell "research-lead" it is published');
    expect(t).toContain('org_send to a role in another section is refused');
    expect(t).toMatch(/only the org_doc_\* tools reach them/);
    expect(t).not.toMatch(/You decide/);
    expect(t).not.toMatch(/As a lead/);
  });

  it('a producer that leads its section is told so, and its manager is the root', () => {
    const t = text(def, 'research-lead');
    expect(t).toContain('(lead: research-lead, that is you)');
    expect(t).toContain('then tell "boss" it is published');
    expect(t).toContain('As a lead: you are not asked to relay rejections');
  });

  it('consumer decider: wake, read, check, decide per version, no relay, accepted versions only', () => {
    const t = text(def, 'dev-lead');
    expect(t).toContain('You decide for section "development" on:');
    expect(t).toContain('- findings, published by section research');
    expect(t).toContain('("document ready: <id> v<n>") wakes you');
    expect(t).toMatch(/do not poll: if nothing is published yet, end your turn/);
    expect(t).toMatch(/org_doc_read\).*org_doc_check.*necessary check.*not a sufficient one/s);
    expect(t).toMatch(/reject with a reason the producer can act on/);
    expect(t).toMatch(/do not ask anyone to relay it/);
    expect(t).toMatch(/A decision is per version/);
    expect(t).toMatch(/only when every consuming section accepts/);
    expect(t).not.toMatch(/You publish/);
  });

  it('consumer member: reads accepted versions only and decides nothing', () => {
    const t = text(def, 'coder');
    expect(t).toContain('Your section consumes:');
    expect(t).toMatch(/Only your section lead decides on them; you read accepted versions only/);
    expect(t).not.toMatch(/org_doc_decide/);
    expect(t).not.toMatch(/You publish|You decide/);
  });

  it('root: reads everything, may message any role, and the lead duties, with no publish or decide duty', () => {
    const t = text(def, 'boss');
    expect(t).toContain('You are the root: in no section.');
    expect(t).toContain('As a lead: you are not asked to relay rejections');
    expect(t).toMatch(/"\[watch\]" message that a document has gone unread/);
    expect(t).toMatch(/reassign its unfinished work to an idle role/);
    expect(t).not.toMatch(/You publish|You decide/);
  });

  it('a decider is told about org_doc_check only when a contract declares checks', () => {
    expect(text(def, 'dev-lead')).toContain('org_doc_check');
    expect(text(withContract((r) => delete r.documents.findings.checks), 'dev-lead')).not.toContain('org_doc_check');
  });

  it('a role in no section: documents are not its job, it may message any role', () => {
    const t = text(def, 'observer');
    expect(t).toContain('You are in no section.');
    expect(t).toMatch(/You publish and decide none/);
    expect(t).toMatch(/you may message any role/);
    expect(t.split('\n').length).toBeLessThanOrEqual(4);
  });

  it('a manager that is neither root nor a section lead gets the lead duties it can use', () => {
    const def2 = parse(
      (() => {
        const raw = findingsOrg();
        raw.roles.push(role('intern', 'observer'));
        return raw;
      })(),
    );
    const t = text(def2, 'observer');
    expect(t).toContain('As a lead: if a role never started or has gone silent');
    expect(t).not.toContain('relay rejections');
  });
});

describe('built from the definition, not hard-coded', () => {
  it('limits, evidence, schema fields, section names and files come from the contract', () => {
    const a = text(withContract(), 'researcher');
    const b = text(
      withContract((r) => {
        r.documents.findings.max_publish_attempts = 7;
        r.documents.findings.evidence = [{ kind: 'source', verify: 'cited', min: 2 }, { kind: 'command' }];
        r.documents.findings.schema = { type: 'object', required: ['title'], properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } } };
        r.documents.findings.deliverable_files = [{ ...FILES[0], file: 'reports/other.json' }];
      }),
      'researcher',
    );
    expect(a).not.toBe(b);
    expect(b).toContain('7 publish attempts');
    expect(b).toContain('2 source, 1 command');
    expect(b).toContain('{title: string, tags?: [string] x1-3}');
    expect(b).toContain('reports/other.json');
    expect(b).not.toContain('out/findings.json');
    expect(a).toContain('3 publish attempts');
  });

  it('with no deliverable files the text says nothing about files disagreeing', () => {
    const t = text(withContract((r) => delete r.documents.findings.deliverable_files), 'researcher');
    expect(t).not.toMatch(/disagrees with your deliverable files/);
    expect(t).not.toMatch(/needs republishing/);
    expect(t).not.toMatch(/the body must agree with your files/);
  });

  it('renamed sections and roles flow through', () => {
    const def = withContract((r) => {
      r.sections.research = { ...r.sections.research };
      r.sections.intel = r.sections.research;
      delete r.sections.research;
    });
    expect(text(def, 'researcher')).toContain('You are in section "intel"');
    expect(text(def, 'dev-lead')).toContain('published by section intel');
  });
});

describe('carries nothing from any trial', () => {
  it('no fault, seed, injection, harness, pilot, sweep or fixture wording, for any role', () => {
    const def = withContract();
    for (const r of ROLES)
      expect(text(def, r), r).not.toMatch(/\bfault|\bseed|\binject|harness|pilot|sweep|fixture|synthesi|worker-|\bm\d+\b|corpus/i);
  });
});

describe('size', () => {
  const lines = (s: string): number => s.split('\n').length;

  it('at most 25 lines and a few thousand characters per role', () => {
    const def = withContract();
    for (const r of ROLES) {
      expect(lines(text(def, r)), r).toBeLessThanOrEqual(25);
      expect(text(def, r).length, r).toBeLessThan(3800);
    }
  });

  it('a role with many types lists at most MAX_TYPES_LISTED and points at org_doc_list for the rest', () => {
    const def = parse(
      (() => {
        const raw = findingsOrg();
        for (let i = 0; i < 12; i++) {
          raw.documents[`extra-${i}`] = { schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } };
          raw.sections.research.publishes.push(`extra-${i}`);
          raw.sections.development.consumes.push(`extra-${i}`);
        }
        return raw;
      })(),
    );
    for (const r of ['researcher', 'dev-lead', 'coder']) {
      const t = text(def, r);
      expect(t.match(/^- /gm)?.length, r).toBe(MAX_TYPES_LISTED);
      expect(t, r).toContain(`and ${13 - MAX_TYPES_LISTED} more (org_doc_list shows them all)`);
      expect(lines(t), r).toBeLessThanOrEqual(25);
    }
  });

  it('schema summaries are bounded and keep the top level when nothing deeper fits', () => {
    const wide = { type: 'object', required: ['a'], properties: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, { type: 'string' }])) };
    expect(schemaSummary(wide).length).toBeLessThanOrEqual(360);
    const deep = { type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' } } } } } };
    expect(schemaSummary(deep)).toBe('{list?: [{x?: integer}]}');
    expect(schemaSummary({ enum: ['a', 'b', 'c', 'd', 'e'] })).toBe('one of 5 fixed values');
  });
});

describe('determinism', () => {
  it('the same definition gives the same bytes, for every role, every time', () => {
    for (const r of ROLES) expect(text(withContract(), r)).toBe(text(withContract(), r));
  });
});

describe('the prompt differs from the sections-off prompt only by the block', () => {
  const def = withContract();
  const roleOf = (id: string): OrgRole => def.roles.find((r) => r.id === id) as OrgRole;
  const roster = def.roles.map((r) => r.id);
  const opts = (id: string, documents?: unknown) =>
    ({ org: def.name, role: roleOf(id), def, cwd: '/work', ...(documents ? { documents } : {}) }) as never;

  it('no documents host: rolePromptFor is exactly buildRolePrompt with no extra guidance', () => {
    for (const r of ROLES) expect(rolePromptFor(opts(r))).toBe(buildRolePrompt(roleOf(r), def, roster));
  });

  it('with a documents host: the same bytes plus the block, inserted where extra guidance goes', () => {
    for (const r of ROLES) {
      const on = rolePromptFor(opts(r, { role: r }));
      const off = rolePromptFor(opts(r));
      expect(on, r).not.toBe(off);
      expect(on, r).toBe(buildRolePrompt(roleOf(r), def, roster, undefined, text(def, r)));
      expect(on.replace(`\n\n${text(def, r)}`, ''), r).toBe(off);
    }
  });

  it('a definition without sections never gets the block, even with a host', () => {
    const plain = parse({ ...findingsOrg(), sections: undefined, documents: undefined, requires: undefined });
    const o = { org: plain.name, role: plain.roles[1], def: plain, cwd: '/work', documents: { role: 'x' } } as never;
    expect(rolePromptFor(o)).toBe(buildRolePrompt(plain.roles[1] as OrgRole, plain, plain.roles.map((r) => r.id)));
  });
});
