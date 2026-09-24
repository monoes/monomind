// The skill index is generated per project: `init upgrade` must rebuild a stale
// snapshot from the project's own skills, never copy the package's.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { executeUpgrade } from '../init/upgrade.js';

const TMP: string[] = [];
afterAll(() => {
  for (const d of TMP) rmSync(d, { recursive: true, force: true });
});

describe('init upgrade regenerates skill-registry.json', () => {
  it('replaces a stale snapshot with the project skills', async () => {
    const target = mkdtempSync(join(tmpdir(), 'mm-upgrade-index-'));
    TMP.push(target);
    const helpers = join(target, '.claude', 'helpers');
    mkdirSync(helpers, { recursive: true });
    mkdirSync(join(target, '.claude', 'skills', 'project-only'), { recursive: true });
    writeFileSync(
      join(target, '.claude', 'skills', 'project-only', 'SKILL.md'),
      '---\nname: project-only\ndescription: Lives only in this project\n---\n',
    );
    writeFileSync(join(target, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    writeFileSync(
      join(helpers, 'skill-registry.json'),
      JSON.stringify({ skills: [{ skill: 'phantom', invoke: 'Skill("phantom")' }] }),
    );

    await executeUpgrade(target);

    const index = JSON.parse(readFileSync(join(helpers, 'skill-registry.json'), 'utf8'));
    const names = index.skills.map((s: { skill: string }) => s.skill);
    expect(names).toContain('project-only');
    expect(names).not.toContain('phantom');
    expect(Array.isArray(index.orgSkills)).toBe(true);
  }, 120_000);
});
