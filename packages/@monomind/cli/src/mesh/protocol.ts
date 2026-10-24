import { z } from 'zod';

export const TIERS = ['session', 'subagent', 'org-role', 'external'] as const;
export type Tier = (typeof TIERS)[number];
export const PRESENCE = ['active', 'stale', 'gone'] as const;
export type Presence = (typeof PRESENCE)[number];

/** Ids become address segments, so the separator and whitespace are excluded. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const id = (max: number) => z.string().min(1).max(max).regex(SAFE_ID);
const label = z.string().trim().min(1).max(64);

const helloShape = {
  tier: z.enum(TIERS),
  runtime: label,
  pid: z.number().int().positive(),
  project: id(128),
  projectPath: z.string().min(1).max(4096),
  sessionId: id(128),
  agentId: id(128).optional(),
  alias: id(64).optional(),
  task: z.string().max(500).optional(),
  capabilities: z.array(label).max(32).default([]),
  tags: z.array(label).max(32).default([]),
  parent: z.string().max(512).optional(),
};

export const WhoFilterSchema = z.object({
  project: id(128).optional(),
  tier: z.enum(TIERS).optional(),
  status: z.enum(PRESENCE).optional(),
  capability: label.optional(),
  tag: label.optional(),
  parent: z.string().max(512).optional(),
  includeGone: z.boolean().default(false),
});
export type WhoFilter = z.infer<typeof WhoFilterSchema>;

const reqId = z.string().min(1).max(64);

export const RequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('hello'), id: reqId, ...helloShape }),
  z.object({
    op: z.literal('heartbeat'),
    id: reqId,
    addr: z.string().min(1).max(512),
    key: z.string().min(1).max(128),
    task: z.string().max(500).optional(),
  }),
  z.object({
    op: z.literal('bye'),
    id: reqId,
    addr: z.string().min(1).max(512),
    key: z.string().min(1).max(128),
  }),
  z.object({ op: z.literal('who'), id: reqId, ...WhoFilterSchema.shape }),
]);
export type Request = z.infer<typeof RequestSchema>;

export interface HelloFields {
  tier: Tier;
  runtime: string;
  pid: number;
  project: string;
  projectPath: string;
  sessionId: string;
  agentId?: string;
  alias?: string;
  task?: string;
  capabilities: string[];
  tags: string[];
  parent?: string;
}

export interface AgentInfo extends HelloFields {
  addr: string;
  status: Presence;
  lastSeen: number;
  joinedAt: number;
}

export function buildAddr(
  host: string,
  project: string,
  sessionId: string,
  agentId?: string,
): string {
  return [host, project, sessionId, ...(agentId ? [agentId] : [])].join('/');
}

export function parseAddr(
  addr: string,
): { host: string; project: string; sessionId: string; agentId?: string } | null {
  const parts = addr.split('/');
  if (parts.length < 3 || parts.length > 4 || parts.some((p) => !SAFE_ID.test(p))) return null;
  const [host, project, sessionId, agentId] = parts;
  return agentId ? { host, project, sessionId, agentId } : { host, project, sessionId };
}
