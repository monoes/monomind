export type RefactoringKind = 'ExtractFunction' | 'ExtractModule' | 'MergeDirectories';
export declare const MODULE_EXTRACTION_THRESHOLD_LINES = 50;
export interface RefactoringSuggestion {
    kind: RefactoringKind;
    description: string;
    estimatedLines: number;
    files: string[];
}
export interface CloneInstance {
    filePath: string;
    startLine: number;
    endLine: number;
    tokenCount?: number;
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
    suggestions: RefactoringSuggestion[];
}
export declare function groupIntoFamilies(groups: CloneGroup[]): CloneFamily[];
/** Format clone families as structured text for LLM consumption. */
export declare function formatCloneFamilies(families: CloneFamily[]): string;
export declare function cloneFamilySummary(families: CloneFamily[]): {
    totalFamilies: number;
    totalDuplicatedLines: number;
    byKind: Record<RefactoringKind, number>;
};
//# sourceMappingURL=clone-families.d.ts.map