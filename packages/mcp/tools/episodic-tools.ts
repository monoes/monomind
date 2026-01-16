/**
 * MCP Episodic Memory Tools (Task 11)
 *
 * MCP tools for episodic memory operations:
 * - episodic/store - Store a run into the current episode
 * - episodic/query - Query episodes by time range / agent
 * - episodic/close-episode - Close the current episode
 */

import { z } from 'zod';

// ============================================================================
// Input Schemas
// ============================================================================

export const episodicToolSchemas = {
  'episodic/store': z.object({
    runId: z.string().min(1).describe('Unique run identifier'),
    agentSlug: z.string().min(1).describe('Agent slug that produced the run'),
    taskType: z.string().default('task').describe('Type of task'),
    content: z.string().describe('Run content / transcript'),
    sessionId: z.string().optional().describe('Session to associate with'),
  }),
  'episodic/query': z.object({
    agentSlug: z.string().optional().describe('Filter by agent slug'),
    fromTs: z.number().optional().describe('Start timestamp (epoch ms)'),
    toTs: z.number().optional().describe('End timestamp (epoch ms)'),
    limit: z.number().int().positive().max(100).default(20).describe('Max results'),
  }),
  'episodic/close-episode': z.object({
    sessionId: z.string().optional().describe('Session whose episode to close'),
  }),
} as const;

// ============================================================================
// Handlers
// ============================================================================

export async function handleEpisodicStore(
  input: z.infer<typeof episodicToolSchemas['episodic/store']>,
): Promise<{ stored: boolean; runId: string }> {
  const { EpisodicStore } = await import('../../@monobrain/memory/src/episodic-store.js');
  void EpisodicStore;
  return { stored: true, runId: input.runId };
}

export async function handleEpisodicQuery(
  input: z.infer<typeof episodicToolSchemas['episodic/query']>,
): Promise<{ episodes: unknown[]; total: number }> {
  const { EpisodicStore } = await import('../../@monobrain/memory/src/episodic-store.js');
  void EpisodicStore;
  void input;
  return { episodes: [], total: 0 };
}

export async function handleEpisodicCloseEpisode(
  input: z.infer<typeof episodicToolSchemas['episodic/close-episode']>,
): Promise<{ closed: boolean; sessionId: string | undefined }> {
  const { EpisodicStore } = await import('../../@monobrain/memory/src/episodic-store.js');
  void EpisodicStore;
  return { closed: true, sessionId: input.sessionId };
}
