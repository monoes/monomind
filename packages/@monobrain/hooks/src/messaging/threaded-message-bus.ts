/**
 * ThreadedMessageBus — manages per-agent-pair conversation threads.
 *
 * Each directional pair (A->B) gets its own isolated ConversationThread
 * so messages between A->B never leak into A->C or B->A.
 * @packageDocumentation
 */

import type { AgentId, ThreadStats } from './types.js';
import { ConversationThread } from './conversation-thread.js';

export class ThreadedMessageBus {
  private threads = new Map<string, ConversationThread>();

  /** Build the directional key for a thread. */
  private static key(from: AgentId, to: AgentId): string {
    return `${from}:${to}`;
  }

  /**
   * Get (or lazily create) the directional thread from `from` to `to`.
   * The key is directional: A->B differs from B->A.
   */
  getThread(from: AgentId, to: AgentId): ConversationThread {
    const k = ThreadedMessageBus.key(from, to);
    let thread = this.threads.get(k);
    if (!thread) {
      thread = new ConversationThread(from, to, k);
      this.threads.set(k, thread);
    }
    return thread;
  }

  /**
   * Return the bidirectional pair of threads between two agents:
   * [A->B, B->A].
   */
  getPair(agentA: AgentId, agentB: AgentId): [ConversationThread, ConversationThread] {
    return [this.getThread(agentA, agentB), this.getThread(agentB, agentA)];
  }

  /**
   * Return every thread where the given agent appears as sender or receiver.
   */
  getAgentThreads(agentId: AgentId): ConversationThread[] {
    const result: ConversationThread[] = [];
    for (const [key, thread] of this.threads) {
      if (thread.fromAgentId === agentId || thread.toAgentId === agentId) {
        result.push(thread);
      }
    }
    return result;
  }

  /**
   * Clear and remove every thread that involves the given agent.
   */
  terminateAgent(agentId: AgentId): void {
    const keysToDelete: string[] = [];
    for (const [key, thread] of this.threads) {
      if (thread.fromAgentId === agentId || thread.toAgentId === agentId) {
        thread.clear();
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      this.threads.delete(k);
    }
  }

  /** Collect stats from every active thread. */
  getAllStats(): ThreadStats[] {
    const stats: ThreadStats[] = [];
    for (const thread of this.threads.values()) {
      stats.push(thread.getStats());
    }
    return stats;
  }

  /** Number of active threads. */
  get size(): number {
    return this.threads.size;
  }
}

/** Default singleton instance. */
export const threadedMessageBus = new ThreadedMessageBus();
