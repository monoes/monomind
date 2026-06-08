import type { MonographDb } from '../storage/db.js';
import type { SuggestedQuestion } from '../types.js';
export interface GraphReportResult {
    markdown: string;
    path: string;
    stats: {
        nodeCount: number;
        edgeCount: number;
        communityCount: number;
    };
}
interface NodeTypeStat {
    label: string;
    count: number;
}
interface EdgeRelationStat {
    relation: string;
    count: number;
}
interface TopDegreeNode {
    id: string;
    name: string;
    label: string;
    degree: number;
}
interface CommunityStat {
    id: number;
    label: string | null;
    memberCount: number;
}
export declare function buildMarkdownWithQuestions(nodeCount: number, edgeCount: number, nodesByType: NodeTypeStat[], edgesByRelation: EdgeRelationStat[], topNodes: TopDegreeNode[], communities: CommunityStat[], staleFiles: string[], questions: SuggestedQuestion[], confidenceSection?: string): string;
/**
 * Generates a graph report synchronously from an existing DB instance.
 * Writes the markdown to outputPath/GRAPH_REPORT.md and returns the result.
 */
export declare function generateGraphReportFromDb(db: MonographDb, outputPath: string): GraphReportResult;
/**
 * Generates a GRAPH_REPORT.md summarizing the knowledge graph.
 *
 * Overload 1: accepts an existing DB instance and output directory (synchronous).
 * Overload 2: accepts a repo path string and optional params (async, opens its own DB).
 */
export declare function generateGraphReport(db: MonographDb, outputPath: string): GraphReportResult;
export declare function generateGraphReport(repoPath: string, outputPath?: string, dbPath?: string, questions?: SuggestedQuestion[]): Promise<GraphReportResult>;
export {};
//# sourceMappingURL=graph-report.d.ts.map