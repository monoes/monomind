export interface ConcatenationResult {
    text: number[];
    fileOf: number[];
    fileOffsets: number[];
}
export declare function concatenateWithSentinels(fileTokens: Array<{
    fileId: number;
    tokens: number[];
}>): ConcatenationResult;
//# sourceMappingURL=concatenation.d.ts.map