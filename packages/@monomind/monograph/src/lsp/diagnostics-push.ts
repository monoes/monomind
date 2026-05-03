// Granular LSP diagnostic push-functions for each finding category.

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LspDiagnosticEntry {
  filePath: string;
  range: LspRange;
  message: string;
  severity: DiagnosticSeverity;
  code: string;
  source: string;
}

export type DiagnosticMap = Map<string, LspDiagnosticEntry[]>;

function singleLineDiag(
  map: DiagnosticMap,
  filePath: string,
  line: number,
  message: string,
  code: string,
  severity: DiagnosticSeverity = 'warning',
): void {
  if (!map.has(filePath)) map.set(filePath, []);
  map.get(filePath)!.push({
    filePath,
    range: { start: { line, character: 0 }, end: { line, character: 9999 } },
    message,
    severity,
    code,
    source: 'monograph',
  });
}

export interface UnusedExportFinding { filePath: string; line: number; symbol: string }
export interface UnusedFileFinding { filePath: string }
export interface UnresolvedImportFinding { filePath: string; line: number; specifier: string }
export interface UnusedDepFinding { name: string; kind: 'unused' | 'unlisted' }
export interface UnusedMemberFinding { filePath: string; line: number; className: string; member: string }
export interface CircularDepFinding { files: string[] }
export interface BoundaryViolFinding { fromFile: string; toFile: string; line: number; rule: string }
export interface DupeExportFinding { filePath: string; line: number; symbol: string }
export interface DuplicationFinding { filePath: string; startLine: number; endLine: number; groupId: number }
export interface StaleSuppressionFinding { filePath: string; line: number; code: string }

export function pushExportDiagnostics(map: DiagnosticMap, results: UnusedExportFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, r.line, `Unused export '${r.symbol}'`, 'unused-export');
}

export function pushFileDiagnostics(map: DiagnosticMap, results: UnusedFileFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, 0, 'File has no consumers and may be dead code', 'unused-file');
}

export function pushImportDiagnostics(map: DiagnosticMap, results: UnresolvedImportFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, r.line, `Cannot resolve import '${r.specifier}'`, 'unresolved-import', 'error');
}

export function pushDepDiagnostics(map: DiagnosticMap, results: UnusedDepFinding[]): void {
  const msg = (r: UnusedDepFinding) =>
    r.kind === 'unused' ? `Package '${r.name}' is listed but not imported` : `Package '${r.name}' is imported but not in dependencies`;
  for (const r of results)
    singleLineDiag(map, 'package.json', 0, msg(r), r.kind === 'unused' ? 'unused-dep' : 'unlisted-dep');
}

export function pushMemberDiagnostics(map: DiagnosticMap, results: UnusedMemberFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, r.line, `Unused member '${r.className}.${r.member}'`, 'unused-member');
}

export function pushCircularDepDiagnostics(map: DiagnosticMap, results: CircularDepFinding[]): void {
  for (const r of results) {
    const first = r.files[0];
    if (first) singleLineDiag(map, first, 0, `Circular dependency involving ${r.files.length} files`, 'circular-dep', 'warning');
  }
}

export function pushBoundaryViolationDiagnostics(map: DiagnosticMap, results: BoundaryViolFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.fromFile, r.line, `Boundary violation: imports from restricted zone (rule: ${r.rule})`, 'boundary-violation', 'error');
}

export function pushDuplicateExportDiagnostics(map: DiagnosticMap, results: DupeExportFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, r.line, `Duplicate export '${r.symbol}' — exported from multiple files`, 'duplicate-export');
}

export function pushDuplicationDiagnostics(map: DiagnosticMap, results: DuplicationFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, r.startLine, `Code duplication (group ${r.groupId}, lines ${r.startLine}-${r.endLine})`, 'duplication', 'information');
}

export function pushStaleSuppressionDiagnostics(map: DiagnosticMap, results: StaleSuppressionFinding[]): void {
  for (const r of results)
    singleLineDiag(map, r.filePath, r.line, `Stale suppression comment for '${r.code}' — no matching finding`, 'stale-suppression', 'hint');
}
