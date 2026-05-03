export interface QualityGateConfig {
  minScore?: number;          // 0–100: fail if health score < minScore
  failOnRegression?: boolean;
}

export type QualityGateStatus = 'pass' | 'fail' | 'warn';

export interface QualityGateResult {
  status: QualityGateStatus;
  score: number;
  minScore?: number;
  failures: string[];
  warnings: string[];
}

export function evaluateQualityGate(
  score: number,
  grade: string,
  gate: QualityGateConfig,
  regressions?: Array<{ metric: string; baseline: number; current: number }>,
): QualityGateResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (gate.minScore != null && score < gate.minScore) {
    failures.push(`Health score ${score} is below minimum threshold ${gate.minScore}`);
  }

  if (gate.failOnRegression && regressions && regressions.length > 0) {
    for (const r of regressions) {
      failures.push(`Regression detected: ${r.metric} went from ${r.baseline} to ${r.current}`);
    }
  }

  if (grade === 'D' || grade === 'F') {
    warnings.push(`Low health grade: ${grade}`);
  }

  const status: QualityGateStatus =
    failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

  return {
    status,
    score,
    minScore: gate.minScore,
    failures,
    warnings,
  };
}

export function formatQualityGateResult(result: QualityGateResult): string {
  const icon = result.status === 'pass' ? '✓' : result.status === 'warn' ? '⚠' : '✗';
  const lines = [`${icon} Quality gate: ${result.status.toUpperCase()} (score: ${result.score})`];
  for (const f of result.failures) lines.push(`  ✗ ${f}`);
  for (const w of result.warnings) lines.push(`  ⚠ ${w}`);
  return lines.join('\n');
}
