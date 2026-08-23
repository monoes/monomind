import { describe, expect, it } from 'vitest';
import type {
  DuplicationInfo,
  UnusedExportInfo,
} from '../../../packages/@monomind/monograph/src/lsp/hover.ts';
import { buildHover } from '../../../packages/@monomind/monograph/src/lsp/hover.ts';

describe('buildHover', () => {
  it('returns null when no findings match the line', () => {
    const result = buildHover([], [], { line: 5, character: 0 }, 'test.ts');
    expect(result).toBeNull();
  });

  it('returns hover for unused export on matching line', () => {
    const exports: UnusedExportInfo[] = [
      {
        exportName: 'unusedFn',
        line: 10,
        col: 1,
        referenceCount: 0,
      },
    ];
    const result = buildHover(exports, [], { line: 9, character: 0 }, 'test.ts');
    expect(result).not.toBeNull();
    expect(result?.contents).toContain('unusedFn');
    expect(result?.contents).toContain('Unused Export');
    expect(result?.contents).toContain('0');
  });

  it('returns hover for duplication on matching line', () => {
    const dups: DuplicationInfo[] = [
      {
        line: 20,
        col: 1,
        groupSize: 3,
        instanceCount: 3,
        similarityScore: 0.92,
      },
    ];
    const result = buildHover([], dups, { line: 19, character: 0 }, 'test.ts');
    expect(result).not.toBeNull();
    expect(result?.contents).toContain('Duplication');
    expect(result?.contents).toContain('3');
    expect(result?.contents).toContain('92%');
  });

  it('prioritizes unused export over duplication on same line', () => {
    const exports: UnusedExportInfo[] = [
      {
        exportName: 'myFn',
        line: 5,
        col: 1,
        referenceCount: 2,
      },
    ];
    const dups: DuplicationInfo[] = [
      {
        line: 5,
        col: 1,
        groupSize: 2,
        instanceCount: 2,
        similarityScore: 0.8,
      },
    ];
    const result = buildHover(exports, dups, { line: 4, character: 0 }, 'test.ts');
    expect(result?.contents).toContain('Unused Export');
    expect(result?.contents).not.toContain('Duplication');
  });
});
