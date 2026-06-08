export interface RawInstance {
    fileId: number;
    offset: number;
}
export interface RawGroup {
    instances: RawInstance[];
    lcpLength: number;
}
export declare function extractCloneGroups(sa: number[], lcp: number[], fileOf: number[], fileOffsets: number[], minTokens: number, focusFileIds?: Set<number>): RawGroup[];
//# sourceMappingURL=extraction.d.ts.map