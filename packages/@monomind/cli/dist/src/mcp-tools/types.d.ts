/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */
export interface MCPToolInputSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
}
export interface MCPToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}
/**
 * Returns the effective project working directory.
 * Prefers MONOMIND_CWD (set by the install script for global/MCP installs
 * where process.cwd() may resolve to '/') over the real process.cwd().
 */
export declare function getProjectCwd(): string;
export declare function getMonomindDataRoot(cwd?: string): string;
/**
 * One-time migration for the agent/task/hive/swarm stores that historically lived
 * under `<projectCwd>/.monomind/<subpath>` (via getProjectCwd()) before being
 * consolidated onto the canonical getMonomindDataRoot() location (typically
 * `<repo>/.git/monomind/<subpath>`). Several MCP tool files (agent-tools.ts,
 * hive-mind-tools.ts, swarm-tools.ts, system-tools.ts) used to read/write the
 * legacy path directly, causing the same logical store to physically split from
 * task-tools.ts/session-tools.ts, which always used getMonomindDataRoot().
 *
 * If the canonical file is missing but the legacy file exists, copy (never move,
 * for safety) the legacy file into place so pre-existing data isn't silently
 * orphaned. Best-effort and idempotent — never throws, and it's a no-op once the
 * canonical file exists or when the two paths already coincide (e.g. no .git).
 *
 * @param canonicalPath Absolute path under getMonomindDataRoot() the tool now reads from.
 * @param legacySubpath Path relative to `.monomind/` that the tool used to read from
 *   (e.g. `join('agents', 'store.json')`).
 * @param cwd Optional project cwd override (defaults to getProjectCwd()).
 */
export declare function migrateLegacyStoreFile(canonicalPath: string, legacySubpath: string, cwd?: string): void;
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: MCPToolInputSchema;
    category?: string;
    tags?: string[];
    version?: string;
    cacheable?: boolean;
    cacheTTL?: number;
    handler: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<MCPToolResult | unknown>;
}
//# sourceMappingURL=types.d.ts.map