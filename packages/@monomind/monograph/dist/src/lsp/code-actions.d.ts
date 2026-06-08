import type { LspRange } from './code-lens.js';
export interface LspTextEdit {
    range: LspRange;
    newText: string;
}
export interface LspWorkspaceEdit {
    changes: Record<string, LspTextEdit[]>;
}
export interface CodeAction {
    title: string;
    kind: 'quickfix' | 'refactor';
    diagnostics?: string[];
    edit?: LspWorkspaceEdit;
    isPreferred?: boolean;
}
export interface UnusedExportLocation {
    exportName: string;
    filePath: string;
    uri: string;
    line: number;
    col: number;
}
export type ExportKeywordVariant = 'export' | 'export default' | 'export const' | 'export function' | 'export class' | 'export type' | 'export interface' | 'export enum';
export declare function buildRemoveExportActions(unusedExports: UnusedExportLocation[], cursorLine: number, // 0-based LSP
fileLines: string[], maxActionsPerFile?: number): CodeAction[];
export declare function buildSuppressActions(unusedExports: UnusedExportLocation[], cursorLine: number, // 0-based LSP
fileLines: string[]): CodeAction[];
export interface DeleteFileAction {
    kind: 'deleteFile';
    title: string;
    filePath: string;
    isPreferred: boolean;
}
export declare function buildDeleteFileActions(filePath: string): DeleteFileAction[];
//# sourceMappingURL=code-actions.d.ts.map