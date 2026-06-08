import type { ModuleNode } from '../node-types.js';
export interface Edge {
    sourceIdx: number;
    targetIdx: number;
    importedName?: string;
    exportedName?: string;
    isTypeOnly: boolean;
}
export declare function propagateStarReExport(modules: ModuleNode[], edges: Edge[], edgesByTarget: Map<number, number[]>, barrelId: number, barrelIdx: number, sourceIdx: number, entryStarTargets: Set<number>): boolean;
export declare function propagateNamedReExport(modules: ModuleNode[], barrelId: number, barrelIdx: number, sourceIdx: number, importedName: string, exportedName: string, existingRefs: Set<number>): boolean;
//# sourceMappingURL=propagate.d.ts.map