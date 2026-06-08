import type Database from 'better-sqlite3';
export interface BaselineFinding {
    /** Stable identifier: e.g. "file:src/foo.ts:export:bar" or "community:12:orphan" */
    key: string;
    type: 'unreachable_export' | 'isolated_node' | 'ambiguous_edge' | 'bridge_node' | 'surprise' | 'god_node' | 'other';
    nodeId: string;
    nodeName: string;
    filePath: string | null;
    savedAt: string;
    /** 16-hex SHA-256 fingerprint for stable deduplication across runs */
    fingerprint?: string;
}
export interface BaselineData {
    version: 1;
    savedAt: string;
    projectPath: string;
    findings: BaselineFinding[];
}
export interface ComparedFinding extends BaselineFinding {
    introduced: boolean;
}
/**
 * Save the current set of findings as a baseline JSON file.
 * @param baselinePath - path to write (e.g. .monomind/baseline.json)
 * @param findings - current findings to persist
 * @param projectPath - repo path for identification
 */
export declare function saveBaseline(baselinePath: string, findings: BaselineFinding[], projectPath: string): void;
/**
 * Load an existing baseline file.
 */
export declare function loadBaseline(baselinePath: string): BaselineData | null;
/**
 * Compare a list of current findings against a baseline.
 * Returns each finding annotated with introduced:true/false.
 */
export declare function compareWithBaseline(currentFindings: BaselineFinding[], baseline: BaselineData | null): ComparedFinding[];
/**
 * Extract findings from the database to build a baseline.
 * Collects: isolated nodes (no edges), nodes with only INFERRED edges,
 * god nodes (degree > 50).
 */
export declare function extractFindingsFromDb(db: Database.Database, projectPath: string): BaselineFinding[];
/**
 * Default baseline path relative to a project directory.
 * If a name is provided, the file is saved as `baseline-{name}.json`.
 */
export declare function defaultBaselinePath(projectDir: string, name?: string): string;
export type TrendDirection = 'improving' | 'declining' | 'stable';
export interface TrendMetric {
    metric: string;
    previous: number;
    current: number;
    delta: number;
    direction: TrendDirection;
    symbol: '↑' | '↓' | '→';
}
export interface TrendReport {
    metrics: TrendMetric[];
    overallDirection: TrendDirection;
}
/**
 * Extended baseline data with vital-sign counters.
 * These fields are optional so existing baseline files remain compatible.
 */
export interface BaselineVitals {
    nodeCount?: number;
    edgeCount?: number;
    communityCount?: number;
    godNodeCount?: number;
    surpriseCount?: number;
    hotspotCount?: number;
    unreachableNodeCount?: number;
}
/**
 * Compute a trend report by comparing two BaselineData snapshots.
 * Each baseline must carry BaselineVitals fields (nodeCount, edgeCount, …).
 */
export declare function computeTrend(before: BaselineData & BaselineVitals, after: BaselineData & BaselineVitals): TrendReport;
//# sourceMappingURL=baseline.d.ts.map