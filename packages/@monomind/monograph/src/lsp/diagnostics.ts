import type { LspRange } from './code-lens.js';

export type DiagnosticSeverity = 1 | 2 | 3 | 4;  // Error | Warning | Information | Hint
export type DiagnosticTag = 1 | 2;                // Unnecessary | Deprecated

export interface RelatedInformation {
  uri: string;
  range: LspRange;
  message: string;
}

export interface MonographDiagnostic {
  range: LspRange;
  severity: DiagnosticSeverity;
  code: string;
  source: string;
  message: string;
  tags?: DiagnosticTag[];
  relatedInformation?: RelatedInformation[];
}

export interface DuplicateExportLocation {
  uri: string;
  line: number;   // 1-based
  col: number;
  exportName: string;
}

export interface DuplicateExportGroup {
  name: string;
  locations: DuplicateExportLocation[];
}

export interface StaleSuppressionInfo {
  uri: string;
  line: number;   // 1-based
  description: string;
}

function makeRange(line: number, col: number, nameLength: number): LspRange {
  return {
    start: { line: line - 1, character: col - 1 },
    end:   { line: line - 1, character: col - 1 + nameLength },
  };
}

export function buildDuplicateExportDiagnostics(
  groups: DuplicateExportGroup[],
): Map<string, MonographDiagnostic[]> {
  const map = new Map<string, MonographDiagnostic[]>();
  for (const group of groups) {
    for (const loc of group.locations) {
      const related: RelatedInformation[] = group.locations
        .filter(other => other !== loc)
        .map(other => ({
          uri: other.uri,
          range: makeRange(other.line, other.col, group.name.length),
          message: `Also exported as '${group.name}' here`,
        }));
      const diag: MonographDiagnostic = {
        range: makeRange(loc.line, loc.col, group.name.length),
        severity: 2,  // Warning
        code: 'monograph/duplicate-export',
        source: 'monograph',
        message: `'${group.name}' is exported from ${group.locations.length} files`,
        relatedInformation: related,
      };
      const arr = map.get(loc.uri) ?? [];
      arr.push(diag);
      map.set(loc.uri, arr);
    }
  }
  return map;
}

export function buildStaleSuppressionDiagnostics(
  suppressions: StaleSuppressionInfo[],
): Map<string, MonographDiagnostic[]> {
  const map = new Map<string, MonographDiagnostic[]>();
  for (const s of suppressions) {
    const range: LspRange = {
      start: { line: s.line - 1, character: 0 },
      end:   { line: s.line - 1, character: 65535 },
    };
    const diag: MonographDiagnostic = {
      range,
      severity: 4,  // Hint
      code: 'monograph/stale-suppression',
      source: 'monograph',
      message: s.description,
      tags: [1],  // Unnecessary
    };
    const arr = map.get(s.uri) ?? [];
    arr.push(diag);
    map.set(s.uri, arr);
  }
  return map;
}
