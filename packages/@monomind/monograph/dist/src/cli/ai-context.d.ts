/**
 * AI Context Injection
 *
 * Injects a natural-language description of monograph capabilities into
 * AGENTS.md and/or CLAUDE.md so AI agents (Claude Code, Cursor, Windsurf,
 * Copilot, Cline, etc.) understand how and when to use monograph tools.
 *
 * This is distinct from setup.ts which injects MCP server connection config.
 * Here the goal is agent comprehension: what monograph does, which tools to
 * call, and under what conditions — written in imperative prose that models
 * follow reliably.
 */
export type AiContextTarget = 'claude' | 'agents-md';
export interface AiContextOptions {
    /** Absolute path to the repository root */
    repoPath: string;
    /** Which files to update. Defaults to both. */
    targets?: AiContextTarget[];
}
export interface AiContextResult {
    /** Files that were written or updated */
    updated: string[];
    /** Files skipped because the block was already present */
    skipped: string[];
    /** Files that could not be written (with reason) */
    errors: string[];
}
/**
 * Inject a natural-language monograph capabilities description into
 * AGENTS.md and/or CLAUDE.md so AI agents know how to use monograph tools.
 *
 * Running multiple times is safe: existing blocks are replaced in-place
 * (so the content stays current) and unchanged files are reported as skipped.
 *
 * @example
 * const result = await injectAiContext({ repoPath: '/path/to/repo' });
 * console.log(result.updated); // ['CLAUDE.md', 'AGENTS.md']
 */
export declare function injectAiContext(options: AiContextOptions): Promise<AiContextResult>;
//# sourceMappingURL=ai-context.d.ts.map