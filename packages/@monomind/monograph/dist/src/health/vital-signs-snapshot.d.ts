export declare const SNAPSHOT_SCHEMA_VERSION = 7;
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
    timestamp: string;
    vitalSigns: VitalSigns;
    healthScore: HealthScore;
}
export declare function buildSnapshot(vitalSigns: VitalSigns, healthScore: HealthScore): VitalSignsSnapshot;
export declare function saveSnapshot(dir: string, snapshot: VitalSignsSnapshot): string;
export declare function loadSnapshots(dir: string): VitalSignsSnapshot[];
//# sourceMappingURL=vital-signs-snapshot.d.ts.map