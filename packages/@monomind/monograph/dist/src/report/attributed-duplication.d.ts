import type { CloneGroup } from '../graph/clone-families.js';
export interface AttributedInstance {
    filePath: string;
    startLine: number;
    endLine: number;
    tokenCount?: number;
    owner: string;
}
export interface AttributedCloneGroup {
    primaryOwner: string;
    tokenCount: number;
    lineCount: number;
    instances: AttributedInstance[];
}
export interface DuplicationGroup {
    key: string;
    owner?: string;
    totalDuplicatedLines: number;
    totalDuplicatedTokens: number;
    cloneGroups: AttributedCloneGroup[];
}
export interface DuplicationGrouping {
    modeLabel: string;
    groups: DuplicationGroup[];
}
export type OwnerResolver = (filePath: string) => string;
export declare function resolveOwnerFromDirectory(filePath: string, root: string): string;
export declare function largestOwner(instances: AttributedInstance[], fallback: string): string;
export declare function attributeCloneGroup(group: CloneGroup, resolveOwner: OwnerResolver): AttributedCloneGroup;
export declare function buildDuplicationGrouping(groups: CloneGroup[], resolveOwner: OwnerResolver, modeLabel: string): DuplicationGrouping;
export declare function formatDuplicationGroup(group: DuplicationGroup, root: string): string[];
//# sourceMappingURL=attributed-duplication.d.ts.map