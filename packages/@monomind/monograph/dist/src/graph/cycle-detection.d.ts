export interface CycleGroup {
    files: string[];
    length: number;
}
export declare function findCycles(fileIds: number[], edges: Map<number, number[]>, idToPath: Map<number, string>, skipTypeOnly?: boolean, typeOnlyEdges?: Set<string>): CycleGroup[];
/** Format cycle groups as structured text for LLM consumption. */
export declare function formatCycleGroups(groups: CycleGroup[]): string;
//# sourceMappingURL=cycle-detection.d.ts.map