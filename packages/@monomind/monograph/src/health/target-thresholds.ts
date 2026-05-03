// Adaptive thresholds derived from the project's own metric distribution,
// plus extended RecommendationCategory labels.

export type ExtendedRecommendationCategory =
  | 'UrgentChurnComplexity'
  | 'BreakCircularDependency'
  | 'SplitHighImpact'
  | 'RemoveDeadCode'
  | 'ExtractComplexFunctions'
  | 'ExtractDependencies'
  | 'AddTestCoverage'
  | 'ReduceFanIn'
  | 'ReduceFanOut'
  | 'SplitLargeFile'
  | 'ExtractModule';

export interface CategoryMeta {
  label: string;
  compactLabel: string;
  priority: number;
}

export const RECOMMENDATION_CATEGORIES: Record<ExtendedRecommendationCategory, CategoryMeta> = {
  UrgentChurnComplexity:     { label: 'Urgent: High churn + complexity',   compactLabel: 'urgent',    priority: 1 },
  BreakCircularDependency:   { label: 'Break circular dependency',          compactLabel: 'circular',  priority: 2 },
  SplitHighImpact:           { label: 'Split high-impact file',             compactLabel: 'split',     priority: 3 },
  RemoveDeadCode:            { label: 'Remove dead code',                   compactLabel: 'dead',      priority: 4 },
  ExtractComplexFunctions:   { label: 'Extract complex functions',          compactLabel: 'complex',   priority: 5 },
  ExtractDependencies:       { label: 'Extract/decouple dependencies',      compactLabel: 'decouple',  priority: 6 },
  AddTestCoverage:           { label: 'Add test coverage',                  compactLabel: 'coverage',  priority: 7 },
  ReduceFanIn:               { label: 'Reduce fan-in (too many importers)', compactLabel: 'fan-in',    priority: 8 },
  ReduceFanOut:              { label: 'Reduce fan-out (too many imports)',  compactLabel: 'fan-out',   priority: 9 },
  SplitLargeFile:            { label: 'Split large file',                   compactLabel: 'large',     priority: 10 },
  ExtractModule:             { label: 'Extract to shared module',           compactLabel: 'extract',   priority: 11 },
};

export interface TargetThresholds {
  fanInP95: number;
  fanInP75: number;
  fanOutP95: number;
  fanOutP90: number;
  complexityP90: number;
  locP90: number;
  churnP75: number;
}

const FLOOR: TargetThresholds = {
  fanInP95: 5, fanInP75: 3, fanOutP95: 15, fanOutP90: 10,
  complexityP90: 10, locP90: 200, churnP75: 3,
};

/** Compute adaptive thresholds from a sorted metric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export interface MetricSample {
  fanIn: number[];
  fanOut: number[];
  complexity: number[];
  loc: number[];
  churnScore: number[];
}

export function computeTargetThresholds(sample: MetricSample): TargetThresholds {
  const sort = (a: number[]) => [...a].sort((x, y) => x - y);
  const fi = sort(sample.fanIn);
  const fo = sort(sample.fanOut);
  const cc = sort(sample.complexity);
  const lc = sort(sample.loc);
  const ch = sort(sample.churnScore);

  return {
    fanInP95:      Math.max(FLOOR.fanInP95,     percentile(fi, 0.95)),
    fanInP75:      Math.max(FLOOR.fanInP75,     percentile(fi, 0.75)),
    fanOutP95:     Math.max(FLOOR.fanOutP95,    percentile(fo, 0.95)),
    fanOutP90:     Math.max(FLOOR.fanOutP90,    percentile(fo, 0.90)),
    complexityP90: Math.max(FLOOR.complexityP90, percentile(cc, 0.90)),
    locP90:        Math.max(FLOOR.locP90,        percentile(lc, 0.90)),
    churnP75:      Math.max(FLOOR.churnP75,      percentile(ch, 0.75)),
  };
}

export function labelForCategory(cat: ExtendedRecommendationCategory): string {
  return RECOMMENDATION_CATEGORIES[cat].label;
}

export function compactLabelForCategory(cat: ExtendedRecommendationCategory): string {
  return RECOMMENDATION_CATEGORIES[cat].compactLabel;
}
