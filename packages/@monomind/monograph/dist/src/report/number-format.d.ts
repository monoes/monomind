export declare const MAX_FLAT_ITEMS = 10;
export declare const MAX_GROUPED_FILES = 10;
export declare const DIR_ROLLUP_THRESHOLD = 200;
export declare function thousands(n: number): string;
export declare function formatPercent(n: number, decimals?: number): string;
export declare function formatPath(filePath: string, root: string): string;
export declare function formatPathParts(filePath: string, root: string): {
    dir: string;
    filename: string;
};
export declare function buildSectionHeader(title: string, count: number): string;
export interface GroupedByFile {
    filePath: string;
    items: Array<{
        name: string;
        line?: number;
        extra?: string;
    }>;
}
export declare function buildGroupedByFile<T extends {
    filePath: string;
    exportName?: string;
    memberName?: string;
    line?: number;
}>(items: T[], root: string, maxFiles?: number, maxPerFile?: number): GroupedByFile[];
export declare function pluralize(count: number, singular: string, plural?: string): string;
export declare function summarizeTruncation(shown: number, total: number, noun: string): string | null;
export declare function formatCircularCycle(cycle: string[], root: string): string;
export declare function formatDuration(ms: number): string;
export declare function formatBytes(bytes: number): string;
//# sourceMappingURL=number-format.d.ts.map