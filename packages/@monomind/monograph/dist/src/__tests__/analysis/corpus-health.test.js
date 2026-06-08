import { describe, it, expect } from 'vitest';
import { checkCorpusHealth } from '../../analysis/corpus-health.js';
describe('checkCorpusHealth', () => {
    it('passes for healthy corpus', () => {
        const r = checkCorpusHealth({ wordCount: 100_000, fileCount: 50 });
        expect(r.healthy).toBe(true);
        expect(r.warnings).toHaveLength(0);
    });
    it('warns when corpus too small', () => {
        const r = checkCorpusHealth({ wordCount: 10_000, fileCount: 10 });
        expect(r.healthy).toBe(false);
        expect(r.warnings.some(w => /small/i.test(w))).toBe(true);
    });
    it('warns when corpus too large', () => {
        const r = checkCorpusHealth({ wordCount: 600_000, fileCount: 100 });
        expect(r.healthy).toBe(false);
        expect(r.warnings.some(w => /large/i.test(w))).toBe(true);
    });
    it('warns when file count too high', () => {
        const r = checkCorpusHealth({ wordCount: 200_000, fileCount: 250 });
        expect(r.healthy).toBe(false);
        expect(r.warnings.some(w => /file/i.test(w))).toBe(true);
    });
    it('collects multiple warnings', () => {
        const r = checkCorpusHealth({ wordCount: 600_000, fileCount: 300 });
        expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    });
});
//# sourceMappingURL=corpus-health.test.js.map