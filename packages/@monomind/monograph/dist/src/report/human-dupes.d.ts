import type { PipelineDuplicationStats } from '../duplicates/detect/statistics.js';
export interface HumanDupesOptions {
    maxGroups?: number;
    showSnippets?: boolean;
}
export interface CloneInstance {
    filePath: string;
    startLine: number;
    endLine: number;
}
export interface CloneGroup {
    id: number;
    instances: CloneInstance[];
    duplicatedLines: number;
}
export interface CloneFamily {
    files: string[];
    groups: CloneGroup[];
    totalDuplicatedLines: number;
    suggestions: Array<{
        description: string;
    }>;
}
export declare function formatCloneGroup(group: CloneGroup, idx: number): string[];
export declare function buildDuplicationHumanLines(stats: PipelineDuplicationStats, groups: CloneGroup[], opts?: HumanDupesOptions): string[];
export declare function buildDuplicationFamilyLines(families: CloneFamily[], opts?: HumanDupesOptions): string[];
//# sourceMappingURL=human-dupes.d.ts.map