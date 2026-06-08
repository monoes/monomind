export interface LspPosition {
    line: number;
    character: number;
}
export interface LspRange {
    start: LspPosition;
    end: LspPosition;
}
export interface LspCommand {
    title: string;
    command: string;
    arguments?: unknown[];
}
export interface MonographCodeLens {
    range: LspRange;
    command?: LspCommand;
}
export interface ExportUsage {
    exportName: string;
    line: number;
    col: number;
    referenceLocations: Array<{
        uri: string;
        line: number;
        character: number;
    }>;
}
export declare function buildCodeLenses(usages: ExportUsage[], documentUri: string): MonographCodeLens[];
//# sourceMappingURL=code-lens.d.ts.map