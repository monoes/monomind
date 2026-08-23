import { describe, expect, it } from 'vitest';
import type {
  DuplicateExportGroup,
  StaleSuppressionInfo,
} from '../../../packages/@monomind/monograph/src/lsp/diagnostics.ts';
import {
  buildDuplicateExportDiagnostics,
  buildStaleSuppressionDiagnostics,
} from '../../../packages/@monomind/monograph/src/lsp/diagnostics.ts';

describe('buildDuplicateExportDiagnostics', () => {
  it('returns empty map for no groups', () => {
    expect(buildDuplicateExportDiagnostics([]).size).toBe(0);
  });

  it('creates warning diagnostics for each location in a group', () => {
    const groups: DuplicateExportGroup[] = [
      {
        name: 'Config',
        locations: [
          { uri: 'file:///a.ts', line: 5, col: 1, exportName: 'Config' },
          { uri: 'file:///b.ts', line: 10, col: 1, exportName: 'Config' },
        ],
      },
    ];
    const result = buildDuplicateExportDiagnostics(groups);
    expect(result.size).toBe(2);

    const diagsA = result.get('file:///a.ts')!;
    expect(diagsA).toHaveLength(1);
    expect(diagsA[0].severity).toBe(2);
    expect(diagsA[0].code).toBe('monograph/duplicate-export');
    expect(diagsA[0].message).toContain('Config');
    expect(diagsA[0].message).toContain('2 files');

    const diagsB = result.get('file:///b.ts')!;
    expect(diagsB).toHaveLength(1);
  });

  it('includes related information pointing to the other locations', () => {
    const groups: DuplicateExportGroup[] = [
      {
        name: 'helper',
        locations: [
          { uri: 'file:///x.ts', line: 1, col: 1, exportName: 'helper' },
          { uri: 'file:///y.ts', line: 2, col: 3, exportName: 'helper' },
          { uri: 'file:///z.ts', line: 4, col: 1, exportName: 'helper' },
        ],
      },
    ];
    const result = buildDuplicateExportDiagnostics(groups);
    const diagsX = result.get('file:///x.ts')!;
    expect(diagsX[0].relatedInformation).toHaveLength(2);
    expect(diagsX[0].relatedInformation?.[0].uri).toBe('file:///y.ts');
    expect(diagsX[0].relatedInformation?.[1].uri).toBe('file:///z.ts');
  });

  it('converts 1-based line/col to 0-based LSP range', () => {
    const groups: DuplicateExportGroup[] = [
      {
        name: 'fn',
        locations: [
          { uri: 'file:///a.ts', line: 10, col: 5, exportName: 'fn' },
          { uri: 'file:///b.ts', line: 1, col: 1, exportName: 'fn' },
        ],
      },
    ];
    const result = buildDuplicateExportDiagnostics(groups);
    const diag = result.get('file:///a.ts')?.[0];
    expect(diag.range.start.line).toBe(9);
    expect(diag.range.start.character).toBe(4);
    expect(diag.range.end.character).toBe(4 + 'fn'.length);
  });
});

describe('buildStaleSuppressionDiagnostics', () => {
  it('returns empty map for no suppressions', () => {
    expect(buildStaleSuppressionDiagnostics([]).size).toBe(0);
  });

  it('creates hint diagnostics with Unnecessary tag', () => {
    const suppressions: StaleSuppressionInfo[] = [
      {
        uri: 'file:///test.ts',
        line: 15,
        description: 'monograph-ignore for export that no longer exists',
      },
    ];
    const result = buildStaleSuppressionDiagnostics(suppressions);
    expect(result.size).toBe(1);
    const diags = result.get('file:///test.ts')!;
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(4);
    expect(diags[0].code).toBe('monograph/stale-suppression');
    expect(diags[0].tags).toContain(1);
    expect(diags[0].range.start.line).toBe(14);
  });

  it('groups multiple suppressions by URI', () => {
    const suppressions: StaleSuppressionInfo[] = [
      { uri: 'file:///a.ts', line: 1, description: 'stale 1' },
      { uri: 'file:///a.ts', line: 5, description: 'stale 2' },
      { uri: 'file:///b.ts', line: 3, description: 'stale 3' },
    ];
    const result = buildStaleSuppressionDiagnostics(suppressions);
    expect(result.get('file:///a.ts')).toHaveLength(2);
    expect(result.get('file:///b.ts')).toHaveLength(1);
  });
});
