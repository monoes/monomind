export const ANALYSIS_SCHEMA_VERSION = 4;
export const HEALTH_SCHEMA_VERSION = 2;
export const RUNTIME_COVERAGE_SCHEMA_VERSION = '1';
export const DUPLICATION_SCHEMA_VERSION = 1;

export interface SchemaEnvelope<T = unknown> {
  $schema?: string;
  schemaVersion: number;
  generatedAt: string;
  root: string;
  data: T;
}

export function makeEnvelope<T>(
  data: T,
  schemaVersion: number,
  root: string,
  schemaUrl?: string,
): SchemaEnvelope<T> {
  return {
    $schema: schemaUrl,
    schemaVersion,
    generatedAt: new Date().toISOString(),
    root,
    data,
  };
}

export function stripRootPrefix(obj: unknown, root: string): unknown {
  if (typeof obj === 'string') {
    const normalized = root.endsWith('/') ? root : root + '/';
    return obj.startsWith(normalized) ? obj.slice(normalized.length) : obj;
  }
  if (Array.isArray(obj)) return obj.map(item => stripRootPrefix(item, root));
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = stripRootPrefix(value, root);
    }
    return result;
  }
  return obj;
}

export function injectActions(
  obj: Record<string, unknown>,
  actions: Record<string, string[]>,
): Record<string, unknown> {
  return { ...obj, actions };
}

export function buildAnalysisJsonEnvelope(
  results: unknown,
  root: string,
  regression?: unknown,
): SchemaEnvelope {
  const stripped = stripRootPrefix(results, root);
  const data: Record<string, unknown> = { results: stripped };
  if (regression !== undefined) data.regression = regression;
  return makeEnvelope(data, ANALYSIS_SCHEMA_VERSION, root, `https://monograph.dev/schema/v${ANALYSIS_SCHEMA_VERSION}/analysis.json`);
}

export function buildHealthJsonEnvelope(
  healthReport: unknown,
  root: string,
): SchemaEnvelope {
  return makeEnvelope(healthReport, HEALTH_SCHEMA_VERSION, root, `https://monograph.dev/schema/v${HEALTH_SCHEMA_VERSION}/health.json`);
}

export function buildDuplicationJsonEnvelope(
  duplication: unknown,
  root: string,
): SchemaEnvelope {
  return makeEnvelope(duplication, DUPLICATION_SCHEMA_VERSION, root, `https://monograph.dev/schema/v${DUPLICATION_SCHEMA_VERSION}/duplication.json`);
}
