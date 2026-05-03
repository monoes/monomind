export interface JSONSchemaProperty {
  type?: string | string[];
  description?: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  additionalProperties?: boolean | JSONSchemaProperty;
  required?: string[];
  '$ref'?: string;
}

export interface JSONSchema {
  '$schema': string;
  '$id': string;
  title: string;
  description: string;
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  additionalProperties: boolean;
}

export function generateConfigSchema(): JSONSchema {
  return {
    '$schema': 'http://json-schema.org/draft-07/schema#',
    '$id': 'https://monograph.dev/config.schema.json',
    title: 'Monograph Configuration',
    description: 'Configuration file for @monoes/monograph code intelligence',
    type: 'object',
    additionalProperties: false,
    properties: {
      entryPoints: {
        type: 'array', items: { type: 'string' },
        description: 'Glob patterns for project entry point files',
      },
      include: {
        type: 'array', items: { type: 'string' },
        description: 'Glob patterns to include in analysis',
      },
      exclude: {
        type: 'array', items: { type: 'string' },
        description: 'Glob patterns to exclude from analysis',
      },
      ignorePatterns: {
        type: 'array', items: { type: 'string' },
        description: 'Additional ignore patterns (alongside .gitignore)',
      },
      sealed: {
        type: 'boolean', default: false,
        description: 'When true, child workspace configs cannot override root settings',
      },
      includeEntryExports: {
        type: 'boolean', default: false,
        description: 'Report unused exports in entry point files (catches framework typos)',
      },
      failOnError: {
        type: 'boolean', default: false,
        description: 'Exit with non-zero status when any errors are found',
      },
      outputFormat: {
        type: 'string', enum: ['json', 'sarif', 'codeclimate', 'compact', 'markdown'],
        description: 'Default output format',
      },
      boundaries: {
        type: 'object',
        additionalProperties: { type: 'array', items: { type: 'string' } },
        description: 'Zone-to-allowed-zones mapping for architectural boundary enforcement',
      },
      regression: {
        type: 'object', additionalProperties: false,
        properties: {
          baseline: { type: 'object', additionalProperties: { type: 'number' } },
          tolerance: { type: 'string', description: 'e.g. "5" (absolute) or "2%" (percentage)' },
          failOnRegression: { type: 'boolean', default: false },
        },
        description: 'Regression detection against a saved baseline',
      },
      health: {
        type: 'object', additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', default: true },
          minScore: { type: 'number', minimum: 0, maximum: 100, description: 'CI gate: fail when score < minScore' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
          suggestInlineSuppression: { type: 'boolean', default: true },
          ownership: {
            type: 'object', additionalProperties: false,
            properties: {
              emailMode: { type: 'string', enum: ['raw', 'handle', 'hash'], default: 'handle' },
              botPatterns: {
                type: 'array', items: { type: 'string' },
                default: ['*[bot]*', 'dependabot*', 'renovate*', 'github-actions*', 'svc-*'],
                description: 'Glob patterns to exclude from ownership metrics',
              },
            },
          },
        },
      },
      flags: {
        type: 'object', additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', default: false },
          envPrefixes: { type: 'array', items: { type: 'string' } },
          sdkPatterns: { type: 'array', items: { type: 'string' } },
        },
        description: 'Feature flag detection configuration',
      },
    },
  };
}

export function schemaToJson(schema: JSONSchema): string {
  return JSON.stringify(schema, null, 2);
}
