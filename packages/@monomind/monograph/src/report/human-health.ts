import type { CoverageGapData } from '../health/scoring-types.js';
import type { FileScore, VitalSigns } from '../health/health-report-types.js';

export interface HumanHealthOptions {
  hotspotLimit?: number;
  coverageGapLimit?: number;
  noColor?: boolean;
}

const DEFAULT_HOTSPOT_LIMIT = 20;
const DEFAULT_COVERAGE_GAP_LIMIT = 20;

type VitalStatus = 'OK' | 'WARNING' | 'CRITICAL';

function vitalStatus(value: number, warnThreshold: number, critThreshold: number, higherIsBetter = false): VitalStatus {
  if (higherIsBetter) {
    if (value >= warnThreshold) return 'OK';
    if (value >= critThreshold) return 'WARNING';
    return 'CRITICAL';
  }
  if (value <= warnThreshold) return 'OK';
  if (value <= critThreshold) return 'WARNING';
  return 'CRITICAL';
}

function statusIcon(status: VitalStatus): string {
  if (status === 'OK') return '✓';
  if (status === 'WARNING') return '⚠';
  return '✗';
}

function formatVitalLine(label: string, status: VitalStatus, detail?: string): string {
  const icon = statusIcon(status);
  const suffix = detail ? ` (${detail})` : '';
  return `  ${icon} ${label}: ${status}${suffix}`;
}

export function formatVitalSignsSection(vitals: VitalSigns): string[] {
  const lines: string[] = [];
  lines.push('\n── Vital Signs ──');

  const complexityStatus = vitalStatus(vitals.avgCyclomatic, 1.5, 5.5);
  lines.push(formatVitalLine(
    'Avg Complexity',
    complexityStatus,
    complexityStatus !== 'OK' ? `avg ${vitals.avgCyclomatic.toFixed(1)}, threshold 1.5` : undefined,
  ));

  const p90Status = vitalStatus(vitals.p90Cyclomatic, 10, 20);
  lines.push(formatVitalLine(
    'P90 Complexity',
    p90Status,
    p90Status !== 'OK' ? `p90 ${vitals.p90Cyclomatic}, threshold 10` : undefined,
  ));

  const maintStatus = vitalStatus(vitals.maintainabilityAvg, 70, 40, true);
  lines.push(formatVitalLine(
    'Maintainability',
    maintStatus,
    maintStatus !== 'OK' ? `avg ${vitals.maintainabilityAvg.toFixed(1)}, threshold 70` : undefined,
  ));

  const dupStatus = vitalStatus(vitals.duplicationPct, 5, 15);
  lines.push(formatVitalLine(
    'Duplication',
    dupStatus,
    `${vitals.duplicationPct.toFixed(1)}%`,
  ));

  const deadFileStatus = vitalStatus(vitals.deadFilePct, 5, 25);
  lines.push(formatVitalLine(
    'Dead Files',
    deadFileStatus,
    `${vitals.deadFilePct.toFixed(1)}%`,
  ));

  const deadExportStatus = vitalStatus(vitals.deadExportPct, 5, 25);
  lines.push(formatVitalLine(
    'Dead Exports',
    deadExportStatus,
    `${vitals.deadExportPct.toFixed(1)}%`,
  ));

  const hotspotStatus = vitals.hotspotCount > 10 ? 'CRITICAL' : vitals.hotspotCount > 3 ? 'WARNING' : 'OK';
  lines.push(formatVitalLine(
    'Hotspots',
    hotspotStatus,
    `${vitals.hotspotCount} hotspot${vitals.hotspotCount !== 1 ? 's' : ''}`,
  ));

  if (vitals.unusedDepCount > 0) {
    const udStatus = vitalStatus(vitals.unusedDepCount, 0, 5);
    lines.push(formatVitalLine(
      'Unused Deps',
      udStatus,
      `${vitals.unusedDepCount}`,
    ));
  }

  if (vitals.circularDepCount > 0) {
    const cdStatus = vitalStatus(vitals.circularDepCount, 0, 3);
    lines.push(formatVitalLine(
      'Circular Deps',
      cdStatus,
      `${vitals.circularDepCount}`,
    ));
  }

  const couplingStatus = vitalStatus(vitals.couplingHighPct, 5, 15);
  lines.push(formatVitalLine(
    'High Coupling',
    couplingStatus,
    `${vitals.couplingHighPct.toFixed(1)}%`,
  ));

  return lines;
}

function computeHotspotScore(score: FileScore): number {
  let s = 0;
  if (score.complexityDensity !== undefined) s += score.complexityDensity * 30;
  if (score.crapMax !== undefined) s += Math.min(score.crapMax / 100, 1) * 25;
  if (score.deadCodeRatio !== undefined) s += score.deadCodeRatio * 20;
  if (score.fanIn !== undefined) s += Math.min(score.fanIn / 50, 1) * 15;
  if (score.maintainabilityIndex !== undefined) s += Math.max(0, (100 - score.maintainabilityIndex) / 100) * 10;
  return Math.min(s, 100);
}

export function formatHotspotSection(scores: FileScore[], limit = DEFAULT_HOTSPOT_LIMIT): string[] {
  if (scores.length === 0) return [];

  const sorted = [...scores]
    .map((s) => ({ score: s, value: computeHotspotScore(s) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const lines: string[] = [];
  lines.push('\n── Hotspots ──');

  for (const { score, value } of sorted) {
    const scoreStr = value.toFixed(1).padStart(5);
    lines.push(`  ${scoreStr}  ${score.path}`);
  }

  if (scores.length > limit) {
    lines.push(`  ... and ${scores.length - limit} more (use --format json for full list)`);
  }

  return lines;
}

export function formatCoverageGapSection(gaps: CoverageGapData[], limit = DEFAULT_COVERAGE_GAP_LIMIT): string[] {
  if (gaps.length === 0) return [];

  const sorted = [...gaps].sort((a, b) => a.coveragePct - b.coveragePct).slice(0, limit);

  const lines: string[] = [];
  lines.push('\n── Coverage Gaps ──');

  for (const gap of sorted) {
    const pctStr = `${gap.coveragePct.toFixed(1)}%`.padStart(6);
    lines.push(`  ${pctStr}  ${gap.filePath}`);
    if (gap.uncoveredFunctions.length > 0) {
      const shown = gap.uncoveredFunctions.slice(0, 3);
      const extra = gap.uncoveredFunctions.length - shown.length;
      const fnList = shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
      lines.push(`         uncovered: ${fnList}`);
    }
  }

  if (gaps.length > limit) {
    lines.push(`  ... and ${gaps.length - limit} more`);
  }

  return lines;
}

export function buildHealthHumanLines(
  scores: FileScore[],
  vitals: VitalSigns,
  opts: HumanHealthOptions = {},
): string[] {
  const lines: string[] = [];

  lines.push('\n── Health Report ──');

  const vitalLines = formatVitalSignsSection(vitals);
  lines.push(...vitalLines);

  const hotspotLimit = opts.hotspotLimit ?? DEFAULT_HOTSPOT_LIMIT;
  const hotspotLines = formatHotspotSection(scores, hotspotLimit);
  lines.push(...hotspotLines);

  return lines;
}
