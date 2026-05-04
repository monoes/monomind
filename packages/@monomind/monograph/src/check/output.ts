import type { IssueSeverity, AnalysisIssue } from './rules.js';

export type OutputFormat = 'text' | 'json' | 'compact';

export interface TraceOptions {
  traceExport?: string;
  traceFile?: string;
  traceDependency?: string;
  performance: boolean;
}

export interface SarifOutput {
  version: '2.1.0';
  $schema: string;
  runs: SarifRun[];
}

export interface SarifRun {
  tool: { driver: { name: string; version: string; rules: SarifRule[] } };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' };
}

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } } }>;
}

export function parseTraceSpec(spec: string): [string, string] | null {
  const idx = spec.lastIndexOf(':');
  if (idx <= 0) return null;
  return [spec.slice(0, idx), spec.slice(idx + 1)];
}

export function buildSarifOutput(
  issues: AnalysisIssue[],
  toolVersion: string,
): SarifOutput {
  const ruleIds = [...new Set(issues.map(i => i.kind))];
  const rules: SarifRule[] = ruleIds.map(id => ({
    id,
    shortDescription: { text: id },
    defaultConfiguration: { level: 'warning' },
  }));

  const results: SarifResult[] = issues.map(issue => ({
    ruleId: issue.kind,
    level: issue.severity === 'error' ? 'error' : issue.severity === 'warn' ? 'warning' : 'note',
    message: { text: issue.message },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: issue.filePath.replace(/\\/g, '/') },
      },
    }],
  }));

  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{ tool: { driver: { name: 'monograph', version: toolVersion, rules } }, results }],
  };
}

export function formatIssuesAsText(issues: AnalysisIssue[], quiet: boolean): string {
  if (quiet && issues.length === 0) return '';
  const lines = issues.map(i => `[${(i.severity ?? 'error').toUpperCase()}] ${i.filePath}: ${i.message}`);
  return lines.join('\n');
}

export function formatIssuesAsJson(issues: AnalysisIssue[]): string {
  return JSON.stringify({ issues }, null, 2);
}
