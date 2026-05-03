import { readFileSync, writeFileSync } from 'fs';

export interface Tolerance {
  type: 'absolute' | 'percentage';
  value: number;
}

export function parseTolerance(s: string): Tolerance {
  const pct = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return { type: 'percentage', value: parseFloat(pct[1]!) };
  const abs = s.match(/^(\d+)$/);
  if (abs) return { type: 'absolute', value: parseInt(abs[1]!, 10) };
  return { type: 'absolute', value: 0 };
}

export function toleranceExceeded(tol: Tolerance, baseline: number, current: number): boolean {
  const delta = current - baseline;
  if (delta <= 0) return false;
  if (tol.type === 'absolute') return delta > tol.value;
  return delta / Math.max(1, baseline) * 100 > tol.value;
}

export function saveBaselineToConfig(configPath: string, counts: Record<string, number>): void {
  let content: string;
  try { content = readFileSync(configPath, 'utf8'); }
  catch { content = '{}'; }
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(stripJsonComments(content)); }
  catch { parsed = {}; }
  parsed['regression'] = { ...((parsed['regression'] as Record<string, unknown>) ?? {}), baseline: counts };
  writeFileSync(configPath, JSON.stringify(parsed, null, 2));
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
