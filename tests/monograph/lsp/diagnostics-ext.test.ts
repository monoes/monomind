import { describe, it, expect } from 'vitest';
import {
  buildUnusedSymbolDiagnostics,
  buildCircularDepDiagnostics,
  buildBoundaryViolationDiagnostics,
  buildComplexityDiagnostics,
} from '../../../packages/@monomind/monograph/src/lsp/diagnostics-ext.ts';
import type {
  UnusedSymbolLocation,
  CircularDepLocation,
  BoundaryViolationLocation,
  ComplexityIssueLocation,
} from '../../../packages/@monomind/monograph/src/lsp/diagnostics-ext.ts';

describe('buildUnusedSymbolDiagnostics', () => {
  it('returns empty map for no symbols', () => {
    expect(buildUnusedSymbolDiagnostics([]).size).toBe(0);
  });

  it('creates warning with Unnecessary tag for unused export', () => {
    const symbols: UnusedSymbolLocation[] = [{
      uri: 'file:///test.ts', line: 5, col: 1,
      name: 'deadCode', symbolKind: 'export',
    }];
    const result = buildUnusedSymbolDiagnostics(symbols);
    const diags = result.get('file:///test.ts')!;
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(2);
    expect(diags[0].code).toBe('monograph/unused-export');
    expect(diags[0].tags).toContain(1);
    expect(diags[0].message).toContain('deadCode');
    expect(diags[0].message).toContain('no external consumers');
  });

  it('uses kind-specific messages', () => {
    const kinds: UnusedSymbolLocation['symbolKind'][] = ['export', 'type', 'member', 'file'];
    for (const kind of kinds) {
      const syms: UnusedSymbolLocation[] = [{
        uri: 'file:///test.ts', line: 1, col: 1, name: 'X', symbolKind: kind,
      }];
      const diags = [...buildUnusedSymbolDiagnostics(syms).values()].flat();
      expect(diags[0].code).toBe(`monograph/unused-${kind}`);
    }
  });

  it('converts 1-based coords to 0-based LSP range', () => {
    const symbols: UnusedSymbolLocation[] = [{
      uri: 'file:///test.ts', line: 10, col: 5,
      name: 'abc', symbolKind: 'export',
    }];
    const diag = [...buildUnusedSymbolDiagnostics(symbols).values()].flat()[0];
    expect(diag.range.start.line).toBe(9);
    expect(diag.range.start.character).toBe(4);
    expect(diag.range.end.character).toBe(4 + 3);
  });
});

describe('buildCircularDepDiagnostics', () => {
  it('returns empty map for no cycles', () => {
    expect(buildCircularDepDiagnostics([]).size).toBe(0);
  });

  it('creates warning showing cycle path', () => {
    const cycles: CircularDepLocation[] = [{
      uri: 'file:///a.ts', importLine: 3,
      cycle: ['a.ts', 'b.ts', 'c.ts', 'a.ts'],
    }];
    const result = buildCircularDepDiagnostics(cycles);
    const diag = result.get('file:///a.ts')![0];
    expect(diag.severity).toBe(2);
    expect(diag.code).toBe('monograph/circular-dep');
    expect(diag.message).toContain('a.ts');
    expect(diag.message).toContain('→');
    expect(diag.range.start.line).toBe(2);
  });
});

describe('buildBoundaryViolationDiagnostics', () => {
  it('returns empty map for no violations', () => {
    expect(buildBoundaryViolationDiagnostics([]).size).toBe(0);
  });

  it('creates error-level diagnostic', () => {
    const violations: BoundaryViolationLocation[] = [{
      uri: 'file:///ui/page.ts', line: 5,
      fromZone: 'ui', toZone: 'infra',
      importedPath: '../infra/db.ts',
    }];
    const result = buildBoundaryViolationDiagnostics(violations);
    const diag = result.get('file:///ui/page.ts')![0];
    expect(diag.severity).toBe(1);
    expect(diag.code).toBe('monograph/boundary-violation');
    expect(diag.message).toContain('ui');
    expect(diag.message).toContain('infra');
    expect(diag.message).toContain('../infra/db.ts');
  });
});

describe('buildComplexityDiagnostics', () => {
  it('returns empty map for no issues', () => {
    expect(buildComplexityDiagnostics([]).size).toBe(0);
  });

  it('maps severity levels to LSP severity', () => {
    const severities: Array<{ input: ComplexityIssueLocation['severity']; expected: number }> = [
      { input: 'moderate', expected: 3 },
      { input: 'high', expected: 2 },
      { input: 'critical', expected: 1 },
    ];
    for (const { input, expected } of severities) {
      const issues: ComplexityIssueLocation[] = [{
        uri: 'file:///test.ts', line: 1, functionName: 'fn',
        cyclomaticComplexity: 20, severity: input,
      }];
      const diag = [...buildComplexityDiagnostics(issues).values()].flat()[0];
      expect(diag.severity).toBe(expected);
      expect(diag.code).toBe(`monograph/complexity-${input}`);
    }
  });

  it('includes CC and optional cognitive/CRAP scores', () => {
    const issues: ComplexityIssueLocation[] = [{
      uri: 'file:///test.ts', line: 10, functionName: 'processData',
      cyclomaticComplexity: 25, cognitiveComplexity: 30, crapScore: 45.6,
      severity: 'critical',
    }];
    const diag = [...buildComplexityDiagnostics(issues).values()].flat()[0];
    expect(diag.message).toContain('CC=25');
    expect(diag.message).toContain('cognitive=30');
    expect(diag.message).toContain('CRAP=45.6');
    expect(diag.message).toContain('processData');
  });

  it('omits cognitive/CRAP when not provided', () => {
    const issues: ComplexityIssueLocation[] = [{
      uri: 'file:///test.ts', line: 1, functionName: 'simple',
      cyclomaticComplexity: 12, severity: 'moderate',
    }];
    const diag = [...buildComplexityDiagnostics(issues).values()].flat()[0];
    expect(diag.message).toContain('CC=12');
    expect(diag.message).not.toContain('cognitive');
    expect(diag.message).not.toContain('CRAP');
  });
});
