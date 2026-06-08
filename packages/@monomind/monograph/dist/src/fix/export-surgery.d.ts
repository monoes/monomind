export interface ExportSurgeryResult {
    modified: boolean;
    newContent: string;
    linesRemoved: number;
}
export declare function removeNameFromExportList(fileContent: string, exportName: string, line: number): ExportSurgeryResult;
export declare function removeTypeFromExportList(fileContent: string, exportName: string, line: number): ExportSurgeryResult;
export declare function promoteToTypeExport(fileContent: string, exportName: string, line: number): ExportSurgeryResult;
export declare function applyExportSurgeries(fileContent: string, surgeries: Array<{
    exportName: string;
    line: number;
    action: 'remove' | 'remove-type' | 'promote-type';
}>): ExportSurgeryResult;
//# sourceMappingURL=export-surgery.d.ts.map