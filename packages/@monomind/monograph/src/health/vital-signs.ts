// Extended vital-signs metric struct for project-wide trend tracking.
// Extends the basic snapshot with interfacing risk, LOC, coverage model, coupling.

export const VITAL_SIGNS_SCHEMA_VERSION = 7;

export type CoverageModel = 'none' | 'static' | 'cloud' | 'partial';

export interface SizeBinProfile {
  smallPct: number;    // < 50 LOC
  mediumPct: number;   // 50–150 LOC
  largePct: number;    // 151–300 LOC
  xlargePct: number;   // > 300 LOC
}

export interface InterfacingProfile {
  lowParamPct: number;    // 0–2 params
  mediumParamPct: number; // 3–4 params
  highParamPct: number;   // 5–7 params
  xlParamPct: number;     // 8+ params
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

  // Health score
  healthScore: number;
  healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';

  // Issue counts
  counts: VitalSignsCounts;

  // Risk profiles
  sizeRisk: SizeBinProfile;
  interfacingRisk: InterfacingProfile;

  // Fan-in/out metrics
  fanIn95th: number;
  couplingConcentrationPct: number;

  // Size
  totalLoc: number;
  totalFiles: number;
  totalNodes: number;
  totalEdges: number;

  // Coverage
  coverageModel: CoverageModel;
  runtimeHotFunctionsPct?: number;
  runtimeColdFunctionsPct?: number;

  // Optional git context
  gitSha?: string;
  gitBranch?: string;
}

export function createVitalSigns(partial: Partial<VitalSigns> & Pick<VitalSigns, 'projectPath'>): VitalSigns {
  const now = new Date().toISOString();
  return {
    schemaVersion: VITAL_SIGNS_SCHEMA_VERSION,
    createdAt: now,
    healthScore: 0,
    healthGrade: 'F',
    counts: {
      unusedExports: 0, deadFiles: 0, circularDeps: 0, boundaryViolations: 0,
      cloneGroups: 0, duplicatedLinesPct: 0, highComplexityFunctions: 0,
    },
    sizeRisk: { smallPct: 0, mediumPct: 0, largePct: 0, xlargePct: 0 },
    interfacingRisk: { lowParamPct: 0, mediumParamPct: 0, highParamPct: 0, xlParamPct: 0 },
    fanIn95th: 0,
    couplingConcentrationPct: 0,
    totalLoc: 0,
    totalFiles: 0,
    totalNodes: 0,
    totalEdges: 0,
    coverageModel: 'none',
    ...partial,
  };
}

export function formatVitalSignsSummary(vs: VitalSigns): string {
  return [
    `Health: ${vs.healthGrade} (${vs.healthScore.toFixed(1)}/100)`,
    `Files: ${vs.totalFiles}  LOC: ${vs.totalLoc}  Nodes: ${vs.totalNodes}`,
    `Unused exports: ${vs.counts.unusedExports}  Dead files: ${vs.counts.deadFiles}`,
    `Duplication: ${vs.counts.duplicatedLinesPct.toFixed(1)}%  Clones: ${vs.counts.cloneGroups}`,
    `Circular deps: ${vs.counts.circularDeps}  Boundary violations: ${vs.counts.boundaryViolations}`,
    `Coverage model: ${vs.coverageModel}`,
  ].join('\n');
}
