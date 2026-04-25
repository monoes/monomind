/**
 * SummaryGenerator — Task 44
 *
 * Generates a structured summary from a sub-swarm conversation
 * transcript by delegating to an injectable LLM call.
 */

import { randomBytes } from 'crypto';
import type { Message, SwarmSummary, LlmCallFn } from './types.js';

const DEFAULT_SYSTEM_PROMPT = `You are a swarm summary generator. Given a transcript of agent messages, produce a concise summary. List key findings as bullet points prefixed with "- ".`;

export class SummaryGenerator {
  /**
   * Generate a SwarmSummary from the sub-swarm transcript.
   *
   * @param subSwarmId - The sub-swarm identifier
   * @param messages - Raw transcript messages
   * @param elapsedMs - Wall-clock time the sub-swarm ran
   * @param customPrompt - Optional custom system prompt override
   * @param llmCall - Injectable LLM function (must be provided)
   */
  static async generate(
    subSwarmId: string,
    messages: Message[],
    elapsedMs: number,
    customPrompt?: string,
    llmCall?: LlmCallFn,
  ): Promise<SwarmSummary> {
    if (!llmCall) {
      throw new Error('llmCall must be provided to SummaryGenerator.generate');
    }

    const transcript = messages
      .map((m) => `[${m.fromAgentId} → ${m.toAgentId}]: ${m.content}`)
      .join('\n');

    const systemPrompt = customPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const rawResponse = await llmCall(systemPrompt, transcript);

    const keyFindings = rawResponse
      .split('\n')
      .filter((line) => /^\s*[-*]\s+/.test(line))
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim());

    const uniqueAgents = new Set<string>();
    for (const m of messages) {
      uniqueAgents.add(m.fromAgentId);
      uniqueAgents.add(m.toAgentId);
    }

    return {
      summaryId: `sum-${randomBytes(8).toString('hex')}`,
      subSwarmId,
      text: rawResponse,
      keyFindings,
      agentCount: uniqueAgents.size,
      totalMessages: messages.length,
      elapsedMs,
      generatedAt: new Date(),
    };
  }
}
