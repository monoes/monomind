/**
 * MicroAgent Trigger Types (Task 32)
 *
 * Defines regex-based trigger patterns that auto-match task descriptions
 * to specialist agents, with inject/takeover modes.
 */

/**
 * A single trigger pattern bound to an agent.
 */
export interface TriggerPattern {
  /** ECMAScript regex string, e.g. "\\b(auth|jwt)\\b" */
  pattern: string;
  /** inject = add to candidates; takeover = replace all candidates */
  mode: 'inject' | 'takeover';
  /** Higher priority patterns are checked first (descending order) */
  priority: number;
  /** Slug of the agent that owns this trigger */
  agentSlug: string;
}

/**
 * Result of a single pattern matching against a task description.
 */
export interface TriggerMatch {
  agentSlug: string;
  pattern: string;
  mode: 'inject' | 'takeover';
  /** The substring that triggered the match */
  matchedText: string;
}

/**
 * Serialisable index of all trigger patterns, built by scanning agent definitions.
 */
export interface TriggerIndex {
  patterns: TriggerPattern[];
  /** ISO-8601 timestamp when the index was built */
  builtAt: string;
  /** Number of agent files scanned to produce this index */
  totalAgentsScanned: number;
}
