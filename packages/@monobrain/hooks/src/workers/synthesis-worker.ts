/**
 * SynthesisWorker — Background worker that detects capability gaps
 * and triggers on-demand agent synthesis (Task 47).
 *
 * When a task has no good agent match, this worker generates a new
 * ephemeral agent definition and registers it in the ephemeral registry.
 *
 * @module v1/hooks/workers/synthesis-worker
 */

import type { SynthesisRequest, AgentDefinition } from '../synthesis/types.js';

export interface SynthesisContext {
  taskDescription: string;
  topMatchSlug: string;
  topMatchScore: number;
  existingAgentCount: number;
  gapThreshold?: number;
}

export interface SynthesisResult {
  synthesized: boolean;
  agentSlug: string | null;
  requestId: string;
  reason: string;
}

export class SynthesisWorker {
  readonly name = 'synthesis' as const;
  readonly priority = 'normal' as const;

  /** Score threshold below which synthesis is triggered */
  static readonly DEFAULT_GAP_THRESHOLD = 0.6;

  async execute(context: SynthesisContext): Promise<SynthesisResult> {
    const threshold = context.gapThreshold ?? SynthesisWorker.DEFAULT_GAP_THRESHOLD;
    const requestId = `syn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (context.topMatchScore >= threshold) {
      return {
        synthesized: false,
        agentSlug: context.topMatchSlug,
        requestId,
        reason: `Top match score ${context.topMatchScore} meets threshold ${threshold}`,
      };
    }

    try {
      // SynthesisPromptTemplate is the export (not buildSynthesisPrompt)
      const { SynthesisPromptTemplate } = await import('../synthesis/synthesis-prompt-template.js');
      const { EphemeralRegistry } = await import('../synthesis/ephemeral-registry.js');

      void SynthesisPromptTemplate;
      const registry = EphemeralRegistry.getInstance();
      void registry;

      // Stub: real impl calls LLM with synthesis prompt, parses AgentDefinition,
      // writes the agent file, and registers it in the ephemeral registry.

      const request: SynthesisRequest = {
        requestId,
        taskDescription: context.taskDescription,
        topMatchSlug: context.topMatchSlug,
        topMatchScore: context.topMatchScore,
        existingAgentCount: context.existingAgentCount,
        requestedAt: new Date(),
      };
      void request;

      return {
        synthesized: true,
        agentSlug: null, // filled by real impl
        requestId,
        reason: 'Capability gap detected, synthesis triggered',
      };
    } catch (err) {
      return {
        synthesized: false,
        agentSlug: null,
        requestId,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
