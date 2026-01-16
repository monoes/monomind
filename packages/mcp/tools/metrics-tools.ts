/**
 * MCP Metrics Tools (Task 13)
 *
 * MCP tools for performance metrics:
 * - metrics/latency - Record and retrieve latency measurements
 * - metrics/summary - Get aggregated metric summaries
 */

import { z } from 'zod';

// ============================================================================
// Input Schemas
// ============================================================================

export const metricsToolSchemas = {
  'metrics/latency': z.object({
    operation: z.string().min(1).describe('Operation name to measure'),
    durationMs: z.number().nonnegative().optional().describe('Duration in ms (omit to query)'),
    agentSlug: z.string().optional().describe('Agent that produced the measurement'),
    tags: z.record(z.string()).optional().describe('Arbitrary key-value tags'),
  }),
  'metrics/summary': z.object({
    operation: z.string().optional().describe('Filter by operation name'),
    agentSlug: z.string().optional().describe('Filter by agent slug'),
    windowMs: z.number().int().positive().default(3_600_000).describe('Time window in ms (default 1h)'),
  }),
} as const;

// ============================================================================
// Handlers
// ============================================================================

export async function handleMetricsLatency(
  input: z.infer<typeof metricsToolSchemas['metrics/latency']>,
): Promise<{ recorded: boolean; operation: string; durationMs?: number }> {
  // Stub: delegates to internal metrics collector
  return {
    recorded: input.durationMs !== undefined,
    operation: input.operation,
    durationMs: input.durationMs,
  };
}

export async function handleMetricsSummary(
  input: z.infer<typeof metricsToolSchemas['metrics/summary']>,
): Promise<{ summaries: Record<string, unknown>[]; windowMs: number }> {
  void input;
  return { summaries: [], windowMs: input.windowMs };
}
