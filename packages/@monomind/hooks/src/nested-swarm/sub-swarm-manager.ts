/**
 * SubSwarmManager — Task 44
 *
 * Manages the lifecycle of nested sub-swarm conversations:
 * spawning, message routing, summary generation, and completion.
 */

import type { NestedSwarmConfig, NestedSwarmResult, LlmCallFn } from './types.js';
import { NestedSwarmEnvelope } from './nested-swarm-envelope.js';
import { SummaryGenerator } from './summary-generator.js';

export class SubSwarmManager {
  private envelopes = new Map<string, NestedSwarmEnvelope>();
  private configs = new Map<string, NestedSwarmConfig>();
  private startTimes = new Map<string, number>();

  /**
   * Spawn a new nested sub-swarm and return its ID.
   */
  async spawn(config: NestedSwarmConfig): Promise<string> {
    const envelope = new NestedSwarmEnvelope(config.parentSwarmId, config.task);
    const id = envelope.subSwarmId;

    this.envelopes.set(id, envelope);
    this.configs.set(id, config);
    this.startTimes.set(id, Date.now());

    return id;
  }

  /**
   * Get the result for a sub-swarm (without raw messages).
   * Returns null if the subSwarmId is unknown.
   */
  getResult(subSwarmId: string): NestedSwarmResult | null {
    const envelope = this.envelopes.get(subSwarmId);
    if (!envelope) return null;
    return envelope.toResult();
  }

  /**
   * Get the envelope for a sub-swarm (for adding messages).
   * Returns null if the subSwarmId is unknown.
   */
  getEnvelope(subSwarmId: string): NestedSwarmEnvelope | null {
    return this.envelopes.get(subSwarmId) ?? null;
  }

  /**
   * Generate a summary and mark the sub-swarm as completed.
   */
  async completeSubSwarm(subSwarmId: string, llmCall?: LlmCallFn): Promise<void> {
    const envelope = this.envelopes.get(subSwarmId);
    if (!envelope) {
      throw new Error(`Unknown sub-swarm: ${subSwarmId}`);
    }

    const startTime = this.startTimes.get(subSwarmId) ?? Date.now();
    const elapsedMs = Date.now() - startTime;
    const config = this.configs.get(subSwarmId);

    const summary = await SummaryGenerator.generate(
      subSwarmId,
      envelope.getRawMessages(),
      elapsedMs,
      config?.summaryPrompt,
      llmCall,
    );

    envelope.setSummary(summary);
    envelope.complete();
  }

  /**
   * Mark a sub-swarm as failed.
   */
  failSubSwarm(subSwarmId: string, error: string): void {
    const envelope = this.envelopes.get(subSwarmId);
    if (!envelope) {
      throw new Error(`Unknown sub-swarm: ${subSwarmId}`);
    }
    envelope.fail(error);
  }
}

/** Singleton instance for global use. */
export const subSwarmManager = new SubSwarmManager();
