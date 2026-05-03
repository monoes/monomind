import { readFileSync, existsSync } from 'fs';

export interface ValidationError {
  field: string;
  message: string;
  line?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  'entryPoints', 'include', 'exclude', 'ignorePatterns', 'boundaries', 'workspaces',
  'regression', 'health', 'flags', 'coverage', 'suppressions',
  'outputFormat', 'maxIssues', 'failOnError', 'sealed', 'includeEntryExports',
]);

const KNOWN_HEALTH_FIELDS = new Set([
  'enabled', 'minScore', 'effort', 'ownership', 'suggestInlineSuppression',
]);

const KNOWN_REGRESSION_FIELDS = new Set([
  'baseline', 'tolerance', 'failOnRegression',
]);

function stripJsonComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function validateBoundaries(boundaries: unknown, errors: ValidationError[]): void {
  if (!boundaries || typeof boundaries !== 'object' || Array.isArray(boundaries)) {
    errors.push({ field: 'boundaries', message: 'must be an object mapping zone names to arrays of allowed zones' });
    return;
  }
  for (const [zone, allowed] of Object.entries(boundaries as Record<string, unknown>)) {
    if (!Array.isArray(allowed) || !allowed.every(v => typeof v === 'string')) {
      errors.push({ field: `boundaries.${zone}`, message: 'must be an array of zone name strings' });
    }
  }
}

export function validateConfig(configPath: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!existsSync(configPath)) {
    return { valid: false, errors: [{ field: '', message: `Config file not found: ${configPath}` }], warnings };
  }

  let raw: string;
  try { raw = readFileSync(configPath, 'utf8'); }
  catch (err) { return { valid: false, errors: [{ field: '', message: `Cannot read file: ${err}` }], warnings }; }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (err) {
    return { valid: false, errors: [{ field: '', message: `JSON parse error: ${err}` }], warnings };
  }

  // Unknown top-level fields
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
      warnings.push({ field: key, message: `Unknown field '${key}' — will be ignored` });
    }
  }

  // entryPoints
  if ('entryPoints' in parsed) {
    const ep = parsed['entryPoints'];
    if (!Array.isArray(ep) || !ep.every(v => typeof v === 'string')) {
      errors.push({ field: 'entryPoints', message: 'must be an array of glob strings' });
    }
  }

  // boundaries
  if ('boundaries' in parsed) validateBoundaries(parsed['boundaries'], errors);

  // health sub-config
  if ('health' in parsed && parsed['health'] && typeof parsed['health'] === 'object') {
    for (const key of Object.keys(parsed['health'] as object)) {
      if (!KNOWN_HEALTH_FIELDS.has(key)) {
        warnings.push({ field: `health.${key}`, message: `Unknown health field '${key}'` });
      }
    }
    const health = parsed['health'] as Record<string, unknown>;
    if ('minScore' in health && (typeof health['minScore'] !== 'number' || health['minScore'] < 0 || health['minScore'] > 100)) {
      errors.push({ field: 'health.minScore', message: 'must be a number between 0 and 100' });
    }
    if ('effort' in health && !['low', 'medium', 'high'].includes(health['effort'] as string)) {
      errors.push({ field: 'health.effort', message: 'must be one of: low, medium, high' });
    }
  }

  // regression sub-config
  if ('regression' in parsed && parsed['regression'] && typeof parsed['regression'] === 'object') {
    for (const key of Object.keys(parsed['regression'] as object)) {
      if (!KNOWN_REGRESSION_FIELDS.has(key)) {
        warnings.push({ field: `regression.${key}`, message: `Unknown regression field '${key}'` });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
