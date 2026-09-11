import { describe, expect, it } from 'vitest';
import { convertKimiAgentMd } from '../init/kimi-generator.js';

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
    expect(lines[descIdx + 1]).toBe('  Information reconnaissance specialist that explores unknown territories.');
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
