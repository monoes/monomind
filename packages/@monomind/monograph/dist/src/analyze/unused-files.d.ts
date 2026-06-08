export interface UnusedFileResult {
    filePath: string;
    reason: string;
}
export interface FindUnusedFilesOptions {
    skipDeclarations?: boolean;
    skipConfig?: boolean;
    skipHtml?: boolean;
}
export declare function findUnusedFiles(allFiles: string[], reachableFiles: Set<string>, opts?: FindUnusedFilesOptions): UnusedFileResult[];
export declare function hasReachableImporter(filePath: string, importers: Map<string, Set<string>>, reachable: Set<string>): boolean;
//# sourceMappingURL=unused-files.d.ts.map