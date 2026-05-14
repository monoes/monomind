/**
 * Tool Registry (Task 31)
 *
 * Manages semver versioning for MCP tools with deprecation tracking
 * and tool-to-agent impact analysis. Uses JSONL file storage.
 */
import type { VersionedMCPTool, ToolVersionEntry } from '../../../shared/src/types/tool-version.js';
/**
 * Registry for versioned MCP tools.
 *
 * Stores tool metadata and version history in a JSONL file.
 * Supports deprecation marking and agent impact analysis.
 */
export declare class ToolRegistry {
    private tools;
    private history;
    private readonly storagePath;
    constructor(storagePath?: string);
    /**
     * Register a new tool or update an existing one.
     */
    register(tool: VersionedMCPTool): void;
    /**
     * Mark a tool as deprecated with an optional successor.
     */
    deprecate(toolName: string, message: string, successor?: string): void;
    /**
     * Get the current version info for a tool.
     * Returns null if the tool is not registered.
     */
    getVersion(toolName: string): VersionedMCPTool | null;
    /**
     * List all deprecated tools.
     */
    listDeprecated(): VersionedMCPTool[];
    /**
     * Find agents that reference the given tool.
     *
     * Scans agent markdown files under the provided agents directory
     * and returns slugs of agents whose `tools:` frontmatter or body
     * mention the tool name.
     */
    getImpactedAgents(toolName: string, agentsDir?: string): string[];
    /**
     * Get the full version history for a tool, or all tools if no name given.
     */
    getHistory(toolName?: string): ToolVersionEntry[];
    /**
     * Get all registered tools.
     */
    listAll(): VersionedMCPTool[];
    /**
     * Load existing entries from the JSONL file on disk.
     */
    private loadFromDisk;
    /**
     * Append a version history entry and the current tool state to disk.
     */
    private appendEntry;
}
//# sourceMappingURL=tool-registry.d.ts.map