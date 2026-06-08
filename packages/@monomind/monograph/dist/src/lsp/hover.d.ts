import type { LspRange } from './code-lens.js';
export interface MonographHover {
    contents: string;
    range?: LspRange;
}
export interface UnusedExportInfo {
    exportName: string;
    line: number;
    col: number;
    referenceCount: number;
    suppressionHint?: string;
}
export interface DuplicationInfo {
    line: number;
    col: number;
    groupSize: number;
    instanceCount: number;
    similarityScore: number;
}
export declare function buildHover(unusedExports: UnusedExportInfo[], duplication: DuplicationInfo[], position: {
    line: number;
    character: number;
}, // 0-based LSP
filePath: string): MonographHover | null;
//# sourceMappingURL=hover.d.ts.map