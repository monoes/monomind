import type { ResolvedBoundaryConfig } from '../config/boundary-config.js';
import type { ModuleNode } from '../graph/node-types.js';
import type { FallowBoundaryViolation } from '../results/fallow-results.js';
export interface BoundaryAnalysisResult {
    violations: FallowBoundaryViolation[];
    checkedEdges: number;
    uncheckedFiles: number;
}
export declare function findBoundaryViolations(modules: ModuleNode[], config: ResolvedBoundaryConfig): FallowBoundaryViolation[];
export declare function analyzeBoundaries(modules: ModuleNode[], config: ResolvedBoundaryConfig): BoundaryAnalysisResult;
//# sourceMappingURL=boundary-analysis.d.ts.map