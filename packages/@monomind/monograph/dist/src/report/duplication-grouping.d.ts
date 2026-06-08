export interface DuplicationGroupEntry {
    groupId: number;
    owner: string;
    filePaths: string[];
    duplicatedLines: number;
    instances: number;
}
export interface DuplicationGrouping {
    groups: DuplicationGroupEntry[];
    totalDuplicatedLines: number;
    totalInstances: number;
    ownerCount: number;
}
export interface CloneGroupInput {
    id: number;
    instances: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
    }>;
    duplicatedLines: number;
}
export type OwnerResolver = (filePath: string) => string;
/** Default resolver: uses the immediate parent directory as the owner. */
export declare function defaultOwnerResolver(filePath: string): string;
export declare function buildDuplicationGrouping(groups: CloneGroupInput[], resolver?: OwnerResolver): DuplicationGrouping;
export declare function formatDuplicationGrouping(grouping: DuplicationGrouping): string;
//# sourceMappingURL=duplication-grouping.d.ts.map