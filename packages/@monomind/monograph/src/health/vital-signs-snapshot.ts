import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const SNAPSHOT_SCHEMA_VERSION = 7;

export interface VitalSigns {
  deadCodePct: number;
  duplicationPct: number;
  complexityHighPct: number;
  complexityCriticalPct: number;
  crapHighPct: number;
  crapCriticalPct: number;
  hotspotDensity: number;
  busFactor: number;
  unusedDepsPct: number;
  maintainabilityIndex: number;
}

export interface HealthScore {
  value: number;
  grade: string;
}

export interface VitalSignsSnapshot {
  schemaVersion: number;
  timestamp: string; // ISO8601
  vitalSigns: VitalSigns;
  healthScore: HealthScore;
}

export function buildSnapshot(
  vitalSigns: VitalSigns,
  healthScore: HealthScore
): VitalSignsSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    vitalSigns,
    healthScore,
  };
}

export function saveSnapshot(dir: string, snapshot: VitalSignsSnapshot): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const safeTimestamp = snapshot.timestamp.replace(/[:.]/g, '_');
  const filepath = join(dir, `${safeTimestamp}.json`);
  writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filepath;
}

export function loadSnapshots(dir: string): VitalSignsSnapshot[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const snapshots: VitalSignsSnapshot[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const parsed = JSON.parse(raw) as VitalSignsSnapshot;
      if (parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
        snapshots.push(parsed);
      }
    } catch {
      // skip malformed files
    }
  }
  snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return snapshots;
}
