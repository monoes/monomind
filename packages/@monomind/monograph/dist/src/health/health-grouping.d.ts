export interface HealthGroup {
    name: string;
    files: string[];
    fileCount: number;
    score: number;
    grade: string;
    totalLines: number;
    unusedExports: number;
    circularDeps: number;
}
export interface HealthGrouping {
    groups: HealthGroup[];
    totalFiles: number;
    averageScore: number;
}
export declare function groupFilesByOwner(files: Array<{
    filePath: string;
}>, resolveOwner: (filePath: string) => string): Map<string, string[]>;
export declare function computeGroupScore(files: string[], scoreMap: Map<string, number>): number;
export declare function buildHealthGrouping(files: string[], resolveOwner: (filePath: string) => string, scoreMap: Map<string, number>, lineCountMap: Map<string, number>): HealthGrouping;
//# sourceMappingURL=health-grouping.d.ts.map