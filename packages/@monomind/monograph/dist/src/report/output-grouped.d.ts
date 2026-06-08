import type { AnalysisResults } from '../results/types.js';
export type GroupOutputFormat = 'json' | 'text' | 'compact' | 'sarif';
export interface ResultGroup {
    key: string;
    owner?: string;
    root?: string;
    results: AnalysisResults;
}
export interface GroupedOutputOptions {
    format: GroupOutputFormat;
    root: string;
    showEmpty?: boolean;
    maxGroupsInText?: number;
}
export declare function buildGroupedJsonOutput(groups: ResultGroup[], opts: {
    root: string;
    schemaVersion?: number;
}): Record<string, unknown>;
export declare function buildGroupedTextLines(groups: ResultGroup[], opts: GroupedOutputOptions): string[];
export declare function buildGroupedCompactLines(groups: ResultGroup[], root: string): string[];
export declare function partitionGroupsByOwner(groups: ResultGroup[], ownerFilter: (owner: string) => boolean): {
    matched: ResultGroup[];
    unmatched: ResultGroup[];
};
//# sourceMappingURL=output-grouped.d.ts.map