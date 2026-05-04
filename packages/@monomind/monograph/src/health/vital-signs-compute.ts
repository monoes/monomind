import { existsSync, readFileSync, appendFileSync } from 'fs';
import type { VitalSigns } from './health-report-types.js';

export interface VitalSignsSnapshot {
  timestamp: number;
  score: number;
  vitals: VitalSigns;
}

export type TrendDirection = 'improving' | 'degrading' | 'stable';

export interface VitalSignsTrend {
  direction: TrendDirection;
  scoreDelta: number;
  snapshotCount: number;
}

const TREND_TOLERANCE = 0.5;

const round1 = (v: number): number => Math.round(v * 10) / 10;

export function computeVitalSignsScore(vitals: VitalSigns): number {
  let score = 100;

  const deadFilePenalty = round1(Math.min(vitals.deadFilePct * 0.2, 15));
  score -= deadFilePenalty;

  const deadExportPenalty = round1(Math.min(vitals.deadExportPct * 0.2, 15));
  score -= deadExportPenalty;

  const complexityPenalty = round1(Math.min(Math.max(vitals.avgCyclomatic - 1.5, 0) * 5, 20));
  score -= complexityPenalty;

  const p90Penalty = round1(Math.min(Math.max(vitals.p90Cyclomatic - 10, 0), 10));
  score -= p90Penalty;

  const maintPenalty = round1(Math.min(Math.max(70 - vitals.maintainabilityAvg, 0) * 0.5, 15));
  score -= maintPenalty;

  const hotspotPenalty = round1(Math.min(vitals.hotspotCount * 2, 10));
  score -= hotspotPenalty;

  const unusedDepPenalty = round1(Math.min(vitals.unusedDepCount, 10));
  score -= unusedDepPenalty;

  const circularDepPenalty = round1(Math.min(vitals.circularDepCount, 10));
  score -= circularDepPenalty;

  const dupPenalty = round1(Math.min(Math.max(vitals.duplicationPct - 5, 0), 10));
  score -= dupPenalty;

  const couplingPenalty = round1(Math.min(Math.max(vitals.couplingHighPct - 5, 0) * 0.5, 5));
  score -= couplingPenalty;

  return Math.max(0, Math.min(100, round1(score)));
}

export function computeTrend(snapshots: VitalSignsSnapshot[]): VitalSignsTrend {
  if (snapshots.length < 2) {
    return { direction: 'stable', scoreDelta: 0, snapshotCount: snapshots.length };
  }

  const prev = snapshots[snapshots.length - 2];
  const last = snapshots[snapshots.length - 1];
  const delta = round1(last.score - prev.score);

  let direction: TrendDirection;
  if (Math.abs(delta) <= TREND_TOLERANCE) {
    direction = 'stable';
  } else if (delta > 0) {
    direction = 'improving';
  } else {
    direction = 'degrading';
  }

  return { direction, scoreDelta: delta, snapshotCount: snapshots.length };
}

export function buildSnapshot(vitals: VitalSigns, score: number): VitalSignsSnapshot {
  return {
    timestamp: Date.now(),
    score,
    vitals,
  };
}

export function saveSnapshot(snapshotPath: string, snapshot: VitalSignsSnapshot): void {
  appendFileSync(snapshotPath, JSON.stringify(snapshot) + '\n', 'utf-8');
}

export function loadSnapshots(snapshotPath: string): VitalSignsSnapshot[] {
  if (!existsSync(snapshotPath)) return [];

  const raw = readFileSync(snapshotPath, 'utf-8');
  const snapshots: VitalSignsSnapshot[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      snapshots.push(JSON.parse(trimmed) as VitalSignsSnapshot);
    } catch {
      // skip malformed lines
    }
  }

  return snapshots.sort((a, b) => a.timestamp - b.timestamp);
}
