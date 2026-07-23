// packages/@monomind/cli/src/orgrt/types.ts
import { z } from 'zod';

/** Per-role provider config. Default (absent) = subscription login of local Claude Code. */
export const ProviderSchema = z.object({
  kind: z.enum(['subscription', 'api-key', 'base-url', 'bedrock', 'vertex']).default('subscription'),
  /** env var NAME holding the API key (never the key itself) */
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  /** env var NAME holding the auth token for base-url providers */
  authTokenEnv: z.string().optional(),
}).strict();

export const RolePolicySchema = z.object({
  allowTools: z.array(z.string()).optional(),
  denyTools: z.array(z.string()).default([]),
  /** glob patterns relative to org cwd */
  fileWrite: z.array(z.string()).default(['**']),
  fileRead: z.array(z.string()).default(['**']),
  /** allowed domains for WebFetch/WebSearch; empty array = no web */
  webAllow: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
}).partial().passthrough();

export const RoleSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  type: z.string().default('specialist'),
  reports_to: z.string().nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  instructions_file: z.string().optional(),
  adapter_config: z.object({
    model: z.string().default('claude-sonnet-4-5'),
    max_tokens: z.number().optional(),
  }).partial().optional(),
  provider: ProviderSchema.optional(),
  policy: RolePolicySchema.optional(),
  /** Per-role override of run_config.max_turns_per_message — roles that legitimately
   *  need many more turns per message (e.g. a developer doing sequential build/fix/verify
   *  cycles) than others (e.g. docs, pm) shouldn't be forced onto one global budget. */
  max_turns_per_message: z.number().int().positive().optional(),
}).passthrough();

export const OrgDefSchema = z.object({
  name: z.string().min(1),
  goal: z.string().default(''),
  status: z.string().default('stopped'),
  schedule: z.union([z.string(), z.number(), z.null()]).default(null),
  run_config: z.object({
    max_concurrent_agents: z.number().int().positive().default(4),
    budget_tokens: z.number().int().positive().default(1_000_000),
    memory_namespace: z.string().optional(),
    max_turns_per_message: z.number().int().positive().default(30),
    /** idle watchdog window in minutes (fractions allowed); 0 disables. Default 10. */
    idle_minutes: z.number().nonnegative().optional(),
  }).partial().passthrough().default({})
    .transform(rc => ({ max_concurrent_agents: 4, budget_tokens: 1_000_000, max_turns_per_message: 30, ...rc })),
  roles: z.array(RoleSchema).min(1),
}).passthrough();

export type OrgDef = z.infer<typeof OrgDefSchema>;
export type OrgRole = z.infer<typeof RoleSchema>;
export type RolePolicy = z.infer<typeof RolePolicySchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;

/** Superset of the legacy *-threads.jsonl line shape ({type,id,run_id,ts,from,to,msg,subject}). */
export interface BusEvent {
  id: string;
  ts: number;
  org: string;
  run: string;
  type: 'message' | 'xorg' | 'tool' | 'asset' | 'chat' | 'status' | 'audit' | 'usage' | 'question';
  from?: string;
  to?: string;
  subject?: string;
  msg?: string;
  tool?: string;
  decision?: 'allow' | 'deny';
  reason?: string;
  path?: string;
  data?: Record<string, unknown>;
}

export const ORG_DIR = '.monomind/orgs';
