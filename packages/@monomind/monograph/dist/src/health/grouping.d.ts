import type { VitalSigns, HealthScore } from './vital-signs-snapshot.js';
export type HealthGrouping = 'package' | 'owner' | 'directory' | 'section';
export interface HealthGroup {
    key: string;
    vitalSigns: VitalSigns;
    healthScore: HealthScore;
    fileCount: number;
}
export declare function groupHealthResults(fileVitals: Array<{
    filePath: string;
    vitalSigns: VitalSigns;
    healthScore: HealthScore;
}>, grouping: HealthGrouping, codeownersMap?: Map<string, string>): HealthGroup[];
//# sourceMappingURL=grouping.d.ts.map