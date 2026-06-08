import { describe, it, expect } from 'vitest';
import { stripDiacritics, normalizeSearchTerm } from '../../search/diacritic.js';
describe('stripDiacritics', () => {
    it('removes accents from French', () => {
        expect(stripDiacritics('résumé')).toBe('resume');
    });
    it('removes umlauts', () => {
        expect(stripDiacritics('über')).toBe('uber');
    });
    it('leaves ASCII unchanged', () => {
        expect(stripDiacritics('hello world')).toBe('hello world');
    });
    it('handles empty string', () => {
        expect(stripDiacritics('')).toBe('');
    });
    it('normalizeSearchTerm lowercases and strips', () => {
        expect(normalizeSearchTerm('Résumé')).toBe('resume');
    });
    it('normalizeSearchTerm trims whitespace', () => {
        expect(normalizeSearchTerm('  foo  ')).toBe('foo');
    });
});
//# sourceMappingURL=diacritic.test.js.map