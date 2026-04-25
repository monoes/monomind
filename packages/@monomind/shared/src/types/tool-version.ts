/**
 * Tool Versioning Types (Task 31)
 *
 * Interfaces for semver versioning on MCP tools with deprecation
 * warnings and tool-to-agent impact analysis.
 */

/**
 * A versioned MCP tool entry with deprecation metadata.
 */
export interface VersionedMCPTool {
  /** Tool identifier (e.g. "memory_search", "swarm_init") */
  toolName: string;
  /** Semantic version string (e.g. "1.2.0") */
  version: string;
  /** Whether this tool is deprecated */
  deprecated: boolean;
  /** Human-readable deprecation message */
  deprecationMessage?: string;
  /** Tool name that replaces this one */
  successor?: string;
  /** ISO 8601 timestamp when the tool was added */
  addedAt: string;
  /** ISO 8601 timestamp when the tool was deprecated */
  deprecatedAt?: string;
}

/**
 * A single entry in the tool version history log.
 */
export interface ToolVersionEntry {
  /** Tool identifier */
  toolName: string;
  /** Semantic version at time of change */
  version: string;
  /** Type of change recorded */
  changeType: 'added' | 'updated' | 'deprecated' | 'removed';
  /** ISO 8601 timestamp of the change */
  changedAt: string;
  /** Optional description of the change */
  description?: string;
}
