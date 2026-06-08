import type { CoverageGapData } from '../health/scoring-types.js';
import type { FileScore, VitalSigns } from '../health/health-report-types.js';
export interface HumanHealthOptions {
    hotspotLimit?: number;
    coverageGapLimit?: number;
    noColor?: boolean;
}
export declare function formatVitalSignsSection(vitals: VitalSigns): string[];
export declare function formatHotspotSection(scores: FileScore[], limit?: number): string[];
export declare function formatCoverageGapSection(gaps: CoverageGapData[], limit?: number): string[];
export declare function buildHealthHumanLines(scores: FileScore[], vitals: VitalSigns, opts?: HumanHealthOptions): string[];
//# sourceMappingURL=human-health.d.ts.map