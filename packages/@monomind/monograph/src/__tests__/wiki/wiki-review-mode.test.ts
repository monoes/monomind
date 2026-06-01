import { describe, it, expect } from 'vitest';
import { generateWiki, type WikiGeneratorOptions } from '../../wiki/wiki-generator.js';

describe('wiki review mode', () => {
  it('WikiGeneratorOptions accepts reviewOnly flag', () => {
    const opts: WikiGeneratorOptions = {
      repoPath: '/tmp',
      reviewOnly: true,
    };
    expect(opts.reviewOnly).toBe(true);
  });

  it('generateWiki returns early with groupings when reviewOnly is true', async () => {
    const result = await generateWiki({
      repoPath: '/tmp',
      reviewOnly: true,
      db: { prepare: () => ({ all: () => [] }) } as any,
    });
    expect(result).toHaveProperty('reviewMode', true);
    expect(result).toHaveProperty('proposedGroupings');
  });
});
