export interface ShingleFilter {
    add(id: string, tokens: string[]): void;
    candidates(tokens: string[], topK?: number): string[];
}
export declare function createShingleFilter(k?: number, numHashes?: number): ShingleFilter;
//# sourceMappingURL=shingle-filter.d.ts.map