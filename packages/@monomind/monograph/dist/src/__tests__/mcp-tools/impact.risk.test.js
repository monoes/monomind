import { describe, it, expect } from 'vitest';
import { computeRiskLevel } from '../../mcp-tools/impact.js';
describe('computeRiskLevel', () => {
    it('returns CRITICAL for score > 0.75', () => {
        expect(computeRiskLevel(0.9)).toBe('CRITICAL');
        expect(computeRiskLevel(1.0)).toBe('CRITICAL');
    });
    it('returns HIGH for score 0.5-0.75', () => {
        expect(computeRiskLevel(0.6)).toBe('HIGH');
        expect(computeRiskLevel(0.75)).toBe('HIGH');
    });
    it('returns MEDIUM for score 0.25-0.5', () => {
        expect(computeRiskLevel(0.3)).toBe('MEDIUM');
        expect(computeRiskLevel(0.5)).toBe('MEDIUM');
    });
    it('returns LOW for score < 0.25', () => {
        expect(computeRiskLevel(0)).toBe('LOW');
        expect(computeRiskLevel(0.24)).toBe('LOW');
    });
});
//# sourceMappingURL=impact.risk.test.js.map