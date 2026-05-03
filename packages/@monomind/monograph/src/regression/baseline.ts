// File I/O operations for saving, loading, and comparing regression baselines.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface RegressionBaselineFile {
  version: number;
  createdAt: string;
  counts: Record<string, number>;
}

export const REGRESSION_BASELINE_VERSION = 1;
export const DEFAULT_REGRESSION_BASELINE_PATH = '.monograph/regression-baseline.json';

export type SaveRegressionTarget =
  | { kind: 'file'; path: string }
  | { kind: 'config'; configPath: string };

export interface RegressionBaselineOpts {
  saveTarget: SaveRegressionTarget;
  tolerance?: number;
}

export interface RegressionCompareResult {
  passed: boolean;
  exceeded: Array<{ metric: string; baseline: number; current: number; delta: number; tolerance: number }>;
}

export function saveRegressionBaseline(
  counts: Record<string, number>,
  target: SaveRegressionTarget = { kind: 'file', path: DEFAULT_REGRESSION_BASELINE_PATH },
  root = process.cwd(),
): void {
  const data: RegressionBaselineFile = {
    version: REGRESSION_BASELINE_VERSION,
    createdAt: new Date().toISOString(),
    counts,
  };
  const path = target.kind === 'file'
    ? resolve(root, target.path)
    : resolve(root, target.configPath.replace(/\.[^.]+$/, '-baseline.json'));
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export function loadRegressionBaseline(
  path = DEFAULT_REGRESSION_BASELINE_PATH,
  root = process.cwd(),
): RegressionBaselineFile | null {
  const abs = resolve(root, path);
  if (!existsSync(abs)) return null;
  try {
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const parsed = raw as Record<string, unknown>;
    if (typeof parsed['counts'] !== 'object') return null;
    return parsed as unknown as RegressionBaselineFile;
  } catch {
    return null;
  }
}

export function compareWithRegressionBaseline(
  baseline: RegressionBaselineFile,
  current: Record<string, number>,
  tolerance = 0,
): RegressionCompareResult {
  const exceeded = [];
  for (const [metric, baseVal] of Object.entries(baseline.counts)) {
    const curVal = current[metric] ?? 0;
    const delta = curVal - baseVal;
    if (delta > tolerance) {
      exceeded.push({ metric, baseline: baseVal, current: curVal, delta, tolerance });
    }
  }
  return { passed: exceeded.length === 0, exceeded };
}
