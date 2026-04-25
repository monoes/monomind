/**
 * ConversationThread — an isolated message thread between two agents
 * with token budget enforcement and oldest-first eviction.
 * @packageDocumentation
 */

import { randomBytes } from 'crypto';
import type { AgentId, Message, ThreadStats } from './types.js';

export class ConversationThread {
  readonly fromAgentId: AgentId;
  readonly toAgentId: AgentId;
  readonly threadKey: string;

  private messages: Message[] = [];
  private maxTokens = 32_000;
  private createdAt: Date;
  private lastActivityAt: Date;

  constructor(fromAgentId: AgentId, toAgentId: AgentId, threadKey?: string) {
    this.fromAgentId = fromAgentId;
    this.toAgentId = toAgentId;
    this.threadKey = threadKey ?? `${fromAgentId}:${toAgentId}`;
    this.createdAt = new Date();
    this.lastActivityAt = this.createdAt;
  }

  /** Update the token budget for this thread. */
  setMaxTokens(max: number): void {
    this.maxTokens = max;
  }

  /** Approximate token count for a content string (~4 chars per token). */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /** Total estimated tokens across all messages in the thread. */
  private totalTokens(): number {
    let sum = 0;
    for (const m of this.messages) {
      sum += this.estimateTokens(m.content);
    }
    return sum;
  }

  /**
   * Send a message into the thread. Evicts oldest non-system messages
   * when the token budget would be exceeded.
   */
  send(content: string, role: Message['role'] = 'user'): Message {
    const message: Message = {
      messageId: randomBytes(16).toString('hex'),
      fromAgentId: this.fromAgentId,
      toAgentId: this.toAgentId,
      content,
      role,
      timestamp: new Date(),
    };

    this.messages.push(message);
    this.lastActivityAt = message.timestamp;

    // Evict oldest non-system messages until under budget.
    // Never evict the message we just appended (last in the array).
    while (this.totalTokens() > this.maxTokens) {
      const lastIdx = this.messages.length - 1;
      const idx = this.messages.findIndex((m, i) => i !== lastIdx && m.role !== 'system');
      if (idx === -1) break; // only the new message (+ system) left, stop
      this.messages.splice(idx, 1);
    }

    return message;
  }

  /** Return a copy of the message history in chronological order. */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /** Return statistics about this thread. */
  getStats(): ThreadStats {
    return {
      threadKey: this.threadKey,
      messageCount: this.messages.length,
      totalTokensEstimate: this.totalTokens(),
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  /** Remove all messages from the thread. */
  clear(): void {
    this.messages = [];
  }
}
