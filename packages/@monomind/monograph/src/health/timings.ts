export interface HealthTimings {
  churnMs: number;
  complexityMs: number;
  duplicationMs: number;
  scoringMs: number;
  renderMs: number;
  totalMs: number;
}

export function printPerformanceTable(timings: HealthTimings): string {
  const rows: Array<{ phase: string; ms: number }> = [
    { phase: 'Churn', ms: timings.churnMs },
    { phase: 'Complexity', ms: timings.complexityMs },
    { phase: 'Duplication', ms: timings.duplicationMs },
    { phase: 'Scoring', ms: timings.scoringMs },
    { phase: 'Render', ms: timings.renderMs },
    { phase: 'TOTAL', ms: timings.totalMs },
  ];

  const total = timings.totalMs;

  const phaseColWidth = Math.max('Phase'.length, ...rows.map((r) => r.phase.length));
  const msColWidth = Math.max('Duration (ms)'.length, ...rows.map((r) => String(r.ms).length));
  const pctColWidth = Math.max('% of Total'.length, 6);

  const sep = `+${'-'.repeat(phaseColWidth + 2)}+${'-'.repeat(msColWidth + 2)}+${'-'.repeat(pctColWidth + 2)}+`;
  const header = `| ${'Phase'.padEnd(phaseColWidth)} | ${'Duration (ms)'.padStart(msColWidth)} | ${'% of Total'.padStart(pctColWidth)} |`;

  const lines: string[] = [sep, header, sep];

  for (const row of rows) {
    const pct = total > 0 ? ((row.ms / total) * 100).toFixed(1) : '0.0';
    const line = `| ${row.phase.padEnd(phaseColWidth)} | ${String(row.ms).padStart(msColWidth)} | ${pct.padStart(pctColWidth)} |`;
    lines.push(line);
  }

  lines.push(sep);
  return lines.join('\n');
}
