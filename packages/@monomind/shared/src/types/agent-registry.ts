/**
 * Central Agent Registry Types (Task 30)
 *
 * Interfaces for the agent registry that catalogs all agent definitions
 * with their capabilities, task types, tools, and trigger patterns.
 */

/**
 * A trigger pattern that activates a micro-agent automatically.
 */
export interface TriggerPattern {
  /** Glob or regex pattern string */
  pattern: string;
  /** How the pattern is interpreted */
  mode: 'glob' | 'regex' | 'prefix' | 'exact';
}

/**
 * A single agent entry in the registry.
 */
export interface AgentRegistryEntry {
  /** Unique identifier derived from filename (e.g. "coder", "security-auditor") */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Semantic version string (e.g. "1.0.0") */
  version: string;
  /** Category derived from parent directory (e.g. "core", "specialized") */
  category: string;
  /** List of capabilities this agent provides */
  capabilities: string[];
  /** Task types this agent can handle */
  taskTypes: string[];
  /** Tools this agent has access to */
  tools: string[];
  /** Trigger patterns for micro-agent activation */
  triggers: TriggerPattern[];
  /** Whether this agent definition is deprecated */
  deprecated: boolean;
  /** Slug of the agent that replaces this one */
  deprecatedBy?: string;
  /** Slugs of other agents this agent depends on */
  dependencies: string[];
  /** Absolute or relative path to the source .md file */
  filePath: string;
  /** ISO-8601 timestamp when the agent was first registered */
  registeredAt: string;
  /** ISO-8601 timestamp of the last update */
  lastUpdated: string;
}

/**
 * The full agent registry structure.
 */
export interface AgentRegistry {
  /** Registry schema version */
  version: string;
  /** ISO-8601 timestamp when the registry was generated */
  generatedAt: string;
  /** Total number of agents in the registry */
  totalAgents: number;
  /** All registered agent entries */
  agents: AgentRegistryEntry[];
}
