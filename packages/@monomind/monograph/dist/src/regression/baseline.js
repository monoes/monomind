// File I/O operations for saving, loading, and comparing regression baselines.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export const REGRESSION_BASELINE_VERSION = 1;
export const DEFAULT_REGRESSION_BASELINE_PATH = '.monograph/regression-baseline.json';
export function saveRegressionBaseline(counts, target = { kind: 'file', path: DEFAULT_REGRESSION_BASELINE_PATH }, root = process.cwd()) {
    const data = {
        version: REGRESSION_BASELINE_VERSION,
        createdAt: new Date().toISOString(),
        counts,
    };
    const path = target.kind === 'file'
        ? resolve(root, target.path)
        : resolve(root, target.configPath.replace(/\.[^.]+$/, '-baseline.json'));
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}
export function loadRegressionBaseline(path = DEFAULT_REGRESSION_BASELINE_PATH, root = process.cwd()) {
    const abs = resolve(root, path);
    if (!existsSync(abs))
        return null;
    try {
        const raw = JSON.parse(readFileSync(abs, 'utf8'));
        if (typeof raw !== 'object' || raw === null)
            return null;
        const parsed = raw;
        if (typeof parsed['counts'] !== 'object')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export function compareWithRegressionBaseline(baseline, current, tolerance = 0) {
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
//# sourceMappingURL=baseline.js.map