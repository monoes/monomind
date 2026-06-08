import type { MonographDb } from '../storage/db.js';
export interface FunctionComplexity {
    nodeId: string;
    name: string;
    filePath: string | null;
    startLine: number | null;
    endLine: number | null;
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    linesOfCode: number;
    paramCount: number;
    crapScore: number;
}
export interface ComplexityReport {
    functions: FunctionComplexity[];
    p50cc: number;
    p90cc: number;
    p95cc: number;
    highComplexityCount: number;
    criticalCount: number;
}
/**
 * Compute CRAP score for a function.
 * Formula: CC² × (1 - coverage)³ + CC
 * where coverage is a 0-1 fraction (0 = no tests, 1 = fully covered).
 */
export declare function computeCrapScore(cc: number, coverage: number): number;
/**
 * Compute cyclomatic and cognitive complexity for all Function/Method nodes
 * in the knowledge graph. Uses graph degree as a proxy for decision points
 * since AST is not available at this layer.
 *
 * - Cyclomatic complexity proxy: outgoing CALLS × 0.5 + outgoing ACCESSES × 0.2 + 1
 * - Cognitive complexity proxy: (endLine - startLine) / 10, capped at 20
 * - LOC: endLine - startLine + 1 (or 1 if missing)
 * - CRAP: computed with coverage = 0 (worst-case, no test data available)
 */
export declare function computeComplexity(db: MonographDb): ComplexityReport;
//# sourceMappingURL=complexity.d.ts.map