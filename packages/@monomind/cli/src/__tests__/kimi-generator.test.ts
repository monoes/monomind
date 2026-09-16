import { describe, expect, it } from 'vitest';
import {
  convertKimiAgentMd,
  convertKimiCommandToFlowSkill,
  kimiCommandFilename,
} from '../init/kimi-generator.js';

describe('convertKimiAgentMd (regression: key inserted inside a block-literal description)', () => {
  it('does not insert name: between "description: |" and its indented content', () => {
    // convertKimiAgentMd only ensures `name` and `description` (kimi has no
    // mode field), via setFmKey -> ensureFmKey. When a source agent file has
    // no `name:` but a block-literal `description: |`, ensureFmKey falls
    // back to inserting `name:` right after description's line — landing
    // inside the block scalar. Same root cause as the opencode-generator.ts
    // corruption found in .claude/agents/*.md.
    const src = [
      '---',
      'description: |',
      '  Information reconnaissance specialist that explores unknown territories.',
      '---',
      '',
      'Body text.',
    ].join('\n');

    const out = convertKimiAgentMd(src, 'scout-explorer');
    const fm = out.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const lines = fm.split('\n');
    const descIdx = lines.findIndex((l) => l === 'description: |');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(lines[descIdx + 1]).toBe(
      '  Information reconnaissance specialist that explores unknown territories.',
    );
    expect(lines.find((l) => l.startsWith('name:'))).toBe('name: scout-explorer');
  });

  it('appends name: right after a normal single-line description', () => {
    const src = ['---', 'description: Implementation specialist', '---', '', 'Body.'].join('\n');

    const out = convertKimiAgentMd(src, 'coder');
    const fm = out.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const lines = fm.split('\n');
    const descIdx = lines.findIndex((l) => l === 'description: Implementation specialist');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(lines[descIdx + 1]).toBe('name: coder');
  });
});

describe('kimiCommandFilename / convertKimiCommandToFlowSkill (regression: prefix compounding on repeat --force init)', () => {
  // write-kimicode.ts derives `category` from the source file's own path
  // inside .claude/commands/: a subdirectory name if nested, else the
  // literal string 'monomind' for a flat file. On a project whose
  // .claude/commands/ already contains a flat, previously-namespaced file
  // (from an older generator version, or simply a second --force run before
  // this fix), `fileBase` IS that already-prefixed name — reproduced here
  // directly with category='monomind' (the flat-file default) and a
  // fileBase that already starts with "monomind-", exactly as observed live:
  // "monomind-truth-start" -> "monomind-monomind-truth-start" -> ...

  it('does not stack another "monomind-" prefix onto an already-namespaced filename', () => {
    expect(kimiCommandFilename('monomind', 'monomind-truth-start')).toBe('monomind-truth-start.md');
  });

  it('still adds the prefix normally for a genuinely unprefixed filename', () => {
    expect(kimiCommandFilename('monomind', 'truth-start')).toBe('monomind-truth-start.md');
  });

  it('leaves a real, non-default category alone even when the base name starts with it', () => {
    // 'github-modes' under a nested `github/` source directory is a legitimate
    // name, not an instance of the default-category compounding bug — only
    // the literal 'monomind' default category is guarded against restacking.
    expect(kimiCommandFilename('github', 'github-modes')).toBe('github-github-modes.md');
  });

  it('does not stack the prefix in the flow-skill name: field either', () => {
    const src = ['---', 'description: Truth start command', '---', '', 'Body.'].join('\n');
    const out = convertKimiCommandToFlowSkill(src, 'monomind', 'monomind-truth-start');
    const fm = out.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(fm).toContain('name: monomind-truth-start');
    expect(fm).not.toContain('name: monomind-monomind-truth-start');
  });
});
