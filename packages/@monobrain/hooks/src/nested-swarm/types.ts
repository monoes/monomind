/**
 * Nested Swarm Sub-Conversations — Task 44
 *
 * Type definitions for nested swarm envelope abstraction,
 * summary generation, and lifecycle management.
 */

export type SubSwarmStatus = 'initializing' | 'running' | 'completed' | 'failed' | 'timed_out';

export interface Message {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
}

export interface NestedSwarmConfig {
  parentSwarmId: string;
  task: string;
  maxAgents: number;
  budgetUsd?: number;
  timeoutMs: number;
  summaryPrompt?: string;
  indexTranscript: boolean;
}

export interface SwarmSummary {
  summaryId: string;
  subSwarmId: string;
  text: string;
  keyFindings: string[];
  agentCount: number;
  totalMessages: number;
  elapsedMs: number;
  generatedAt: Date;
}

export interface NestedSwarmResult {
  subSwarmId: string;
  parentSwarmId: string;
  status: SubSwarmStatus;
  summary: SwarmSummary | null;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export type LlmCallFn = (systemPrompt: string, userPrompt: string) => Promise<string>;
