export interface ExportFix {
    filePath: string;
    exportName: string;
    lineNumber: number;
    fixType: 'remove-export-keyword' | 'remove-entire-declaration';
}
export interface FixResult {
    filePath: string;
    fixesApplied: number;
    dryRun: boolean;
    diff: string[];
}
export declare function fixUnusedExports(fixes: ExportFix[], options?: {
    dryRun?: boolean;
}): FixResult[];
//# sourceMappingURL=exports.d.ts.map