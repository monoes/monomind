import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
export interface ParseOutput {
    symbolNodes: MonographNode[];
    allEdges: MonographEdge[];
    parseErrors: string[];
    fileContents: Map<string, string>;
}
export declare const parsePhase: PipelinePhase<ParseOutput>;
export declare function extractCsharpNamespaces(source: string, filePath: string): Array<{
    name: string;
    label: 'Namespace';
    filePath: string;
    line: number;
}>;
export declare function extractArrowFunctions(source: string, filePath: string): Array<{
    name: string;
    isExported: boolean;
    line: number;
    filePath: string;
}>;
//# sourceMappingURL=parse.d.ts.map