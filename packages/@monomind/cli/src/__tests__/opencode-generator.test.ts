import { describe, expect, it } from 'vitest';
import { convertAgentMd } from '../init/opencode-generator.js';

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
    const descIdx = lines.findIndex((l) => l === 'description: |');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    // The line right after a block-scalar opener must stay part of the
    // block (indented) — never a bare top-level key line.
    expect(lines[descIdx + 1]).toBe('  Information reconnaissance specialist that explores unknown territories.');
    // mode: must land after the block content, as its own top-level key.
    expect(lines.find((l) => l.startsWith('mode:'))).toBe('mode: subagent');
  });

  it('appends mode: right after a normal single-line description', () => {
    const src = ['---', 'name: coder', 'description: Implementation specialist', '---', '', 'Body.'].join('\n');

    const out = convertAgentMd(src, 'coder');
    const fm = out.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const lines = fm.split('\n');
    const descIdx = lines.findIndex((l) => l === 'description: Implementation specialist');

    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(lines[descIdx + 1]).toBe('mode: subagent');
  });
});
