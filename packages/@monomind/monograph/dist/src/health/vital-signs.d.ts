export declare const VITAL_SIGNS_SCHEMA_VERSION = 7;
export type CoverageModel = 'none' | 'static' | 'cloud' | 'partial';
export interface SizeBinProfile {
    smallPct: number;
    mediumPct: number;
    largePct: number;
    xlargePct: number;
}
export interface InterfacingProfile {
    lowParamPct: number;
    mediumParamPct: number;
    highParamPct: number;
    xlParamPct: number;
}
export interface VitalSignsCounts {
    unusedExports: number;
    deadFiles: number;
    circularDeps: number;
    boundaryViolations: number;
    cloneGroups: number;
    duplicatedLinesPct: number;
    highComplexityFunctions: number;
}
export interface VitalSigns {
    schemaVersion: number;
    createdAt: string;
    projectPath: string;
    healthScore: number;
    healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    counts: VitalSignsCounts;
    sizeRisk: SizeBinProfile;
    interfacingRisk: InterfacingProfile;
    fanIn95th: number;
    couplingConcentrationPct: number;
    totalLoc: number;
    totalFiles: number;
    totalNodes: number;
    totalEdges: number;
    coverageModel: CoverageModel;
    runtimeHotFunctionsPct?: number;
    runtimeColdFunctionsPct?: number;
    gitSha?: string;
    gitBranch?: string;
}
export declare function createVitalSigns(partial: Partial<VitalSigns> & Pick<VitalSigns, 'projectPath'>): VitalSigns;
export declare function formatVitalSignsSummary(vs: VitalSigns): string;
//# sourceMappingURL=vital-signs.d.ts.map