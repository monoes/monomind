import { describe, it, expect } from 'vitest';
import { generateWiki } from '../../wiki/wiki-generator.js';
describe('wiki review mode', () => {
    it('WikiGeneratorOptions accepts reviewOnly flag', () => {
        const opts = {
            repoPath: '/tmp',
            reviewOnly: true,
        };
        expect(opts.reviewOnly).toBe(true);
    });
    it('generateWiki returns early with groupings when reviewOnly is true', async () => {
        const result = await generateWiki({
            repoPath: '/tmp',
            reviewOnly: true,
            db: { prepare: () => ({ all: () => [] }) },
        });
        expect(result).toHaveProperty('reviewMode', true);
        expect(result).toHaveProperty('proposedGroupings');
    });
});
//# sourceMappingURL=wiki-review-mode.test.js.map