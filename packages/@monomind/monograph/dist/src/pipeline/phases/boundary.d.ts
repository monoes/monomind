import type Database from 'better-sqlite3';
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
 * Load .monographrc.json from repoRoot. Returns empty config if not found or invalid.
 */
export declare function loadMonographConfig(repoRoot: string): MonographConfig;
/**
 * Classify a file path into a zone name. Returns null if no zone matches.
 */
export declare function classifyZone(filePath: string, zones: ZoneConfig[]): string | null;
/**
 * Check all edges in the DB for boundary violations.
 * Violations are cross-zone edges not present in the allowedImports allowlist.
 * Intra-zone imports are always allowed.
 * Returns [] if no .monographrc.json or no zones defined.
 */
export declare function detectBoundaryViolations(db: Database.Database, repoRoot: string): BoundaryViolation[];
//# sourceMappingURL=boundary.d.ts.map