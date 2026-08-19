// packages/@monomind/cli/src/orgrt/types.ts
import { z } from 'zod';

export const ContextSliceSchema = z.object({ source: z.string(), summary: z.string() });
export type ContextSlice = z.infer<typeof ContextSliceSchema>;
export const ArtifactRefSchema = z.object({ path: z.string(), description: z.string().optional() });
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export const HandoffDecisionSchema = z.object({ text: z.string(), rationale: z.string().optional() });
export type HandoffDecision = z.infer<typeof HandoffDecisionSchema>;
export const OrgHandoffSchema = z.object({
  taskId: z.string().optional(),
  contextPackage: z.array(ContextSliceSchema).default([]),
  artifacts: z.array(ArtifactRefSchema).default([]),
  decisions: z.array(HandoffDecisionSchema).default([]),
  nextAction: z.string(),
});
export type OrgHandoff = z.infer<typeof OrgHandoffSchema>;

export const FailureRoutingSchema = z.object({
  retry: z.object({
    maxAttempts: z.number().int().positive(),
    backoffMs: z.array(z.number().int().nonnegative()).optional(),
  }).partial().optional(),
  fallbackAssignee: z.string().optional(),
  escalate: z.boolean().optional(),
}).partial();
export type FailureRouting = z.infer<typeof FailureRoutingSchema>;

/** Per-role provider config. Default (absent) = subscription login of local Claude Code. */
export const ProviderSchema = z.object({
  kind: z.enum([
    'subscription', 'api-key', 'base-url', 'bedrock', 'vertex', 'gemini', 'openai',
    'vercel-api-key', 'codex', 'antigravity',
  ]).default('subscription'),
  /** Which Vercel AI SDK provider to use (only when kind='vercel-api-key'). */
  vendor: z.enum([
    'openai', 'anthropic', 'google', 'xai', 'deepseek', 'glm',
    'mistral', 'groq', 'together', 'fireworks', 'cohere',
    'perplexity', 'alibaba', 'openrouter', 'ollama',
    'openai-compatible',
  ]).optional(),
  /** env var NAME holding the API key (never the key itself) */
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  /** env var NAME holding the auth token for base-url providers */
  authTokenEnv: z.string().optional(),
  /** Opt in to UsageProxyServer token accounting for runtimes whose CLI output
   *  doesn't self-report usage (currently just `runtime: 'crush'`). When true,
   *  `baseUrl` above is treated as the upstream the CLI's own provider config
   *  points at, and the runner routes its traffic through a local proxy that
   *  parses usage out of the relayed request/response bodies. No effect for
   *  runtimes that don't support it (usage-proxy.ts, crush-runner.ts). */
  usageProxy: z.boolean().optional(),
  /** Override the env var the proxied CLI reads for its base-URL override.
   *  Defaults to CrushAgentRunner's own guess (OPENAI_BASE_URL) when unset. */
  usageProxyEnvVar: z.string().optional(),
}).strict();

const THREAT_TYPES = ['prompt_injection', 'jailbreak', 'pii_exposure', 'instruction_override',
  'role_switching', 'context_manipulation', 'encoding_attack', 'data_exfiltration', 'unknown'] as const;

export const FenceAllowlistRuleSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1),
  types: z.array(z.enum(THREAT_TYPES)).default([]),
  context: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
});

export const FenceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  enablePIIDetection: z.boolean().optional(),
  scanMessages: z.boolean().default(true),
  scanOutput: z.boolean().default(false),
  abortThreshold: z.number().min(0).max(1).default(0.8),
  allowlist: z.array(FenceAllowlistRuleSchema).default([]),
}).partial().passthrough();

export type FenceConfig = z.infer<typeof FenceConfigSchema>;
export type FenceAllowlistRule = z.infer<typeof FenceAllowlistRuleSchema>;

export const RolePolicySchema = z.object({
  allowTools: z.array(z.string()).optional(),
  denyTools: z.array(z.string()).default([]),
  /** glob patterns relative to org cwd */
  fileWrite: z.array(z.string()).default(['**']),
  fileRead: z.array(z.string()).default(['**']),
  /** allowed domains for WebFetch/WebSearch; empty array = no web.
   *  Entries: exact host, subdomain suffix ('example.com' also matches
   *  'api.example.com'), '*.example.com' wildcard, or '*' for any host. */
  webAllow: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
  /** USD spend cap for this role (ORG-7). Enforced the same way maxTokens/overBudget
   *  is: PolicyEngine.decide() denies once accumulated cost meets or exceeds it. */
  maxUsd: z.number().positive().optional(),
  /** Git access level: 'none' blocks all git, 'read' allows status/log/diff,
   *  'commit' allows add/commit, 'push' allows push. Default: 'read'. */
  git: z.enum(['none', 'read', 'commit', 'push']).default('read'),
  fence: FenceConfigSchema.optional(),
  /** Tool/action names this role may use WITHOUT pausing for human approval,
   *  even when the action is on checkApproval's sensitive-actions list
   *  (Bash, WebFetch, WebSearch, org_complete). Still subject to allowTools/
   *  denyTools and the policy engine's own allow/deny decision — this only
   *  skips the "pause and wait for a human" step for a role the operator has
   *  already decided to trust for that specific action. */
  autoApproveTools: z.array(z.string()).optional(),
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
  /** Per-role runtime override: when set, this role's sessions run on the given
   *  agent runtime regardless of the org-level `runtime` field or the
   *  MONOMIND_RUNTIME env var ('claude' explicitly forces the Claude default).
   *  Enables mixed-runtime orgs — e.g. a Claude coordinator with opencode workers. */
  runtime: z.enum(['claude', 'kimicode', 'opencode', 'vercel', 'codex', 'antigravity', 'grok', 'qwen', 'crush', 'copilot', 'pi', 'pi-rpc', 'qwen-rpc']).optional(),
  /** Per-role override of run_config.max_turns_per_message — roles that legitimately
   *  need many more turns per message (e.g. a developer doing sequential build/fix/verify
   *  cycles) than others (e.g. docs, pm) shouldn't be forced onto one global budget. */
  max_turns_per_message: z.number().int().positive().optional(),
  /** Per-role override of the even run_config.budget_tokens split — a role on a
   *  token-hungry model (e.g. GLM via opencode) can get a larger budget without
   *  inflating the org-wide budget for every other role. Unset = even split. */
  budget_tokens: z.number().int().positive().optional(),
  /** Per-role USD spend cap (ORG-7). Unlike budget_tokens, there is no org-wide
   *  even split for USD — unset means no USD enforcement for this role (only
   *  token budgets apply). Enforced via PolicyEngine (see RolePolicySchema.maxUsd)
   *  and session.ts's overBudgetUsd check, which mirrors the token-budget-exhausted
   *  close-mailbox pattern. */
  budget_usd: z.number().positive().optional(),
}).passthrough();

/** Default per-message turn budget for a role session. Deliberately huge so
 *  the ceiling never bricks a legitimately long-running task (#140: a role
 *  mid-task on `error_max_turns` used to crash with no recovery) — real
 *  guardrails are budget_tokens, the idle watchdog, and the circuit breaker.
 *  Set run_config.max_turns_per_message (or a role's own
 *  max_turns_per_message) to cap turns when you want a hard limit. */
export const DEFAULT_MAX_TURNS_PER_MESSAGE = 100_000;

export const OrgDefSchema = z.object({
  name: z.string().min(1),
  goal: z.string().default(''),
  status: z.string().default('stopped'),
  schedule: z.union([z.string(), z.number(), z.null()]).default(null),
  run_config: z.object({
    max_concurrent_agents: z.number().int().positive().default(4),
    budget_tokens: z.number().int().positive().default(1_000_000),
    memory_namespace: z.string().optional(),
    max_turns_per_message: z.number().int().positive().default(DEFAULT_MAX_TURNS_PER_MESSAGE),
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
    failure_routing: FailureRoutingSchema.optional(),
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
    .transform(rc => ({ max_concurrent_agents: 4, budget_tokens: 1_000_000, max_turns_per_message: DEFAULT_MAX_TURNS_PER_MESSAGE, workspace: 'repo' as string, stale_base_threshold: 0, ...rc })),
  fence: FenceConfigSchema.optional(),
  roles: z.array(RoleSchema).min(1),
  /** Which agent runtime hosts this org's role sessions. When absent, the
   *  MONOMIND_RUNTIME env var is honored, falling back to the default Claude
   *  runner. Per-org values override the env var, and a role's own `runtime`
   *  field (see RoleSchema) overrides this per role. */
  runtime: z.enum(['claude', 'kimicode', 'opencode', 'vercel', 'codex', 'antigravity', 'grok', 'qwen', 'crush', 'copilot', 'pi', 'pi-rpc', 'qwen-rpc']).optional(),
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
  type: 'message' | 'xorg' | 'tool' | 'asset' | 'chat' | 'status' | 'audit' | 'usage' | 'question' | 'gate' | 'trace';
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
  traceNodeId?: string;
  traceDurationMs?: number;
  traceTokensIn?: number;
  traceTokensOut?: number;
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
