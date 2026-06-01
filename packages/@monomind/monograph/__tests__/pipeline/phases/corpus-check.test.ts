import { describe, it, expect } from 'vitest';
import { assessCorpus, type CorpusAssessment } from '../../../src/pipeline/phases/scan.js';

describe('assessCorpus', () => {
  it('warns when corpus is too small (< 50K estimated words)', () => {
    const result = assessCorpus({ fileCount: 3, totalBytes: 5_000 });
    expect(result.warning).toContain('too small');
    expect(result.level).toBe('info');
  });

  it('warns when corpus is too large (> 500K estimated words)', () => {
    const result = assessCorpus({ fileCount: 10, totalBytes: 4_000_000 });
    expect(result.warning).toContain('large');
    expect(result.level).toBe('warn');
  });

  it('warns when file count is high (> 200 files)', () => {
    const result = assessCorpus({ fileCount: 250, totalBytes: 2_000_000 });
    expect(result.level).toBe('warn');
  });

  it('returns ok for typical corpus', () => {
    const result = assessCorpus({ fileCount: 40, totalBytes: 400_000 });
    expect(result.level).toBe('ok');
  });
});
