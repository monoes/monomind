/**
 * Dynamic Agent Synthesis Types — Task 47
 *
 * Types for on-demand agent synthesis, ephemeral registry,
 * TTL cleanup, and agent promotion.
 */

/** Capability constraints for a synthesized agent */
export interface AgentCapability {
  sandbox: 'docker' | 'wasm' | 'none';
  planning_step?: 'required' | 'optional' | 'disabled';
  confidence_threshold?: number;
}

/** Full agent definition produced by synthesis */
export interface AgentDefinition {
  slug: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
  tools: string[];
  systemPromptBody: string;
  capability?: AgentCapability;
  tags: string[];
  synthesizedFrom: string;
  synthesizedAt: Date;
}

/** Request to synthesize a new agent */
export interface SynthesisRequest {
  requestId: string;
  taskDescription: string;
  topMatchSlug: string;
  topMatchScore: number;
  existingAgentCount: number;
  requestedAt: Date;
}

/** Registry record for an ephemeral (time-limited) agent */
export interface EphemeralAgentRecord {
  slug: string;
  filePath: string;
  createdAt: Date;
  expiresAt: Date;
  usageCount: number;
  avgQualityScore: number;
  promoted: boolean;
  synthesisRequestId: string;
}

/** Result returned by TTL cleanup */
export interface CleanupResult {
  deletedCount: number;
  deletedSlugs: string[];
  skippedPromoted: number;
  orphansFound: number;
}
