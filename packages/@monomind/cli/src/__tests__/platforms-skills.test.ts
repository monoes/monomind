import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installMastermindSkills } from '../commands/platforms.js';

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('mastermind skill installation', () => {
  it('adds Codex-required frontmatter and repairs legacy installed skills', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'mastermind-source-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'mastermind-target-'));
    temporaryDirs.push(sourceDir, targetDir);
    writeFileSync(join(sourceDir, 'debug.md'), '# Debug\n');

    const legacyDir = join(targetDir, 'mastermind-debug');
    const legacySkill = join(legacyDir, 'SKILL.md');
    mkdirSync(legacyDir);
    writeFileSync(legacySkill, '# Debug\n');

    installMastermindSkills(targetDir, sourceDir);

    expect(existsSync(legacySkill)).toBe(true);
    expect(readFileSync(legacySkill, 'utf8')).toBe(
      '---\nname: mastermind-debug\ndescription: "Mastermind debug workflow."\n---\n\n# Debug\n',
    );
  });
});
