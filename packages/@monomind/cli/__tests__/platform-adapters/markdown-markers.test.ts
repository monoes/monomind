/**
 * Ownership markers in Markdown files were written as `# monomind:start …` /
 * `# monomind:end …` lines: a level-1 heading inside every skill body and
 * instruction file. In SKILL.md the start marker also replaced the blank line
 * after the frontmatter, and the end-marker pattern (a suffix starting with
 * `\s*`) swallowed the blank lines that followed a block.
 *
 * Markdown files now carry HTML-comment markers. The `#` form is still read,
 * so an existing file is migrated in place on the next install.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeManagedBlock,
  mergeSkillFileManagedBlock,
  mergeSkillManagedBlock,
} from '../../src/platform-adapters/merge.js';
import { installPlatform } from '../../src/platform-adapters/operations.js';

const marker = 'skills:codex:mastermind-plan';
const rendered = '---\nname: mastermind-plan\ndescription: Plan safely.\n---\n\n# Plan\n\nBody.\n';

describe('SKILL.md ownership markers', () => {
  it('are HTML comments, with the blank line after the frontmatter kept', () => {
    const { content } = mergeSkillManagedBlock('', marker, rendered);
    expect(content).toBe(
      '---\nname: mastermind-plan\ndescription: Plan safely.\n---\n\n' +
        `<!-- monomind:start ${marker} -->\n# Plan\n\nBody.\n<!-- monomind:end ${marker} -->\n`,
    );
    expect(content).not.toMatch(/^# monomind:/m);
  });

  it('migrates the old `#` form in place, restoring the blank line', () => {
    const legacy =
      '---\nname: mastermind-plan\ndescription: Plan safely.\n---\n' +
      `# monomind:start ${marker}\n# Plan\n\nOld body.\n# monomind:end ${marker}\n`;
    const { content } = mergeSkillManagedBlock(legacy, marker, rendered);
    expect(content).toBe(mergeSkillManagedBlock('', marker, rendered).content);
  });

  it('is byte-identical on a second run', () => {
    const once = mergeSkillManagedBlock('', marker, rendered).content;
    expect(mergeSkillManagedBlock(once, marker, rendered).content).toBe(once);
  });

  it('reference files use HTML-comment markers too', () => {
    const reference = '# Codex Tool Mapping\n\nText.\n';
    const merged = mergeSkillFileManagedBlock('', 'skills:agents:x', reference);
    expect(merged).toBe(
      '<!-- monomind:start skills:agents:x -->\n# Codex Tool Mapping\n\nText.\n<!-- monomind:end skills:agents:x -->\n',
    );
  });
});

describe('managed block boundaries', () => {
  it('keep the blank lines that follow a block', () => {
    const existing = '# monomind:start a:b\nold\n# monomind:end a:b\n\n\nUser text\n';
    expect(mergeManagedBlock(existing, 'a:b', 'new')).toBe(
      '# monomind:start a:b\nnew\n# monomind:end a:b\n\n\nUser text\n',
    );
  });

  it('keep the blank lines that follow an HTML-comment block', () => {
    const existing = '<!-- monomind:start a:b -->\nold\n<!-- monomind:end a:b -->\n\nUser text\n';
    expect(mergeManagedBlock(existing, 'a:b', 'new', 'html')).toBe(
      '<!-- monomind:start a:b -->\nnew\n<!-- monomind:end a:b -->\n\nUser text\n',
    );
  });
});

describe('installed Markdown artifacts', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('CLAUDE.md instructions are migrated from the `#` form to HTML comments', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mm-md-markers-'));
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      '# Project\n\n# monomind:start instructions:claude\nold\n# monomind:end instructions:claude\n\nAfter.\n',
    );
    await installPlatform({ platform: 'claude', path: dir, scope: 'project' });

    const claudeMd = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('<!-- monomind:start instructions:claude -->');
    expect(claudeMd).toContain('<!-- monomind:end instructions:claude -->\n\nAfter.\n');
    expect(claudeMd).not.toMatch(/^# monomind:/m);
    const skill = readFileSync(join(dir, '.claude', 'skills', 'mastermind', 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/\n---\n\n<!-- monomind:start skills:claude:mastermind -->\n/);
  });
});
