import type { LspRange } from './code-lens.js';
import type { MonographDiagnostic } from './diagnostics.js';

// ── Unused-symbol diagnostics ────────────────────────────────────────────────

export interface UnusedSymbolLocation {
  uri: string;
  line: number;         // 1-based
  col: number;
  name: string;
  symbolKind: 'export' | 'type' | 'member' | 'file';
}

export function buildUnusedSymbolDiagnostics(
  symbols: UnusedSymbolLocation[],
): Map<string, MonographDiagnostic[]> {
  const map = new Map<string, MonographDiagnostic[]>();
  for (const sym of symbols) {
    const range: LspRange = {
      start: { line: sym.line - 1, character: sym.col - 1 },
      end:   { line: sym.line - 1, character: sym.col - 1 + sym.name.length },
    };
    const messages: Record<UnusedSymbolLocation['symbolKind'], string> = {
      export: `'${sym.name}' is exported but has no external consumers`,
      type: `Type '${sym.name}' is exported but never imported elsewhere`,
      member: `Class member '${sym.name}' is never used outside this class`,
      file: `File '${sym.name}' has no importers and no entry-point role`,
    };
    const diag: MonographDiagnostic = {
      range,
      severity: 2,   // Warning
      code: `monograph/unused-${sym.symbolKind}`,
      source: 'monograph',
      message: messages[sym.symbolKind],
      tags: [1],     // Unnecessary
    };
    const arr = map.get(sym.uri) ?? [];
    arr.push(diag);
    map.set(sym.uri, arr);
  }
  return map;
}

// ── Structural diagnostics ────────────────────────────────────────────────────

export interface CircularDepLocation {
  uri: string;
  importLine: number;   // 1-based, the import that closes the cycle
  cycle: string[];      // module names in cycle
}

export interface BoundaryViolationLocation {
  uri: string;
  line: number;
  fromZone: string;
  toZone: string;
  importedPath: string;
}

export function buildCircularDepDiagnostics(
  cycles: CircularDepLocation[],
): Map<string, MonographDiagnostic[]> {
  const map = new Map<string, MonographDiagnostic[]>();
  for (const cycle of cycles) {
    const line0 = cycle.importLine - 1;
    const range: LspRange = {
      start: { line: line0, character: 0 },
      end:   { line: line0, character: 65535 },
    };
    const diag: MonographDiagnostic = {
      range,
      severity: 2,   // Warning
      code: 'monograph/circular-dep',
      source: 'monograph',
      message: `Circular dependency: ${cycle.cycle.join(' → ')}`,
    };
    const arr = map.get(cycle.uri) ?? [];
    arr.push(diag);
    map.set(cycle.uri, arr);
  }
  return map;
}

export function buildBoundaryViolationDiagnostics(
  violations: BoundaryViolationLocation[],
): Map<string, MonographDiagnostic[]> {
  const map = new Map<string, MonographDiagnostic[]>();
  for (const v of violations) {
    const line0 = v.line - 1;
    const range: LspRange = {
      start: { line: line0, character: 0 },
      end:   { line: line0, character: 65535 },
    };
    const diag: MonographDiagnostic = {
      range,
      severity: 1,   // Error
      code: 'monograph/boundary-violation',
      source: 'monograph',
      message: `Boundary violation: zone '${v.fromZone}' cannot import from zone '${v.toZone}' (${v.importedPath})`,
    };
    const arr = map.get(v.uri) ?? [];
    arr.push(diag);
    map.set(v.uri, arr);
  }
  return map;
}

// ── Quality diagnostics ───────────────────────────────────────────────────────

export interface ComplexityIssueLocation {
  uri: string;
  line: number;         // 1-based
  functionName: string;
  cyclomaticComplexity: number;
  cognitiveComplexity?: number;
  crapScore?: number;
  severity: 'moderate' | 'high' | 'critical';
}

export function buildComplexityDiagnostics(
  issues: ComplexityIssueLocation[],
): Map<string, MonographDiagnostic[]> {
  const map = new Map<string, MonographDiagnostic[]>();
  for (const issue of issues) {
    const line0 = issue.line - 1;
    const range: LspRange = {
      start: { line: line0, character: 0 },
      end:   { line: line0, character: issue.functionName.length },
    };
    const lspSeverity: Record<ComplexityIssueLocation['severity'], 1 | 2 | 3> = {
      moderate: 3,   // Information
      high: 2,       // Warning
      critical: 1,   // Error
    };
    const parts = [`CC=${issue.cyclomaticComplexity}`];
    if (issue.cognitiveComplexity != null) parts.push(`cognitive=${issue.cognitiveComplexity}`);
    if (issue.crapScore != null) parts.push(`CRAP=${issue.crapScore.toFixed(1)}`);
    const diag: MonographDiagnostic = {
      range,
      severity: lspSeverity[issue.severity],
      code: `monograph/complexity-${issue.severity}`,
      source: 'monograph',
      message: `'${issue.functionName}' has ${issue.severity} complexity (${parts.join(', ')})`,
    };
    const arr = map.get(issue.uri) ?? [];
    arr.push(diag);
    map.set(issue.uri, arr);
  }
  return map;
}
