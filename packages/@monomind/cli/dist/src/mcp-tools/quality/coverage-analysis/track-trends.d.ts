/**
 * track-trends.ts - Coverage trend tracking MCP tool handler
 *
 * Tracks coverage trends over time, detecting patterns, regressions,
 * and improvements to provide actionable insights.
 */
import { z } from 'zod';
export declare const TrackTrendsInputSchema: z.ZodObject<{
    targetPath: z.ZodOptional<z.ZodString>;
    timeRange: z.ZodDefault<z.ZodEnum<["7d", "14d", "30d", "90d", "180d", "365d"]>>;
    metrics: z.ZodDefault<z.ZodArray<z.ZodEnum<["line", "branch", "function", "statement", "overall"]>, "many">>;
    detectRegressions: z.ZodDefault<z.ZodBoolean>;
    regressionThreshold: z.ZodDefault<z.ZodNumber>;
    groupBy: z.ZodDefault<z.ZodEnum<["day", "week", "month", "commit"]>>;
    includeProjections: z.ZodDefault<z.ZodBoolean>;
    compareBaseline: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    metrics: ("function" | "line" | "overall" | "branch" | "statement")[];
    timeRange: "7d" | "30d" | "14d" | "90d" | "180d" | "365d";
    groupBy: "week" | "month" | "commit" | "day";
    detectRegressions: boolean;
    regressionThreshold: number;
    includeProjections: boolean;
    targetPath?: string | undefined;
    compareBaseline?: string | undefined;
}, {
    metrics?: ("function" | "line" | "overall" | "branch" | "statement")[] | undefined;
    timeRange?: "7d" | "30d" | "14d" | "90d" | "180d" | "365d" | undefined;
    targetPath?: string | undefined;
    groupBy?: "week" | "month" | "commit" | "day" | undefined;
    detectRegressions?: boolean | undefined;
    regressionThreshold?: number | undefined;
    includeProjections?: boolean | undefined;
    compareBaseline?: string | undefined;
}>;
export type TrackTrendsInput = z.infer<typeof TrackTrendsInputSchema>;
export interface TrackTrendsOutput {
    success: boolean;
    trends: TrendData;
    regressions: Regression[];
    improvements: Improvement[];
    projections: Projection[];
    insights: TrendInsight[];
    metadata: TrendMetadata;
}
export interface TrendData {
    timeRange: {
        start: string;
        end: string;
    };
    dataPoints: TrendDataPoint[];
    aggregates: TrendAggregates;
    volatility: number;
}
export interface TrendDataPoint {
    date: string;
    commitHash?: string;
    metrics: Record<string, number>;
    filesChanged: number;
    testsAdded: number;
}
export interface TrendAggregates {
    avgLine: number;
    avgBranch: number;
    avgFunction: number;
    avgOverall: number;
    minOverall: number;
    maxOverall: number;
    change: number;
    changePercent: number;
}
export interface Regression {
    id: string;
    date: string;
    metric: string;
    before: number;
    after: number;
    drop: number;
    severity: 'minor' | 'moderate' | 'major' | 'critical';
    possibleCauses: string[];
    affectedFiles: string[];
}
export interface Improvement {
    id: string;
    date: string;
    metric: string;
    before: number;
    after: number;
    gain: number;
    type: 'test-addition' | 'refactoring' | 'dead-code-removal' | 'other';
    contributors: string[];
}
export interface Projection {
    metric: string;
    currentValue: number;
    projectedValue: number;
    targetDate: string;
    confidence: number;
    requiredPace: number;
    onTrack: boolean;
}
export interface TrendInsight {
    type: 'pattern' | 'anomaly' | 'recommendation' | 'warning';
    title: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    actionable: boolean;
    suggestedAction?: string;
}
export interface TrendMetadata {
    analyzedAt: string;
    durationMs: number;
    dataPointCount: number;
    timeRange: string;
    baselineDate?: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for track-trends
 */
export declare function handler(input: TrackTrendsInput, context: ToolContext): Promise<{
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
        targetPath: z.ZodOptional<z.ZodString>;
        timeRange: z.ZodDefault<z.ZodEnum<["7d", "14d", "30d", "90d", "180d", "365d"]>>;
        metrics: z.ZodDefault<z.ZodArray<z.ZodEnum<["line", "branch", "function", "statement", "overall"]>, "many">>;
        detectRegressions: z.ZodDefault<z.ZodBoolean>;
        regressionThreshold: z.ZodDefault<z.ZodNumber>;
        groupBy: z.ZodDefault<z.ZodEnum<["day", "week", "month", "commit"]>>;
        includeProjections: z.ZodDefault<z.ZodBoolean>;
        compareBaseline: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        metrics: ("function" | "line" | "overall" | "branch" | "statement")[];
        timeRange: "7d" | "30d" | "14d" | "90d" | "180d" | "365d";
        groupBy: "week" | "month" | "commit" | "day";
        detectRegressions: boolean;
        regressionThreshold: number;
        includeProjections: boolean;
        targetPath?: string | undefined;
        compareBaseline?: string | undefined;
    }, {
        metrics?: ("function" | "line" | "overall" | "branch" | "statement")[] | undefined;
        timeRange?: "7d" | "30d" | "14d" | "90d" | "180d" | "365d" | undefined;
        targetPath?: string | undefined;
        groupBy?: "week" | "month" | "commit" | "day" | undefined;
        detectRegressions?: boolean | undefined;
        regressionThreshold?: number | undefined;
        includeProjections?: boolean | undefined;
        compareBaseline?: string | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=track-trends.d.ts.map