/**
 * Q&A memory feedback loop.
 *
 * Mirrors graphify's `save_query_result`: saves question/answer pairs as
 * Markdown files with YAML front-matter into a memory directory.  On the next
 * rebuild those files are treated as document nodes, so the graph grows smarter
 * from both what you add AND what you ask.
 *
 * Intended for use after `monographQuery` / `monographExplain` calls so that
 * insights are persisted and available during future pipeline runs.
 */
export interface SaveQueryResultOptions {
    /** Question / query string. */
    question: string;
    /** Answer produced by the graph query. */
    answer: string;
    /**
     * Directory where memory files are written.
     * Defaults to `<cwd>/monograph-out/memory`.
     */
    memoryDir?: string;
    /** Free-form query type label (e.g. "query", "explain", "impact"). Default: "query". */
    queryType?: string;
    /**
     * Up to 10 node ids / names that were the primary sources for the answer.
     * These are stored in front-matter so a future extraction pass can wire up
     * edges to the originating nodes.
     */
    sourceNodes?: string[];
}
export interface SaveQueryResultOutput {
    /** Absolute path of the written Markdown file. */
    filePath: string;
    /** ISO-8601 timestamp of when the file was written. */
    writtenAt: string;
}
/**
 * Save a Q&A query result as a Markdown file in the memory directory.
 *
 * The file has YAML front-matter that monograph's document extractor reads
 * as node metadata.  The body contains the question and answer in a
 * human-readable format.
 *
 * @param options - Query options including question, answer, and target dir.
 * @returns The file path and write timestamp.
 */
export declare function saveQueryResult(options: SaveQueryResultOptions): SaveQueryResultOutput;
//# sourceMappingURL=query-memory.d.ts.map