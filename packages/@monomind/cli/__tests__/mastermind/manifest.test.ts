import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getMastermindSkillSourceDir,
  MASTERMIND_SKILLS,
  renderSkillPackage,
  resolveMastermindSkill,
} from '../../src/mastermind/manifest.js';

function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map((match) => match[1]);
}

describe('Mastermind skill manifest', () => {
  it('covers every workflow family in the capability contract', () => {
    const names = new Set(MASTERMIND_SKILLS.map(({ name }) => name));

    for (const name of [
      'mastermind',
      'mastermind-plan',
      'mastermind-review',
      'mastermind-debug',
      'mastermind-research',
      'mastermind-execute',
      'mastermind-org',
      'mastermind-memory',
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('resolves canonical names and documented aliases', () => {
    expect(resolveMastermindSkill('mastermind-plan')?.name).toBe('mastermind-plan');
    expect(resolveMastermindSkill('plan')?.name).toBe('mastermind-plan');
    expect(resolveMastermindSkill('organization')?.name).toBe('mastermind-org');
    expect(resolveMastermindSkill('not-a-skill')).toBeUndefined();
  });

  it('renders every canonical Mastermind package with portable metadata and resolving links', () => {
    const sourceDir = getMastermindSkillSourceDir();
    expect(sourceDir).toBeTruthy();

    for (const skill of MASTERMIND_SKILLS) {
      const rendered = renderSkillPackage(skill, 'codex');
      expect(rendered).toMatch(
        new RegExp(
          `^---\\n(?=[\\s\\S]*?^name: ${skill.name}$)(?=[\\s\\S]*?^description: .+$)[\\s\\S]*?^---\\n`,
          'm',
        ),
      );
      expect(rendered).not.toContain('$CLAUDE_PROJECT_DIR');
      for (const link of relativeLinks(rendered)) {
        expect(existsSync(resolve(sourceDir!, skill.source, link))).toBe(true);
      }
    }
  });

  it('maps each manifest entry to a shipped skill package', () => {
    const sourceDir = getMastermindSkillSourceDir();
    expect(sourceDir).toBeTruthy();

    for (const skill of MASTERMIND_SKILLS) {
      expect(existsSync(resolve(sourceDir!, skill.source, 'SKILL.md'))).toBe(true);
    }
  });
});
