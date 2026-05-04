// Schema-versioned JSON envelope builders for CLI analysis results.

export const ANALYSIS_JSON_SCHEMA_VERSION = 1;

export interface AnalysisEnvelopeOptions {
  elapsedMs?: number;
  entryCount?: number;
  schemaVersion?: number;
}

export interface AnalysisResultsEnvelope {
  schemaVersion: number;
  kind: 'analysis';
  elapsedMs: number;
  entryCount: number;
  totalIssues: number;
  results: unknown;
}

export interface HealthResultsEnvelope {
  schemaVersion: number;
  kind: 'health';
  elapsedMs: number;
  totalFindings: number;
  includesExplanations: boolean;
  results: unknown;
}

export interface DuplicationResultsEnvelope {
  schemaVersion: number;
  kind: 'duplication';
  elapsedMs: number;
  cloneGroups: number;
  includesExplanations: boolean;
  results: unknown;
}

export function buildAnalysisResultsEnvelope(
  results: unknown,
  totalIssues: number,
  opts: AnalysisEnvelopeOptions = {},
): AnalysisResultsEnvelope {
  return {
    schemaVersion: opts.schemaVersion ?? ANALYSIS_JSON_SCHEMA_VERSION,
    kind: 'analysis',
    elapsedMs: opts.elapsedMs ?? 0,
    entryCount: opts.entryCount ?? 0,
    totalIssues,
    results,
  };
}

export function buildHealthResultsEnvelope(
  results: unknown,
  totalFindings: number,
  opts: AnalysisEnvelopeOptions & { includesExplanations?: boolean } = {},
): HealthResultsEnvelope {
  return {
    schemaVersion: opts.schemaVersion ?? ANALYSIS_JSON_SCHEMA_VERSION,
    kind: 'health',
    elapsedMs: opts.elapsedMs ?? 0,
    totalFindings,
    includesExplanations: opts.includesExplanations ?? false,
    results,
  };
}

export function buildDuplicationResultsEnvelope(
  results: unknown,
  cloneGroups: number,
  opts: AnalysisEnvelopeOptions & { includesExplanations?: boolean } = {},
): DuplicationResultsEnvelope {
  return {
    schemaVersion: opts.schemaVersion ?? ANALYSIS_JSON_SCHEMA_VERSION,
    kind: 'duplication',
    elapsedMs: opts.elapsedMs ?? 0,
    cloneGroups,
    includesExplanations: opts.includesExplanations ?? false,
    results,
  };
}

export function stripRootPrefix(obj: unknown, rootPrefix: string): unknown {
  const json = JSON.stringify(obj);
  const escaped = rootPrefix.replace(/[/\\]/g, s => `\\${s}`);
  return JSON.parse(json.replace(new RegExp(escaped, 'g'), ''));
}
