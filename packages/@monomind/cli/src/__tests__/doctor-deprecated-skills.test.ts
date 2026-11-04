import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDeprecatedSkills, findDeprecatedSkills } from '../commands/doctor-project-checks.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

/** The 7 org-admin skills deprecated by surface-reduction item C1. */
const C1_SKILLS = [
  'mastermind-access',
  'mastermind-environments',
  'mastermind-invite-landing',
  'mastermind-invites',
  'mastermind-join-queue',
  'mastermind-plugin-manager',
  'mastermind-secrets',
];

function writeSkill(root: string, tree: string, name: string, description: string): void {
  const dir = join(root, tree, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`,
  );
}

describe('doctor: deprecated skills', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mm-doctor-deprecated-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes when no installed skill is deprecated', async () => {
    writeSkill(root, '.claude/skills', 'mastermind-review', 'Review code');
    const r = await checkDeprecatedSkills(root);
    expect(r.status).toBe('pass');
  });

  it('passes when the project has no skill trees', async () => {
    expect((await checkDeprecatedSkills(root)).status).toBe('pass');
  });

  it('warns and names each deprecated skill once across platform trees', async () => {
    writeSkill(root, '.claude/skills', 'mastermind-secrets', 'Deprecated: Mastermind secrets');
    writeSkill(root, '.agents/skills', 'mastermind-secrets', 'Deprecated: Mastermind secrets');
    writeSkill(root, '.gemini/skills', 'mastermind-access', 'Deprecated: Mastermind access');
    writeSkill(root, '.claude/skills', 'mastermind-review', 'Review code, not Deprecated: here');
    expect(findDeprecatedSkills(root)).toEqual(['mastermind-access', 'mastermind-secrets']);
    const r = await checkDeprecatedSkills(root);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('2 deprecated skill(s)');
    expect(r.message).toContain('mastermind-access, mastermind-secrets');
    expect(r.fix).toBeTruthy();
  });

  it('the shipped C1 skills carry the Deprecated: prefix, and nothing else does', () => {
    const skillsDir = join(REPO_ROOT, '.claude', 'skills');
    const deprecated = readdirSync(skillsDir).filter((d) => {
      try {
        return /^description:\s*"Deprecated:/m.test(
          readFileSync(join(skillsDir, d, 'SKILL.md'), 'utf8'),
        );
      } catch {
        return false;
      }
    });
    expect(deprecated.sort()).toEqual(C1_SKILLS);
    expect(findDeprecatedSkills(REPO_ROOT)).toEqual(expect.arrayContaining(C1_SKILLS));
  });
});
