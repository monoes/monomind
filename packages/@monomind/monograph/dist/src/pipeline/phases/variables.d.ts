import type { MonographNode } from '../../types.js';
export interface VariableInfo {
    name: string;
    isExported: boolean;
    line: number;
    filePath: string;
}
export declare function extractVariables(source: string, filePath: string): VariableInfo[];
export declare function variableToNode(v: VariableInfo): MonographNode;
//# sourceMappingURL=variables.d.ts.map