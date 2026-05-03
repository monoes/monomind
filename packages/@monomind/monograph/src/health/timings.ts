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

// ── Round 8: health pipeline timing breakdown ─────────────────────────────

export interface HealthPipelineTimings {
  configMs: number;
  discoverMs: number;
  parseMs: number;
  complexityMs: number;
  fileScoresMs: number;
  gitChurnMs: number;
  gitChurnCacheHit: boolean;
  hotspotsMs: number;
  duplicationMs: number;
  targetsMs: number;
  totalMs: number;
}

export const ZERO_HEALTH_PIPELINE_TIMINGS: HealthPipelineTimings = {
  configMs: 0, discoverMs: 0, parseMs: 0, complexityMs: 0,
  fileScoresMs: 0, gitChurnMs: 0, gitChurnCacheHit: false,
  hotspotsMs: 0, duplicationMs: 0, targetsMs: 0, totalMs: 0,
};

export function formatHealthPipelineTimings(t: HealthPipelineTimings): string {
  const rows: [string, string][] = [
    ['Config',      `${t.configMs}ms`],
    ['Discover',    `${t.discoverMs}ms`],
    ['Parse',       `${t.parseMs}ms`],
    ['Complexity',  `${t.complexityMs}ms`],
    ['File scores', `${t.fileScoresMs}ms`],
    ['Git churn',   `${t.gitChurnMs}ms${t.gitChurnCacheHit ? ' (cached)' : ''}`],
    ['Hotspots',    `${t.hotspotsMs}ms`],
    ['Duplication', `${t.duplicationMs}ms`],
    ['Targets',     `${t.targetsMs}ms`],
    ['Total',       `${t.totalMs}ms`],
  ];
  const labelW = Math.max(...rows.map(r => r[0].length));
  return rows.map(([l, v]) => `${l.padEnd(labelW)}  ${v}`).join('\n');
}

export function sumHealthPipelineTimings(phases: Partial<HealthPipelineTimings>): number {
  const phaseKeys: Array<keyof HealthPipelineTimings> = [
    'configMs', 'discoverMs', 'parseMs', 'complexityMs',
    'fileScoresMs', 'gitChurnMs', 'hotspotsMs', 'duplicationMs', 'targetsMs',
  ];
  return phaseKeys.reduce((s, k) => s + ((phases[k] as number | undefined) ?? 0), 0);
}
