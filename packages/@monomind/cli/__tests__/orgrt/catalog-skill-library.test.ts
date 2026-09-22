import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getSkill,
  listSkills,
  loadSkillText,
  roleSkillGuidance,
  searchSkills,
  skillToolProvider,
  skillTools,
} from '../../src/orgrt/skill-library.js';
import { newRoot, tamper, writeEntry } from '../catalog/fixtures.js';

function legacySkill(root: string, name: string, description: string): void {
  const dir = join(root, '.monomind', 'org-skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nLEGACY BODY ${name}\n`);
}

const catReview = (root: string) =>
  writeEntry(root, {
    name: 'cat-review',
    description: 'Catalog review procedure',
    tags: ['review'],
    tools: ['monograph_query', 'config_set'],
    grantedTools: ['monograph_query'],
    files: {
      'SKILL.md':
        '---\nname: cat-review\ndescription: Catalog review procedure\ntags: [review]\ntools: [monograph_query, config_set]\n---\nBODY-SENTINEL for cat-review\n',
      'ref/notes.md': 'NOTES',
      'LICENSE.txt': 'MIT License',
    },
  });

describe('catalog skills in the org library', () => {
  it('exposes an active org skill once, with its granted tools only', () => {
    const root = newRoot();
    const e = catReview(root);
    const hits = listSkills(root).filter((s) => s.name === 'cat-review');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ origin: 'catalog', catalogId: e.id, tools: ['monograph_query'] });
    const s = getSkill('cat-review', root);
    expect(s).toMatchObject({ origin: 'catalog', catalogId: 'skill:cat-review', tools: ['monograph_query'] });
    expect(s?.body).toContain('BODY-SENTINEL for cat-review');
    expect(skillTools(['cat-review'], root)).toEqual(['monograph_query']);
    expect(skillToolProvider({ skills: ['cat-review'] }, root)?.allow).toEqual(['monograph_query']);
    expect(searchSkills('catalog review procedure', root)[0].name).toBe('cat-review');
    expect(roleSkillGuidance({ skills: ['cat-review'] }, root)).toContain('BODY-SENTINEL for cat-review');
  });

  it('lets a legacy skill of the same name win unless the entry replaces it', () => {
    const root = newRoot();
    legacySkill(root, 'cat-review', 'legacy one');
    catReview(root);
    expect(getSkill('cat-review', root)?.origin).toBe('project');
    expect(listSkills(root).filter((s) => s.name === 'cat-review').map((s) => s.origin)).toEqual(['project']);

    const root2 = newRoot();
    legacySkill(root2, 'cat-swap', 'legacy one');
    writeEntry(root2, { name: 'cat-swap', replacesLegacy: true });
    expect(getSkill('cat-swap', root2)?.origin).toBe('catalog');
    expect(listSkills(root2).filter((s) => s.name === 'cat-swap').map((s) => s.origin)).toEqual(['catalog']);
  });

  it('never exposes staged, disabled, platform-only or tampered entries', () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-staged', status: 'staged' });
    writeEntry(root, { name: 'cat-disabled', status: 'disabled' });
    writeEntry(root, { name: 'cat-claude', targets: ['platform:claude'] });
    tamper(writeEntry(root, { name: 'cat-tampered' }));
    const names = new Set(listSkills(root).map((s) => s.name));
    for (const n of ['cat-staged', 'cat-disabled', 'cat-claude', 'cat-tampered']) {
      expect(names.has(n)).toBe(false);
      expect(getSkill(n, root)).toBeNull();
    }
  });

  it('re-verifies the package before loading a body', () => {
    const root = newRoot();
    const e = catReview(root);
    expect(listSkills(root).some((s) => s.name === 'cat-review')).toBe(true);
    tamper(e);
    expect(getSkill('cat-review', root)).toBeNull();
    expect(loadSkillText('cat-review', undefined, root)).toMatch(/^ERROR/);
  });

  it('serves reference files from the package dir and refuses escapes', () => {
    const root = newRoot();
    catReview(root);
    legacySkill(root, 'zz-other', 'other');
    expect(loadSkillText('cat-review', undefined, root)).toContain('ref/notes.md');
    expect(loadSkillText('cat-review', 'ref/notes.md', root)).toBe('NOTES');
    expect(loadSkillText('cat-review', '../../../org-skills/zz-other/SKILL.md', root)).toMatch(/^ERROR/);
    expect(loadSkillText('cat-review', '../LICENSE.txt', root)).toMatch(/^ERROR/);
  });
});
