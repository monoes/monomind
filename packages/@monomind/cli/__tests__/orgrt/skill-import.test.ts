import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyLicense, importRepo } from '../../src/orgrt/skill-import.js';

const MIT = 'MIT License\n\nCopyright (c) 2025 Someone\n\nPermission is hereby granted, free of charge, to any person...\nTHE SOFTWARE IS PROVIDED "AS IS"';
const APACHE = '                                 Apache License\n                           Version 2.0, January 2004';

function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  writeFileSync(join(root, 'LICENSE'), MIT);
  const skill = (dir: string, fm: string, extra: Record<string, string> = {}) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'SKILL.md'), `---\n${fm}\n---\n# Body\n`);
    for (const [f, t] of Object.entries(extra)) {
      mkdirSync(join(root, dir, f, '..'), { recursive: true });
      writeFileSync(join(root, dir, f), t);
    }
  };
  skill('skills/good', 'name: good\ndescription: "A good skill"', { 'references/more.md': 'MORE', 'scripts/run.py': 'print(1)' });
  skill('skills/gpl', 'name: gpl\ndescription: GPL one\nlicense: GPL-3.0');
  skill('skills/own-apache', 'name: own-apache\ndescription: own file\nlicense: Complete terms in LICENSE.txt', { 'LICENSE.txt': APACHE });
  skill('skills/own-proprietary', 'name: own-proprietary\ndescription: nope', { 'LICENSE.txt': 'Proprietary. All rights reserved.' });
  skill('skills/declared-apache', 'name: declared-apache\ndescription: d\nlicense: Apache-2.0 license');
  skill('skills/declared-bsd', 'name: declared-bsd\ndescription: d\nlicense: BSD-3-Clause license');
  skill('docs/ja/skills/good', 'name: good\ndescription: translated copy');
  return root;
}

describe('classifyLicense', () => {
  it('accepts MIT and Apache-2.0 spellings and texts only', () => {
    for (const s of ['MIT', 'MIT license', '"MIT"', MIT]) expect(classifyLicense(s)).toBe('MIT');
    for (const s of ['Apache-2.0', 'Apache 2.0', 'Apache-2.0 license', APACHE]) expect(classifyLicense(s)).toBe('Apache-2.0');
    for (const s of ['BSD-3-Clause', 'GPL-3.0', 'Proprietary', 'Unknown']) expect(classifyLicense(s)).toBeUndefined();
  });
});

describe('importRepo', () => {
  const repo = fixtureRepo();
  const dest = mkdtempSync(join(tmpdir(), 'lib-'));
  const results = importRepo(repo, dest);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));

  it('imports MIT and Apache skills, refuses other licenses', () => {
    expect(byName.good).toMatchObject({ ok: true, license: 'MIT' });
    expect(byName['own-apache']).toMatchObject({ ok: true, license: 'Apache-2.0' });
    expect(byName.gpl).toMatchObject({ ok: false });
    expect(byName['declared-apache']).toMatchObject({ ok: true, license: 'Apache-2.0' });
    expect(byName['declared-bsd']).toMatchObject({ ok: false });
    // the repo's MIT text does not govern an Apache skill, so it isn't kept as its license
    expect(existsSync(join(dest, 'declared-apache', 'LICENSE.txt'))).toBe(false);
    expect(byName['own-proprietary']).toMatchObject({ ok: false });
  });

  it('records provenance and keeps the license text', () => {
    const md = readFileSync(join(dest, 'good', 'SKILL.md'), 'utf-8');
    expect(md).toContain(`source: ${repo}`);
    expect(md).toContain('source_path: "skills/good"');
    expect(md).toContain('license: MIT');
    expect(readFileSync(join(dest, 'good', 'LICENSE.txt'), 'utf-8')).toContain('Copyright (c) 2025 Someone');
    expect(readFileSync(join(dest, 'own-apache', 'LICENSE.txt'), 'utf-8')).toContain('Apache License');
  });

  it('copies markdown references but not scripts, and the original beats a deeper translation', () => {
    expect(readFileSync(join(dest, 'good', 'references', 'more.md'), 'utf-8')).toBe('MORE');
    expect(existsSync(join(dest, 'good', 'scripts'))).toBe(false);
    expect(readFileSync(join(dest, 'good', 'SKILL.md'), 'utf-8')).toContain('A good skill');
  });

  it('does not overwrite an existing skill unless asked', () => {
    expect(importRepo(repo, dest, { only: ['good'] })[0]).toMatchObject({ ok: false, reason: 'already in the library' });
    expect(importRepo(repo, dest, { only: ['good'], overwrite: true })[0]).toMatchObject({ ok: true });
  });
});
