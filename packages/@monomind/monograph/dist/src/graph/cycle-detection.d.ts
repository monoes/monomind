export interface CycleGroup {
    files: string[];
    length: number;
}
export declare function findCycles(fileIds: number[], edges: Map<number, number[]>, idToPath: Map<number, string>, skipTypeOnly?: boolean, typeOnlyEdges?: Set<string>): CycleGroup[];
//# sourceMappingURL=cycle-detection.d.ts.map