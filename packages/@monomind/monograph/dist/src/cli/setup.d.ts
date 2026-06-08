/**
 * setupMonograph — Writes monograph MCP server configuration into AI tool
 * config files (CLAUDE.md, AGENTS.md, .cursor/mcp.json) for a given repo.
 *
 * Running it multiple times is idempotent: if the config block is already
 * present the file is left unchanged.
 */
export type SetupTool = 'claude' | 'cursor' | 'agents-md';
export interface SetupOptions {
    /** Absolute path to the repository root */
    repoPath: string;
    /** Which tool configs to write. Defaults to all three. */
    tools?: SetupTool[];
}
export interface SetupResult {
    /** Files that were written or updated */
    configured: string[];
    /** Files that were skipped because the config was already present */
    skipped: string[];
    /** Errors encountered (file not written) */
    errors: string[];
}
/**
 * Write the monograph MCP server configuration into AI tool config files.
 *
 * @param repoPath  - Absolute path to the target repository root
 * @param tools     - Which tools to configure (default: all)
 * @returns         - SetupResult describing what was written / skipped / errored
 *
 * @example
 * const result = await setupMonograph({ repoPath: '/path/to/repo' });
 * console.log(result.configured); // ['CLAUDE.md', '.cursor/mcp.json', 'AGENTS.md']
 */
export declare function setupMonograph(options: SetupOptions): Promise<SetupResult>;
//# sourceMappingURL=setup.d.ts.map