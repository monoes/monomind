import type Graph from 'graphology';
import type { GraphAnalysis, GraphQuestion } from './types.js';
export interface CorpusStats {
    totalFiles: number;
    totalWords: number;
    warning?: string;
}
export interface ReportOptions {
    projectPath?: string;
    tokenCost?: {
        input: number;
        output: number;
    };
    corpusStats?: CorpusStats;
    questions?: GraphQuestion[];
}
/**
 * Generate the full markdown report string.
 *
 * @param graph     - The annotated Graphology graph (with `community` attributes set)
 * @param analysis  - Result of buildAnalysis()
 * @param cohesionScores - Map of communityId → cohesion score (0–1)
 * @param options   - Optional metadata (projectPath, tokenCost, corpusStats, questions)
 */
export declare function generateReport(graph: Graph, analysis: GraphAnalysis, cohesionScores?: Record<number, number>, options?: ReportOptions): string;
//# sourceMappingURL=report.d.ts.map