export declare function isTestPath(filePath: string): boolean;
export interface NormalizationMaxima {
    maxWeightedCommits: number;
    maxComplexityDensity: number;
}
export declare function computeNormalizationMaxima(files: Array<{
    weightedCommits: number;
    complexityDensity: number;
}>, percentile?: number): NormalizationMaxima;
export declare function normalizeHotspotScore(rawChurn: number, rawComplexity: number, maxima: NormalizationMaxima): number;
//# sourceMappingURL=hotspot-utils.d.ts.map