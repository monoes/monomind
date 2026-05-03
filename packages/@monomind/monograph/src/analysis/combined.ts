import type { MonographDb } from '../storage/db.js';

export type AnalysisKind = 'dead-code' | 'duplication' | 'health';

export interface CombinedOptions {
  only?: AnalysisKind[];
  skip?: AnalysisKind[];
}

export interface CombinedResult {
  analyses: Set<AnalysisKind>;
  ranAt: string; // ISO timestamp
}

export function resolveAnalyses(opts: CombinedOptions): Set<AnalysisKind> {
  let result = new Set<AnalysisKind>(['dead-code', 'duplication', 'health']);

  if (opts.skip) {
    for (const kind of opts.skip) {
      result.delete(kind);
    }
  }

  if (opts.only && opts.only.length > 0) {
    const onlySet = new Set(opts.only);
    result = new Set([...result].filter((k) => onlySet.has(k)));
  }

  return result;
}

export async function runCombined(
  db: MonographDb,
  opts: CombinedOptions
): Promise<CombinedResult> {
  const analyses = resolveAnalyses(opts);
  const ranAt = new Date().toISOString();
  return { analyses, ranAt };
}
