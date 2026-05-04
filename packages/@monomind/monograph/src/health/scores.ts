export type CoverageTier = 'none' | 'partial' | 'high';

export const HIGH_COVERAGE_WATERMARK = 70.0;

export function coverageTierFromPct(pct: number): CoverageTier {
  if (pct <= 0) return 'none';
  if (pct >= HIGH_COVERAGE_WATERMARK) return 'high';
  return 'partial';
}

export type ExceededThreshold =
  | 'cyclomatic' | 'cognitive' | 'both' | 'crap'
  | 'cyclomatic_crap' | 'cognitive_crap' | 'all';

export function exceededThresholdFromBools(cyclomatic: boolean, cognitive: boolean, crap: boolean): ExceededThreshold {
  if (cyclomatic && cognitive && crap) return 'all';
  if (cyclomatic && cognitive) return 'both';
  if (cyclomatic && crap) return 'cyclomatic_crap';
  if (cognitive && crap) return 'cognitive_crap';
  if (cyclomatic) return 'cyclomatic';
  if (cognitive) return 'cognitive';
  if (crap) return 'crap';
  throw new Error('at least one threshold must be exceeded');
}

export function includesCyclomatic(t: ExceededThreshold): boolean {
  return (['cyclomatic','both','cyclomatic_crap','all'] as ExceededThreshold[]).includes(t);
}

export function includesCognitive(t: ExceededThreshold): boolean {
  return (['cognitive','both','cognitive_crap','all'] as ExceededThreshold[]).includes(t);
}

export function includesCrap(t: ExceededThreshold): boolean {
  return (['crap','cyclomatic_crap','cognitive_crap','all'] as ExceededThreshold[]).includes(t);
}

export type FindingSeverity = 'moderate' | 'high' | 'critical';

export const DEFAULT_CRAP_HIGH = 50.0;
export const DEFAULT_CRAP_CRITICAL = 100.0;
export const DEFAULT_COGNITIVE_HIGH = 25;
export const DEFAULT_COGNITIVE_CRITICAL = 40;
export const DEFAULT_CYCLOMATIC_HIGH = 30;
export const DEFAULT_CYCLOMATIC_CRITICAL = 50;

export interface FindingSeverityOpts {
  cognitive: number;
  cyclomatic: number;
  crap?: number;
  cognitiveHigh?: number;
  cognitiveCritical?: number;
  cyclomaticHigh?: number;
  cyclomaticCritical?: number;
}

export function computeFindingSeverity(opts: FindingSeverityOpts): FindingSeverity {
  const {
    cognitive, cyclomatic, crap,
    cognitiveHigh = DEFAULT_COGNITIVE_HIGH,
    cognitiveCritical = DEFAULT_COGNITIVE_CRITICAL,
    cyclomaticHigh = DEFAULT_CYCLOMATIC_HIGH,
    cyclomaticCritical = DEFAULT_CYCLOMATIC_CRITICAL,
  } = opts;

  const cogSev: FindingSeverity = cognitive >= cognitiveCritical ? 'critical' : cognitive >= cognitiveHigh ? 'high' : 'moderate';
  const cycSev: FindingSeverity = cyclomatic >= cyclomaticCritical ? 'critical' : cyclomatic >= cyclomaticHigh ? 'high' : 'moderate';
  const crapSev: FindingSeverity = crap === undefined ? 'moderate' : crap >= DEFAULT_CRAP_CRITICAL ? 'critical' : crap >= DEFAULT_CRAP_HIGH ? 'high' : 'moderate';

  const order: FindingSeverity[] = ['moderate','high','critical'];
  return [cogSev, cycSev, crapSev].reduce((a, b) => order.indexOf(a) >= order.indexOf(b) ? a : b);
}
