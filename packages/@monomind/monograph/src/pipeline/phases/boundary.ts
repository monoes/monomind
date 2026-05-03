import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ZoneConfig {
  name: string;
  glob: string;
}

export interface MonographConfig {
  zones?: ZoneConfig[];
  allowedImports?: [string, string][];
}

export interface BoundaryViolation {
  fromPath: string;
  toPath: string;
  fromZone: string;
  toZone: string;
  edgeRelation: string;
}

/**
 * Convert a glob pattern to a regex.
 * Handles: ** to .*, * to [^/]*, escapes other regex chars.
 */
function globToRegex(glob: string): RegExp {
  const DOUBLE_STAR = '\x00DS\x00';
  const pattern = glob
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .split(DOUBLE_STAR).join('.*');
  return new RegExp(pattern);
}

/**
 * Load .monographrc.json from repoRoot. Returns empty config if not found or invalid.
 */
export function loadMonographConfig(repoRoot: string): MonographConfig {
  const configPath = join(repoRoot, '.monographrc.json');
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as MonographConfig;
  } catch {
    return {};
  }
}

/**
 * Classify a file path into a zone name. Returns null if no zone matches.
 */
export function classifyZone(filePath: string, zones: ZoneConfig[]): string | null {
  for (const zone of zones) {
    const regex = globToRegex(zone.glob);
    if (regex.test(filePath)) return zone.name;
  }
  return null;
}

/**
 * Check all edges in the DB for boundary violations.
 * Violations are cross-zone edges not present in the allowedImports allowlist.
 * Intra-zone imports are always allowed.
 * Returns [] if no .monographrc.json or no zones defined.
 */
export function detectBoundaryViolations(
  db: Database.Database,
  repoRoot: string,
): BoundaryViolation[] {
  const config = loadMonographConfig(repoRoot);

  if (!config.zones || config.zones.length === 0) return [];

  const zones = config.zones;
  const allowedSet = new Set<string>(
    (config.allowedImports ?? []).map(([from, to]) => `${from}→${to}`),
  );

  const rows = db.prepare(`
    SELECT e.id, e.relation,
           ns.file_path AS src_path,
           nt.file_path AS tgt_path
    FROM edges e
    JOIN nodes ns ON ns.id = e.source_id
    JOIN nodes nt ON nt.id = e.target_id
    WHERE ns.file_path IS NOT NULL AND nt.file_path IS NOT NULL
  `).all() as { id: string; relation: string; src_path: string; tgt_path: string }[];

  const violations: BoundaryViolation[] = [];

  for (const row of rows) {
    const fromZone = classifyZone(row.src_path, zones);
    const toZone = classifyZone(row.tgt_path, zones);

    if (fromZone === null || toZone === null) continue;
    if (fromZone === toZone) continue;

    const key = `${fromZone}→${toZone}`;
    if (!allowedSet.has(key)) {
      violations.push({
        fromPath: row.src_path,
        toPath: row.tgt_path,
        fromZone,
        toZone,
        edgeRelation: row.relation,
      });
    }
  }

  return violations;
}
