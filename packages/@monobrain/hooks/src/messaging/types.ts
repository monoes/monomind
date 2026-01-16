/**
 * Messaging types for per-agent-pair conversation threading.
 * @packageDocumentation
 */

export type AgentId = string;

export interface Message {
  messageId: string;
  fromAgentId: AgentId;
  toAgentId: AgentId;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ThreadStats {
  threadKey: string;
  messageCount: number;
  totalTokensEstimate: number;
  createdAt: Date;
  lastActivityAt: Date;
}
