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
  /** Git access level: 'none' blocks all git, 'read' allows status/log/diff,
   *  'commit' allows add/commit, 'push' allows push. Default: 'read'. */
  git: z.enum(['none', 'read', 'commit', 'push']).default('read'),
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
    /** Where role sessions run.
     *  'repo' (default) — the project root, so roles can Read/Edit real files.
     *  'isolated' — a scratch dir under .monomind/orgs/<name>/workspace, which the
     *  policy engine's workdir check then confines every path to.
     *  An absolute path is used verbatim. */
    workspace: z.union([z.literal('repo'), z.literal('isolated'), z.literal('worktree'), z.literal('worktree-per-role'), z.string()]).optional(),
    /** Circuit breaker: after N consecutive non-success session results from
     *  a role, trip the circuit and close the role's mailbox instead of looping. */
    circuit_breaker: z.object({
      failure_threshold: z.number().int().positive().default(5),
      cooldown_ms: z.number().int().nonnegative().default(0),
    }).partial().optional(),
    /** Stale-base drift detection: warn (or refuse) when the working tree is
     *  too many commits behind its tracking branch. 0 disables. */
    stale_base_threshold: z.number().int().nonnegative().default(0),
    /** Precondition checks: shell commands that must exit 0 before a scheduled
     *  run starts. If any fail, the run is skipped and the failure logged. */
    prechecks: z.array(z.object({
      name: z.string(),
      command: z.string(),
    })).optional(),
  }).partial().passthrough().default({})
    .transform(rc => ({ max_concurrent_agents: 4, budget_tokens: 1_000_000, max_turns_per_message: 30, workspace: 'repo' as string, stale_base_threshold: 0, ...rc })),
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
  type: 'message' | 'xorg' | 'tool' | 'asset' | 'chat' | 'status' | 'audit' | 'usage' | 'question' | 'gate';
  from?: string;
  to?: string;
  subject?: string;
  msg?: string;
  tool?: string;
  decision?: 'allow' | 'deny';
  reason?: string;
  path?: string;
  data?: Record<string, unknown>;
  /** Parent event ID for message chains (e.g., a message responding to another message) */
  parentId?: string;
  /** OpenTelemetry tracing fields (optional, for distributed tracing and cost tracking) */
  conversationId?: string;
  interactionId?: string;
  agentSessionId?: string;
}

export interface DecisionGate {
  id: string;
  name: string;
  description: string;
  roleId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  resolvedBy?: string;
  resolvedAt?: number;
  resolution?: string;
}

export const ORG_DIR = '.monomind/orgs';

/**
 * Recommended org_send handoff format for inter-role communication:
 *
 * Use org_send(target_role, context_summary, next_action, files_changed, related_issues):
 *
 * - **target_role**: Role ID to receive the handoff
 * - **context_summary**: Brief status of what was done (1-2 sentences)
 * - **next_action**: What the receiver should do next (specific, actionable)
 * - **files_changed**: Array of file paths modified (if applicable)
 * - **related_issues**: Array of issue IDs or PR references (if applicable)
 *
 * Example:
 * ```json
 * {
 *   "summary": "Bug fix implemented in auth module",
 *   "next_action": "Review the fix and run tests",
 *   "files_changed": ["src/auth.ts", "tests/auth.test.ts"],
 *   "related_issues": ["#123", "PR #456"]
 * }
 * ```
 *
 * The org_send tool already passes `subject` and `message` — this format
 * documents best practice for structured handoffs between roles.
 */
