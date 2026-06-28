/**
 * find-similar-defects.ts - Similar defect search MCP tool handler
 *
 * Searches for similar defects using semantic similarity, pattern matching,
 * and code structure analysis to help identify recurring issues.
 */
import { z } from 'zod';
export declare const FindSimilarDefectsInputSchema: z.ZodObject<{
    query: z.ZodObject<{
        description: z.ZodString;
        category: z.ZodOptional<z.ZodString>;
        file: z.ZodOptional<z.ZodString>;
        codeSnippet: z.ZodOptional<z.ZodString>;
        stackTrace: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    searchScope: z.ZodDefault<z.ZodEnum<{
        project: "project";
        organization: "organization";
        global: "global";
    }>>;
    maxResults: z.ZodDefault<z.ZodNumber>;
    minSimilarity: z.ZodDefault<z.ZodNumber>;
    includeResolved: z.ZodDefault<z.ZodBoolean>;
    includeAnalysis: z.ZodDefault<z.ZodBoolean>;
    groupBy: z.ZodDefault<z.ZodEnum<{
        none: "none";
        component: "component";
        category: "category";
        resolution: "resolution";
    }>>;
}, z.core.$strip>;
export type FindSimilarDefectsInput = z.infer<typeof FindSimilarDefectsInputSchema>;
export interface FindSimilarDefectsOutput {
    success: boolean;
    matches: DefectMatch[];
    groups: DefectGroup[];
    patterns: DetectedPattern[];
    insights: SearchInsight[];
    metadata: SearchMetadata;
}
export interface DefectMatch {
    id: string;
    similarity: number;
    defect: DefectInfo;
    matchReasons: MatchReason[];
    resolution: ResolutionInfo | null;
    relatedFiles: string[];
}
export interface DefectInfo {
    id: string;
    title: string;
    description: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    status: 'open' | 'in-progress' | 'resolved' | 'closed' | 'wont-fix';
    createdAt: string;
    file?: string;
    line?: number;
    component?: string;
    tags: string[];
}
export interface MatchReason {
    type: 'semantic' | 'structural' | 'pattern' | 'location' | 'category';
    description: string;
    score: number;
}
export interface ResolutionInfo {
    status: 'resolved' | 'wont-fix' | 'duplicate';
    resolution: string;
    resolvedAt: string;
    resolvedBy: string;
    effective: boolean;
    linkedCommit?: string;
}
export interface DefectGroup {
    name: string;
    count: number;
    avgSimilarity: number;
    defectIds: string[];
}
export interface DetectedPattern {
    pattern: string;
    occurrences: number;
    affectedDefects: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
    recommendation: string;
}
export interface SearchInsight {
    type: 'recurring' | 'cluster' | 'trend' | 'hotspot';
    title: string;
    description: string;
    actionable: boolean;
    action?: string;
}
export interface SearchMetadata {
    searchedAt: string;
    durationMs: number;
    totalSearched: number;
    matchesFound: number;
    searchScope: string;
    algorithms: string[];
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for find-similar-defects
 */
export declare function handler(input: FindSimilarDefectsInput, context: ToolContext): Promise<{
    content: Array<{
        type: 'text';
        text: string;
    }>;
}>;
export declare const toolDefinition: {
    name: string;
    description: string;
    category: string;
    version: string;
    inputSchema: z.ZodObject<{
        query: z.ZodObject<{
            description: z.ZodString;
            category: z.ZodOptional<z.ZodString>;
            file: z.ZodOptional<z.ZodString>;
            codeSnippet: z.ZodOptional<z.ZodString>;
            stackTrace: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        searchScope: z.ZodDefault<z.ZodEnum<{
            project: "project";
            organization: "organization";
            global: "global";
        }>>;
        maxResults: z.ZodDefault<z.ZodNumber>;
        minSimilarity: z.ZodDefault<z.ZodNumber>;
        includeResolved: z.ZodDefault<z.ZodBoolean>;
        includeAnalysis: z.ZodDefault<z.ZodBoolean>;
        groupBy: z.ZodDefault<z.ZodEnum<{
            none: "none";
            component: "component";
            category: "category";
            resolution: "resolution";
        }>>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=find-similar-defects.d.ts.map