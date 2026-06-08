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
export declare function computeVitalSignsScore(vitals: VitalSigns): number;
export declare function computeTrend(snapshots: VitalSignsSnapshot[]): VitalSignsTrend;
export declare function buildSnapshot(vitals: VitalSigns, score: number): VitalSignsSnapshot;
export declare function saveSnapshot(snapshotPath: string, snapshot: VitalSignsSnapshot): void;
export declare function loadSnapshots(snapshotPath: string): VitalSignsSnapshot[];
//# sourceMappingURL=vital-signs-compute.d.ts.map