// packages/@monomind/cli/__tests__/orgrt/documents/guidance-phase4.test.ts
// P4.11: the role text for the Phase 4 keys, without a daemon. The synthetic orgs are in support/phase4-guidance-defs.ts
// (one base, one patch per key set). What a role is told is "its P3.12 block plus these lines": the added text is the
// P3.12 text of the same org with no Phase 4 key, subtracted from the text with the keys on.
import { describe, expect, it } from 'vitest';
import { documentGuidance } from '../../../src/orgrt/documents/guidance.js';
import { phase4Guidance, usesPhase4Keys } from '../../../src/orgrt/documents/guidance-phase4.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { findingsOrg } from '../support/doc-defs.js';
import { KEY_SETS, ROLES, UNUSABLE, phase4Org, phase4Variant } from '../support/phase4-guidance-defs.js';

const SIZE_CAP = 3800;
const parse = (raw: Record<string, any>) => OrgDefSchema.parse(raw);
const guidance = (set: string, role: string): string => documentGuidance(parse(phase4Org(KEY_SETS[set])), role) as string;
const added = (set: string, role: string): string[] => {
  const base = guidance('none', role);
  const full = guidance(set, role);
  expect(full.startsWith(base), `${set}/${role}: the P3.12 text comes first, unchanged`).toBe(true);
  return full === base ? [] : full.slice(base.length + 1).split('\n');
};

// The text each role of each key set is added, verbatim (reviewed by eye when captured).
const ADDED: Record<string, Record<string, string[]>> = {
  "writer": {
    "boss": [
      "You cannot change files in the workspace: section \"development\" is its only writer (src/**, docs/**). Hand a change over as a document (org_doc_publish) or ask a role of that section to apply it. A refused write is a rule, not an error: do not retry it or work around it."
    ],
    "dev-lead": [
      "Your section \"development\" owns writes to the workspace (src/**, docs/**): it is the only section that changes files there, and only inside those paths.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "coder": [
      "Your section \"development\" owns writes to the workspace (src/**, docs/**): it is the only section that changes files there, and only inside those paths."
    ],
    "qa-lead": [
      "You cannot change files in the workspace: section \"development\" is its only writer (src/**, docs/**). Hand a change over as a document (org_doc_publish) or hand it to your lead or the root; the writer applies it. A refused write is a rule, not an error: do not retry it or work around it.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "observer": [
      "You cannot change files in the workspace: section \"development\" is its only writer (src/**, docs/**). Hand a change over as a document (org_doc_publish) or hand it to your lead or the root; the writer applies it. A refused write is a rule, not an error: do not retry it or work around it.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ]
  },
  "budget": {
    "boss": [
      "Section allocations: development $30.00, qa $20.00, watch $20.00. You and the section lead are told at 80 percent; a closed section takes no new work until you raise its allocation and reload.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded."
    ],
    "dev-lead": [
      "Your section \"development\" has a USD allocation of $30.00. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "coder": [
      "Your section has a USD budget; a closed section pauses (no new work or tasks) until its allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded."
    ],
    "qa-lead": [
      "Your section \"qa\" has a USD allocation of $20.00. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "observer": [
      "Your section \"watch\" has a USD allocation of $20.00. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ]
  },
  "rework": {
    "boss": [
      "A spent rework cap reaches you as a notice (\"rework exhausted\") and you decide: accept the document yourself with org_doc_decide, raise the cap in the definition and reload it, or reassign the work. Your decision ends it."
    ],
    "dev-lead": [
      "Rework cap: your section rejects at most 3 versions of a document; the rejection that reaches it freezes the thread (the producer waits, the root decides): do not decide it again.",
      "Rework cap: section \"qa\" rejects at most 2 versions of a document; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.",
      "The root decides an exhausted thread; its decision ends it. Do not publish it again.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "coder": [
      "Rework cap: section \"qa\" rejects at most 2 versions of a document; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.",
      "The root decides an exhausted thread; its decision ends it. Do not publish it again."
    ],
    "qa-lead": [
      "Rework cap: your section rejects at most 2 versions of a document; the rejection that reaches it freezes the thread (the producer waits, the root decides): do not decide it again.",
      "Rework cap: section \"development\" rejects at most 3 versions of a document; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.",
      "The root decides an exhausted thread; its decision ends it. Do not publish it again.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "observer": [
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ]
  },
  "all": {
    "boss": [
      "You cannot change files in the workspace: section \"development\" is its only writer (src/**, docs/**). Hand a change over as a document (org_doc_publish) or ask a role of that section to apply it. A refused write is a rule, not an error: do not retry it or work around it.",
      "Section allocations: development $30.00, qa $20.00, watch $20.00. You and the section lead are told at 80 percent; a closed section takes no new work until you raise its allocation and reload.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "A spent rework cap reaches you as a notice (\"rework exhausted\") and you decide: accept the document yourself with org_doc_decide, raise the cap in the definition and reload it, or reassign the work. Your decision ends it."
    ],
    "dev-lead": [
      "Your section \"development\" owns writes to the workspace (src/**, docs/**): it is the only section that changes files there, and only inside those paths.",
      "Your section \"development\" has a USD allocation of $30.00. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "Rework cap: your section rejects at most 3 versions of a document; the rejection that reaches it freezes the thread (the producer waits, the root decides): do not decide it again.",
      "Rework cap: section \"qa\" rejects at most 2 versions of a document; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.",
      "The root decides an exhausted thread; its decision ends it. Do not publish it again.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "coder": [
      "Your section \"development\" owns writes to the workspace (src/**, docs/**): it is the only section that changes files there, and only inside those paths.",
      "Your section has a USD budget; a closed section pauses (no new work or tasks) until its allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "Rework cap: section \"qa\" rejects at most 2 versions of a document; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.",
      "The root decides an exhausted thread; its decision ends it. Do not publish it again."
    ],
    "qa-lead": [
      "You cannot change files in the workspace: section \"development\" is its only writer (src/**, docs/**). Hand a change over as a document (org_doc_publish) or hand it to your lead or the root; the writer applies it. A refused write is a rule, not an error: do not retry it or work around it.",
      "Your section \"qa\" has a USD allocation of $20.00. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "Rework cap: your section rejects at most 2 versions of a document; the rejection that reaches it freezes the thread (the producer waits, the root decides): do not decide it again.",
      "Rework cap: section \"development\" rejects at most 3 versions of a document; at the cap the thread is frozen and a revision is refused (REWORK_EXHAUSTED): stop, tell your lead, wait for the root.",
      "The root decides an exhausted thread; its decision ends it. Do not publish it again.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ],
    "observer": [
      "You cannot change files in the workspace: section \"development\" is its only writer (src/**, docs/**). Hand a change over as a document (org_doc_publish) or hand it to your lead or the root; the writer applies it. A refused write is a rule, not an error: do not retry it or work around it.",
      "Your section \"watch\" has a USD allocation of $20.00. You and the root are told at 80 percent; at 100 percent the section closes (no new work, no new task assigned into it, open tasks held) until the allocation is raised and the org reloaded.",
      "The org has a USD budget of $100.00; when spent, every role pauses until it is raised and the org reloaded.",
      "As section lead you assign tasks only inside your section (an org_task for another section is refused); raise a cross-section need with the root, who can reach any section."
    ]
  }
};

describe('text per key and role (golden)', () => {
  for (const [set, byRole] of Object.entries(ADDED))
    for (const [role, lines] of Object.entries(byRole))
      it(`${set} / ${role}`, () => {
        expect(added(set, role)).toEqual(lines);
      });
});

describe('role-kind matrix', () => {
  it('single writer: the writing section is told it owns writes, every other agent role that it cannot write', () => {
    expect(added('writer', 'coder')[0]).toMatch(/^Your section "development" owns writes to the workspace \(src\/\*\*, docs\/\*\*\)/);
    expect(added('writer', 'dev-lead')[0]).toMatch(/^Your section "development" owns writes/);
    for (const r of ['boss', 'qa-lead', 'observer'])
      expect(added('writer', r)[0], r).toMatch(/^You cannot change files in the workspace: section "development" is its only writer/);
    expect(added('writer', 'boss')[0]).toMatch(/ask a role of that section to apply it/);
    expect(added('writer', 'qa-lead')[0]).toMatch(/hand it to your lead or the root/);
    for (const r of ROLES) expect(added('writer', r).join('\n'), r).toMatch(/not an error|owns writes/);
  });

  it('budget: the lead gets the allocation, a member less, the root the list', () => {
    expect(added('budget', 'dev-lead')[0]).toMatch(/^Your section "development" has a USD allocation of \$30\.00\. You and the root are told at 80 percent;/);
    expect(added('budget', 'dev-lead')[0]).toMatch(/closes \(no new work, no new task assigned into it, open tasks held\) until the allocation is raised/);
    expect(added('budget', 'coder')[0]).toMatch(/^Your section has a USD budget; a closed section pauses/);
    expect(added('budget', 'coder')[0]).not.toMatch(/\$30/);
    expect(added('budget', 'boss')[0]).toMatch(/^Section allocations: development \$30\.00, qa \$20\.00, watch \$20\.00\./);
    expect(added('budget', 'observer')[0]).toMatch(/^Your section "watch" has a USD allocation of \$20\.00\./);
    for (const r of ROLES) expect(added('budget', r).join('\n'), r).toMatch(/The org has a USD budget of \$100\.00/);
  });

  it('rework cap: the deciding lead, the producers and the root; a role with no document gets no cap line', () => {
    expect(added('rework', 'qa-lead')[0]).toMatch(/^Rework cap: your section rejects at most 2 versions/);
    expect(added('all', 'dev-lead').find((l) => l.startsWith('Rework cap: your section'))).toMatch(/^Rework cap: your section rejects at most 3 versions/);
    expect(added('rework', 'coder').join('\n')).toMatch(/section "qa" rejects at most 2 versions of a document; at the cap the thread is frozen and a revision is refused \(REWORK_EXHAUSTED\)/);
    expect(added('rework', 'boss').join('\n')).toMatch(/you decide: accept the document yourself with org_doc_decide/);
    expect(added('rework', 'observer').join('\n')).not.toMatch(/Rework cap|its decision ends it/);
    for (const r of ['dev-lead', 'coder', 'qa-lead']) expect(added('rework', r).join('\n'), r).toMatch(/its decision ends it/);
  });

  it('lead rights: only a section lead, only where a Phase 4 key is set', () => {
    for (const set of ['writer', 'budget', 'rework']) {
      for (const r of ['dev-lead', 'qa-lead', 'observer']) expect(added(set, r).join('\n'), `${set}/${r}`).toMatch(/As section lead you assign tasks only inside your section/);
      for (const r of ['coder', 'boss']) expect(added(set, r).join('\n'), `${set}/${r}`).not.toMatch(/As section lead/);
    }
  });

  it('a role of an org that sets several keys gets each block once', () => {
    const lines = added('all', 'dev-lead');
    expect(lines.filter((l) => l.startsWith('Rework cap:')).length).toBe(2);
    expect(lines.filter((l) => l.startsWith('The root decides')).length).toBe(1);
    expect(lines.filter((l) => l.startsWith('As section lead')).length).toBe(1);
  });
});

describe('nothing is added without a Phase 4 key', () => {
  it('the org with no key, and the org whose four keys are present but unusable, add nothing to any role', () => {
    const unusable = parse(phase4Org(UNUSABLE));
    expect(usesPhase4Keys(parse(phase4Org([])))).toBe(false);
    expect(usesPhase4Keys(unusable)).toBe(false);
    for (const r of ROLES) {
      expect(documentGuidance(unusable, r), r).toBe(guidance('none', r));
      expect(documentGuidance(unusable, r), r).not.toMatch(/Rework cap|USD|only writer|owns writes|As section lead/);
      expect(phase4Guidance(unusable, r, { produces: [], decides: [], consumerSections: () => [] }), r).toEqual([]);
    }
  });

  it('the P3.12 org has none: its text ends where the P3.12 text ended', () => {
    const def = parse(findingsOrg());
    expect(usesPhase4Keys(def)).toBe(false);
    for (const r of ['boss', 'researcher', 'dev-lead', 'coder', 'observer'])
      expect(documentGuidance(def, r) as string).not.toMatch(/Rework cap|USD|only writer|owns writes|As section lead/);
  });

  it('a sections-off org is given no text at all, with or without the keys', () => {
    for (const set of ['none', 'all']) {
      const raw = phase4Org(KEY_SETS[set]);
      const { sections, documents, requires, ...rest } = raw;
      expect(documentGuidance(parse(rest as Record<string, any>), 'dev-lead'), set).toBeUndefined();
    }
  });
});

describe('size, determinism and wording', () => {
  it('every role of every key set stays under the cap, and the Phase 4 lines stay short', () => {
    for (const set of Object.keys(KEY_SETS))
      for (const r of ROLES) {
        expect(guidance(set, r).length, `${set}/${r}`).toBeLessThan(SIZE_CAP);
        expect(guidance(set, r).split('\n').length, `${set}/${r}`).toBeLessThan(25);
        expect(added(set, r).join('\n').length, `${set}/${r}`).toBeLessThan(1500);
      }
  });

  it('the text is a pure function of the definition: same bytes on every call, and from a fresh copy', () => {
    for (const set of Object.keys(KEY_SETS))
      for (const r of ROLES) {
        const def = parse(phase4Org(KEY_SETS[set]));
        expect(documentGuidance(def, r)).toBe(documentGuidance(def, r));
        expect(documentGuidance(parse(phase4Org(KEY_SETS[set])), r)).toBe(documentGuidance(def, r));
      }
  });

  it('values come from the definition: a changed allocation, cap and glob change the text', () => {
    const def = parse(phase4Variant());
    expect(documentGuidance(def, 'dev-lead')).toMatch(/allocation of \$45\.50/);
    expect(documentGuidance(def, 'dev-lead')).toMatch(/section "qa" rejects at most 7 versions/);
    expect(documentGuidance(def, 'boss')).toMatch(/only writer \(lib\/\*\*\)/);
  });

  it('no trial wording', () => {
    for (const set of Object.keys(KEY_SETS))
      for (const r of ROLES) expect(added(set, r).join('\n'), `${set}/${r}`).not.toMatch(/\bfault|\bseed|\binject|harness|pilot|sweep|fixture/i);
  });
});
