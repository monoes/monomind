export declare const CORPUS_WARN_MIN_WORDS = 50000;
export declare const CORPUS_WARN_MAX_WORDS = 500000;
export declare const CORPUS_WARN_MAX_FILES = 200;
export interface CorpusStats {
    wordCount: number;
    fileCount: number;
}
export interface CorpusHealthResult {
    healthy: boolean;
    warnings: string[];
    stats: CorpusStats;
}
export declare function checkCorpusHealth(stats: CorpusStats): CorpusHealthResult;
//# sourceMappingURL=corpus-health.d.ts.map