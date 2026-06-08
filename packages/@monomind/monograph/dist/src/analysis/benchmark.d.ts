import type Database from 'better-sqlite3';
export declare function estimateTokens(text: string): number;
export interface BenchmarkOptions {
    corpusWordCount?: number;
    questions?: string[];
    depth?: number;
}
export interface PerQuestionResult {
    question: string;
    query_tokens: number;
    reduction: number;
}
export interface BenchmarkResult {
    corpus_tokens: number;
    corpus_words: number;
    nodes: number;
    edges: number;
    avg_query_tokens: number;
    reduction_ratio: number;
    per_question: PerQuestionResult[];
}
export declare function runBenchmark(db: Database.Database, options?: BenchmarkOptions): BenchmarkResult;
//# sourceMappingURL=benchmark.d.ts.map