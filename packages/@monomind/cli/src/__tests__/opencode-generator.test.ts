import { describe, expect, it } from 'vitest';
import { convertAgentMd, opencodeCommandFilename } from '../init/opencode-generator.js';

describe('convertAgentMd (regression: mode: inserted inside a block-literal description)', () => {
  it('does not insert mode: between "description: |" and its indented content', () => {
    // Reproduces the real corruption found in .claude/agents/*.md: ensureFmKey
    // used to insert the new key right after the description line's EOL,
    // which lands *inside* a YAML block scalar when description uses `|`.
    const src = [
      '---',
      'name: scout-explorer',
      'description: |',
      '  Information reconnaissance specialist that explores unknown territories.',
      '---',
      '',
      'Body text.',
    ].join('\n');

    const out = convertAgentMd(src, 'scout-explorer');
    const fm = out.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const lines = fm.split('\n');
    const descIdx = lines.indexOf('description: |');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    // The line right after a block-scalar opener must stay part of the
    // block (indented) — never a bare top-level key line.
    expect(lines[descIdx + 1]).toBe(
      '  Information reconnaissance specialist that explores unknown territories.',
    );
    // mode: must land after the block content, as its own top-level key.
    expect(lines.find((l) => l.startsWith('mode:'))).toBe('mode: subagent');
  });

  it('appends mode: right after a normal single-line description', () => {
    const src = [
      '---',
      'name: coder',
      'description: Implementation specialist',
      '---',
      '',
      'Body.',
    ].join('\n');

    const out = convertAgentMd(src, 'coder');
    const fm = out.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const lines = fm.split('\n');
    const descIdx = lines.indexOf('description: Implementation specialist');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(lines[descIdx + 1]).toBe('mode: subagent');
  });
});

describe('opencodeCommandFilename (regression: prefix compounding on repeat --force init)', () => {
  // Same root cause as kimi-generator.ts's namespacedSlug: write-opencode.ts
  // defaults category to 'monomind' for any flat (non-nested) source command,
  // and re-running --force init against a project whose .claude/commands/
  // already contains a flat, previously-namespaced file stacked another
  // "monomind-" prefix on top every single run.

  it('does not stack another "monomind-" prefix onto an already-namespaced filename', () => {
    expect(opencodeCommandFilename('monomind', 'monomind-truth-start')).toBe(
      'monomind-truth-start.md',
    );
  });

  it('still adds the prefix normally for a genuinely unprefixed filename', () => {
    expect(opencodeCommandFilename('monomind', 'truth-start')).toBe('monomind-truth-start.md');
  });

  it('leaves a real, non-default category alone even when the base name starts with it', () => {
    // 'github-modes' under a nested `github/` source directory is a legitimate
    // name, not an instance of the default-category compounding bug — only
    // the literal 'monomind' default category is guarded against restacking.
    expect(opencodeCommandFilename('github', 'github-modes')).toBe('github-github-modes.md');
  });
});
