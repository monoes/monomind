// P4.9 (plan 13.2): the pure lead rules. The org_task assignee bound matrix, the recipient of a notice about a role,
// the corrected cross-section org_send refusal text (open item 25, choice (b)), and the rules being inert for an
// org that is not on the sections surface.
import { describe, expect, it } from 'vitest';
import { leadFor, sectionLead, taskAssignmentRefusal } from '../../../src/orgrt/documents/lead-rules.js';
import { crossSectionRefusal, crossSectionRefusalText } from '../../../src/orgrt/documents/routing.js';

const role = (id: string, reports_to: string | null) => ({ id, type: reports_to === null ? 'boss' : 'specialist', reports_to });

// boss (root); research: lead research-lead, members researcher, scout; development: dedicated lead dev-lead, member
// coder; solo: one member leading itself; floater is in no section.
const def = {
  sections: {
    research: { lead: 'research-lead', members: ['research-lead', 'researcher', 'scout'] },
    development: { lead: 'dev-lead', members: ['coder'] },
    solo: { members: ['loner'] },
  },
  roles: [
    role('boss', null),
    role('research-lead', 'boss'),
    role('researcher', 'research-lead'),
    role('scout', 'boss'),
    role('dev-lead', 'boss'),
    role('coder', 'dev-lead'),
    role('loner', 'boss'),
    role('floater', 'boss'),
  ],
};

describe('taskAssignmentRefusal: the org_task assignee bound', () => {
  const refused = (from: string, to: string) => taskAssignmentRefusal(def, from, to);

  it('a section lead may assign to its own members, and a member to a member of the same section', () => {
    expect(refused('research-lead', 'researcher')).toBeUndefined();
    expect(refused('dev-lead', 'coder')).toBeUndefined();
    expect(refused('researcher', 'scout')).toBeUndefined();
    expect(refused('researcher', 'researcher')).toBeUndefined();
  });

  it('a lead or a member may not assign into another section, a lead included', () => {
    expect(refused('research-lead', 'coder')).toMatch(/^REFUSED: research-lead \(section research\) cannot assign a task to coder \(section development\)/);
    expect(refused('researcher', 'coder')).toMatch(/^REFUSED:/);
    expect(refused('researcher', 'dev-lead')).toMatch(/^REFUSED:/);
    expect(refused('research-lead', 'dev-lead')).toMatch(/^REFUSED:/);
    expect(refused('coder', 'loner')).toMatch(/^REFUSED:/);
    expect(refused('loner', 'researcher')).toMatch(/^REFUSED:/);
  });

  it('the root may assign to anyone, and anyone may assign to the root', () => {
    for (const to of ['research-lead', 'researcher', 'coder', 'loner', 'floater']) expect(refused('boss', to)).toBeUndefined();
    for (const from of ['researcher', 'coder', 'dev-lead']) expect(refused(from, 'boss')).toBeUndefined();
  });

  it('a role in no section is not bound by the map, as for org_send', () => {
    expect(refused('floater', 'coder')).toBeUndefined();
    expect(refused('coder', 'floater')).toBeUndefined();
    expect(refused('researcher', 'auto')).toBeUndefined(); // an assignee that is not a role (resolved later)
  });

  it('names the rule and the legitimate routes: documents, or the root', () => {
    expect(refused('researcher', 'coder')).toBe(
      'REFUSED: researcher (section research) cannot assign a task to coder (section development). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can assign to any section.',
    );
  });

  it('is undefined for an org that is not on the sections surface', () => {
    const { sections: _s, ...plain } = def;
    expect(taskAssignmentRefusal(plain, 'researcher', 'coder')).toBeUndefined();
    expect(taskAssignmentRefusal({ ...def, sections: {} }, 'researcher', 'coder')).toBeUndefined();
    expect(taskAssignmentRefusal({ ...def, sections: { a: {} } }, 'researcher', 'coder')).toBeUndefined();
  });
});

describe('leadFor: who is told about a role', () => {
  it('a member is reported to its section lead, even when its reports_to says otherwise', () => {
    expect(leadFor(def, 'researcher', 'boss')).toBe('research-lead');
    expect(leadFor(def, 'scout', 'boss')).toBe('research-lead'); // reports_to is boss, the section lead wins
    expect(leadFor(def, 'coder', 'boss')).toBe('dev-lead');
  });

  it('a lead, a self-led member and a role in no section fall back to reports_to, then the root', () => {
    expect(leadFor(def, 'research-lead', 'boss')).toBe('boss');
    expect(leadFor(def, 'loner', 'boss')).toBe('boss');
    expect(leadFor(def, 'floater', 'boss')).toBe('boss');
    expect(leadFor({ ...def, roles: [...def.roles, { id: 'orphan' }] }, 'orphan', 'boss')).toBe('boss'); // no reports_to at all
    const chain = { ...def, roles: def.roles.map((r) => (r.id === 'floater' ? role('floater', 'dev-lead') : r)) };
    expect(leadFor(chain, 'floater', 'boss')).toBe('dev-lead'); // an unsectioned role keeps its reports_to
  });

  it('is exactly the plain reports_to rule for an org that is not on the sections surface', () => {
    const { sections: _s, ...plain } = def;
    for (const r of def.roles) expect(leadFor(plain, r.id, 'boss')).toBe(r.reports_to ?? 'boss');
    expect(leadFor({ ...def, sections: {} }, 'scout', 'boss')).toBe('boss'); // an empty map is off too
  });

  it('sectionLead: the declared lead, else the first member', () => {
    expect(sectionLead(def, 'research')).toBe('research-lead');
    expect(sectionLead(def, 'solo')).toBe('loner');
    expect(sectionLead(def, 'nope')).toBeUndefined();
  });
});

describe('the cross-section org_send refusal text (open item 25, choice (b))', () => {
  const text = crossSectionRefusalText('researcher', 'research', 'coder', 'development');

  it('no longer promises a lead-to-lead path, and names documents and the root', () => {
    expect(text).toBe(
      'REFUSED: researcher (section research) cannot message coder (section development). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can reach any section.',
    );
    expect(text).not.toMatch(/other lead|section lead/);
  });

  it('is what the send decision returns, and the lead-to-lead send is still refused (the text no longer says otherwise)', () => {
    expect(crossSectionRefusal(def, 'research-lead', 'dev-lead')).toBe(
      crossSectionRefusalText('research-lead', 'research', 'dev-lead', 'development'),
    );
  });
});
