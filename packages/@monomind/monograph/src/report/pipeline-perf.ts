export interface PipelineTimings {
  discoverFilesMs: number;
  fileCount: number;
  workspacesMs: number;
  workspaceCount: number;
  pluginsMs: number;
  scriptAnalysisMs: number;
  parseExtractMs: number;
  moduleCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheUpdateMs: number;
  entryPointsMs: number;
  entryPointCount: number;
  resolveImportsMs: number;
  buildGraphMs: number;
  analyzeMs: number;
  duplicationMs?: number;
  totalMs: number;
}

export const ZERO_PIPELINE_TIMINGS: PipelineTimings = {
  discoverFilesMs: 0, fileCount: 0, workspacesMs: 0, workspaceCount: 0,
  pluginsMs: 0, scriptAnalysisMs: 0, parseExtractMs: 0, moduleCount: 0,
  cacheHits: 0, cacheMisses: 0, cacheUpdateMs: 0, entryPointsMs: 0,
  entryPointCount: 0, resolveImportsMs: 0, buildGraphMs: 0, analyzeMs: 0,
  totalMs: 0,
};

export function buildPipelinePerformanceLines(t: PipelineTimings): string[] {
  const cacheDetail = t.cacheHits > 0 ? `, ${t.cacheHits} cached, ${t.cacheMisses} parsed` : '';
  const fmt = (ms: number) => ms.toFixed(1).padStart(8);
  return [
    '',
    '┌─ Pipeline Performance ─────────────────────────────',
    `│  discover files:   ${fmt(t.discoverFilesMs)}ms  (${t.fileCount} files)`,
    `│  workspaces:       ${fmt(t.workspacesMs)}ms  (${t.workspaceCount} workspaces)`,
    `│  plugins:          ${fmt(t.pluginsMs)}ms`,
    `│  script analysis:  ${fmt(t.scriptAnalysisMs)}ms`,
    `│  parse/extract:    ${fmt(t.parseExtractMs)}ms  (${t.moduleCount} modules${cacheDetail})`,
    `│  cache update:     ${fmt(t.cacheUpdateMs)}ms`,
    `│  entry points:     ${fmt(t.entryPointsMs)}ms  (${t.entryPointCount} entries)`,
    `│  resolve imports:  ${fmt(t.resolveImportsMs)}ms`,
    `│  build graph:      ${fmt(t.buildGraphMs)}ms`,
    `│  analyze:          ${fmt(t.analyzeMs)}ms`,
    ...(t.duplicationMs !== undefined ? [`│  duplication:      ${fmt(t.duplicationMs)}ms`] : []),
    '│  ────────────────────────────────────────────────',
    `│  TOTAL:            ${fmt(t.totalMs)}ms`,
    '└───────────────────────────────────────────────────',
    '',
  ];
}

export function timingsSummary(t: PipelineTimings): string {
  return `${t.fileCount} files in ${t.totalMs.toFixed(0)}ms (${t.cacheHits} cache hits)`;
}
