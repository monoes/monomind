export declare const MODULE_EXTRACTION_THRESHOLD = 50;
export interface RefactoringSuggestion {
    kind: 'ExtractFunction' | 'ExtractModule' | 'MergeDirectories';
    description: string;
    estimatedLines: number;
    files: string[];
}
export interface CloneFamily {
    files: string[];
    groupCount: number;
    totalDuplicatedLines: number;
    suggestions: RefactoringSuggestion[];
}
interface RawGroupInput {
    instances: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
    }>;
    duplicatedLines: number;
}
export declare function groupRawGroupsIntoFamilies(groups: RawGroupInput[]): CloneFamily[];
export {};
//# sourceMappingURL=families.d.ts.map