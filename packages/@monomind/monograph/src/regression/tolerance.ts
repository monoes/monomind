export type ToleranceKind = 'percentage' | 'absolute';

export interface Tolerance {
  kind: ToleranceKind;
  value: number;
}

export function parseTolerance(s: string): Tolerance {
  const t = s.trim();
  if (!t) return { kind: 'absolute', value: 0 };
  if (t.endsWith('%')) {
    const pct = parseFloat(t.slice(0, -1).trim());
    if (isNaN(pct)) throw new Error(`invalid tolerance percentage: ${s}`);
    if (pct < 0) throw new Error(`tolerance percentage must be non-negative: ${s}`);
    return { kind: 'percentage', value: pct };
  }
  const abs = parseInt(t, 10);
  if (isNaN(abs) || abs < 0) throw new Error(`invalid tolerance value: ${s} (use a number or N%)`);
  return { kind: 'absolute', value: abs };
}

export function toleranceExceeded(tol: Tolerance, baselineTotal: number, currentTotal: number): boolean {
  if (currentTotal <= baselineTotal) return false;
  const delta = currentTotal - baselineTotal;
  if (tol.kind === 'absolute') return delta > tol.value;
  if (baselineTotal === 0) return delta > 0;
  const allowed = Math.floor(baselineTotal * tol.value / 100);
  return delta > allowed;
}

export function formatTolerance(tol: Tolerance): string {
  return tol.kind === 'percentage' ? `${tol.value}%` : `${tol.value}`;
}

export const ZERO_TOLERANCE: Tolerance = { kind: 'absolute', value: 0 };
