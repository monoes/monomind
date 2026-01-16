/**
 * MCP Replay Tools (Task 14)
 *
 * MCP tools for session replay:
 * - replay/get-session - Retrieve a recorded session by id
 * - replay/list-sessions - List available recorded sessions
 */

import { z } from 'zod';

// ============================================================================
// Input Schemas
// ============================================================================

export const replayToolSchemas = {
  'replay/get-session': z.object({
    sessionId: z.string().min(1).describe('Session identifier to replay'),
    includeTranscripts: z.boolean().default(false).describe('Include full transcripts'),
  }),
  'replay/list-sessions': z.object({
    limit: z.number().int().positive().max(100).default(20).describe('Max results'),
    offset: z.number().int().nonnegative().default(0).describe('Pagination offset'),
    agentSlug: z.string().optional().describe('Filter by agent slug'),
    fromTs: z.number().optional().describe('Start timestamp (epoch ms)'),
    toTs: z.number().optional().describe('End timestamp (epoch ms)'),
  }),
} as const;

// ============================================================================
// Handlers
// ============================================================================

export interface ReplaySession {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  agentSlugs: string[];
  taskCount: number;
  transcript?: string;
}

export async function handleReplayGetSession(
  input: z.infer<typeof replayToolSchemas['replay/get-session']>,
): Promise<{ session: ReplaySession | null }> {
  // Stub: delegates to session replay store
  void input;
  return { session: null };
}

export async function handleReplayListSessions(
  input: z.infer<typeof replayToolSchemas['replay/list-sessions']>,
): Promise<{ sessions: ReplaySession[]; total: number }> {
  void input;
  return { sessions: [], total: 0 };
}
