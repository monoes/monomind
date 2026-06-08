export type ActionKind = 'delete-file' | 'remove-export' | 'remove-export-type' | 'export-type' | 'remove-dependency' | 'remove-dev-dependency' | 'add-suppression' | 'remove-class-member' | 'remove-enum-member';
export interface JsonAction {
    kind: ActionKind;
    filePath: string;
    line?: number;
    col?: number;
    symbol?: string;
    packageName?: string;
    suppressionKind?: string;
}
export interface JsonIssueWithActions<T> {
    issue: T;
    actions: JsonAction[];
    docsUrl?: string;
}
export declare function makeDeleteFileAction(filePath: string): JsonAction;
export declare function makeRemoveExportAction(filePath: string, symbol: string, line: number, col: number): JsonAction;
export declare function makeExportTypeAction(filePath: string, symbol: string, line: number, col: number): JsonAction;
export declare function makeRemoveDependencyAction(packageName: string, isDev: boolean): JsonAction;
export declare function makeAddSuppressionAction(filePath: string, line: number, suppressionKind: string): JsonAction;
export declare function buildDocsUrl(issueKind: string): string;
export declare function buildActionsForUnusedFile(filePath: string): JsonAction[];
export declare function buildActionsForUnusedExport(filePath: string, exportName: string, line: number, col: number, isTypeOnly: boolean): JsonAction[];
export declare function buildActionsForUnusedDep(packageName: string, isDev: boolean): JsonAction[];
//# sourceMappingURL=json-actions.d.ts.map