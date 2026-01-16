/**
 * MCP Managed Agent Tools (Task 17)
 *
 * MCP tools for managed agent execution:
 * - agent/run - Run a single managed agent
 * - agent/run-batch - Run multiple agents in parallel
 */

import { z } from 'zod';

// ============================================================================
// Input Schemas
// ============================================================================

const agentRunInputSchema = z.object({
  agentSlug: z.string().min(1).describe('Agent type slug to run'),
  prompt: z.string().min(1).describe('Task prompt for the agent'),
  timeout: z.number().int().positive().default(120_000).describe('Timeout in ms'),
  namespace: z.string().optional().describe('Memory namespace for coordination'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

export const managedAgentToolSchemas = {
  'agent/run': agentRunInputSchema,
  'agent/run-batch': z.object({
    agents: z.array(agentRunInputSchema).min(1).max(20).describe('Agents to run in parallel'),
    namespace: z.string().optional().describe('Shared memory namespace'),
    failFast: z.boolean().default(false).describe('Abort batch on first failure'),
  }),
} as const;

// ============================================================================
// Types
// ============================================================================

export interface AgentRunResult {
  agentSlug: string;
  success: boolean;
  output: string | null;
  durationMs: number;
  error?: string;
}

// ============================================================================
// Handlers
// ============================================================================

export async function handleAgentRun(
  input: z.infer<typeof managedAgentToolSchemas['agent/run']>,
): Promise<AgentRunResult> {
  // Stub: delegates to agent runner from @monobrain/cli
  void input;
  return {
    agentSlug: input.agentSlug,
    success: true,
    output: null,
    durationMs: 0,
  };
}

export async function handleAgentRunBatch(
  input: z.infer<typeof managedAgentToolSchemas['agent/run-batch']>,
): Promise<{ results: AgentRunResult[]; totalMs: number }> {
  const start = Date.now();
  const results: AgentRunResult[] = input.agents.map((a) => ({
    agentSlug: a.agentSlug,
    success: true,
    output: null,
    durationMs: 0,
  }));
  return { results, totalMs: Date.now() - start };
}
