// packages/@monomind/cli/src/orgrt/types.ts
import { z } from 'zod';
import { CATALOG_NAME_RE } from '../catalog/types.js';
import { ORG_EFFORT_LEVELS } from './cost-tier.js';

export const ContextSliceSchema = z.object({ source: z.string(), summary: z.string() });
export type ContextSlice = z.infer<typeof ContextSliceSchema>;
export const ArtifactRefSchema = z.object({ path: z.string(), description: z.string().optional() });
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export const HandoffDecisionSchema = z.object({
  text: z.string(),
  rationale: z.string().optional(),
});
export type HandoffDecision = z.infer<typeof HandoffDecisionSchema>;
export const OrgHandoffSchema = z.object({
  taskId: z.string().optional(),
  contextPackage: z.array(ContextSliceSchema).default([]),
  artifacts: z.array(ArtifactRefSchema).default([]),
  decisions: z.array(HandoffDecisionSchema).default([]),
  nextAction: z.string(),
});
export type OrgHandoff = z.infer<typeof OrgHandoffSchema>;

export const FailureRoutingSchema = z
  .object({
    retry: z
      .object({
        maxAttempts: z.number().int().positive(),
        backoffMs: z.array(z.number().int().nonnegative()).optional(),
      })
      .partial()
      .optional(),
    fallbackAssignee: z.string().optional(),
    escalate: z.boolean().optional(),
  })
  .partial();
export type FailureRouting = z.infer<typeof FailureRoutingSchema>;

/** Per-role provider config. Default (absent) = subscription login of local Claude Code.
 *
 *  @deprecated kind: 'gemini' | 'openai' — these only set GEMINI_API_KEY /
 *  OPENAI_API_KEY on the child env (see provider.ts); no runtime actually
 *  reads them (daemon.ts's autoRuntimeFromProvider has no case for either),
 *  so the role silently falls through to the default ClaudeAgentRunner and
 *  runs on Claude regardless. daemon.ts#startOrg warns loudly at start time
 *  when this happens. Use kind: 'vercel-api-key' with vendor: 'google' or
 *  vendor: 'openai' instead — that path actually routes to the requested
 *  provider via VercelAgentRunner. */
export const ProviderSchema = z
  .object({
    kind: z
      .enum([
        'subscription',
        'api-key',
        'base-url',
        'bedrock',
        'vertex',
        'gemini', // @deprecated — env-var-only; falls through to Claude. See class doc above.
        'openai', // @deprecated — env-var-only; falls through to Claude. See class doc above.
        'vercel-api-key',
        'codex',
        'antigravity',
      ])
      .default('subscription'),
    /** Which Vercel AI SDK provider to use (only when kind='vercel-api-key'). */
    vendor: z
      .enum([
        'openai',
        'anthropic',
        'google',
        'xai',
        'deepseek',
        'glm',
        'mistral',
        'groq',
        'together',
        'fireworks',
        'cohere',
        'perplexity',
        'alibaba',
        'openrouter',
        'ollama',
        'openai-compatible',
      ])
      .optional(),
    /** env var NAME holding the API key (never the key itself) */
    apiKeyEnv: z.string().optional(),
    /** Direct API-key value. Populated programmatically from the named-provider
     *  config (`monomind providers configure`) — org JSON should keep using
     *  apiKeyEnv so secrets never land in org definition files. */
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    /** env var NAME holding the auth token for base-url providers */
    authTokenEnv: z.string().optional(),
    /** Direct auth-token value for base-url providers. Populated programmatically
     *  from the named-provider config (`monomind providers configure`) — org JSON
     *  should keep using authTokenEnv so secrets never land in org definition files. */
    authToken: z.string().optional(),
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
  })
  .strict();

const THREAT_TYPES = [
  'prompt_injection',
  'jailbreak',
  'pii_exposure',
  'instruction_override',
  'role_switching',
  'context_manipulation',
  'encoding_attack',
  'data_exfiltration',
  'unknown',
] as const;

export const FenceAllowlistRuleSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1),
  types: z.array(z.enum(THREAT_TYPES)).default([]),
  context: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
});

export const FenceConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    enablePIIDetection: z.boolean().optional(),
    scanMessages: z.boolean().default(true),
    scanOutput: z.boolean().default(false),
    abortThreshold: z.number().min(0).max(1).default(0.8),
    allowlist: z.array(FenceAllowlistRuleSchema).default([]),
  })
  .partial()
  .passthrough();

export type FenceConfig = z.infer<typeof FenceConfigSchema>;
export type FenceAllowlistRule = z.infer<typeof FenceAllowlistRuleSchema>;

export const RolePolicySchema = z
  .object({
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
    /** ADR-O001 D1: which token basis `maxTokens` is compared against.
     *  'uncached' (default) — input + output only, the basis every existing
     *  budget_tokens value was written against. 'billable' — also counts
     *  cache reads and cache writes, i.e. what is actually billed. Derived by
     *  the daemon from `run_config.budget_tokens_basis`; never set per role in
     *  a config. */
    maxTokensBasis: z.enum(['uncached', 'billable']).optional(),
    /** USD spend cap for this role (ORG-7). Enforced the same way maxTokens/overBudget
     *  is: PolicyEngine.decide() denies once accumulated cost meets or exceeds it. */
    maxUsd: z.number().positive().optional(),
    /** Git access level: 'none' blocks all git, 'read' allows status/log/diff,
     *  'commit' allows add/commit, 'push' allows push. Default: 'read'. */
    git: z.enum(['none', 'read', 'commit', 'push']).default('read'),
    /** OS sandbox for claude-runtime roles below git 'push' (#258, see
     *  role-sandbox.ts). mode: 'auto' (default) sandboxes when bubblewrap/socat
     *  or seatbelt are available and audits when not; 'required' refuses to
     *  run unsandboxed; 'off' opts out. allowedDomains defaults to ['*'];
     *  deniedDomains is an opt-in host deny list; allowWrite adds
     *  writable paths; denyWrite makes paths read-only for the role's shell
     *  and file tools (relative paths resolve against the org root, so
     *  `["."]` keeps a QA role from writing anywhere in the checkout);
     *  allowUnixSockets (default true — Chrome needs one) can be turned off
     *  to block every AF_UNIX socket. */
    sandbox: z
      .object({
        mode: z.enum(['auto', 'required', 'off']).optional(),
        allowedDomains: z.array(z.string()).optional(),
        deniedDomains: z.array(z.string()).optional(),
        allowWrite: z.array(z.string()).optional(),
        denyWrite: z.array(z.string()).optional(),
        allowUnixSockets: z.boolean().optional(),
      })
      .strict()
      .optional(),
    fence: FenceConfigSchema.optional(),
    /** Tool/action names this role may use WITHOUT pausing for human approval,
     *  even when the action is on checkApproval's sensitive-actions list
     *  (Bash, WebFetch, WebSearch, org_complete). Still subject to allowTools/
     *  denyTools and the policy engine's own allow/deny decision — this only
     *  skips the "pause and wait for a human" step for a role the operator has
     *  already decided to trust for that specific action. */
    autoApproveTools: z.array(z.string()).optional(),
    /** Extra tool/action names that pause for approval exactly like the
     *  built-in sensitive list (Bash, WebFetch, WebSearch, org_complete).
     *  Bare form — `org_send`, `monoagent__automation_publish` — never the
     *  `mcp__org__` namespaced form. `autoApproveTools` still wins. */
    approvalTools: z.array(z.string()).optional(),
  })
  .partial()
  .passthrough();

/** A stdio MCP server whose tools are exposed to one role as
 *  `<prefix>__<mcpToolName>` (M1, capability `org-tool-providers`).
 *  `env` values are literal — never expanded, never read from secrets. */
export const ToolProviderSchema = z
  .object({
    kind: z.literal('mcp-stdio'),
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    /** MCP tool names to expose; absent = all. */
    allow: z.array(z.string()).optional(),
    /** Default: `name` with '-' → '_'. */
    prefix: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_]*$/)
      .optional(),
    /** Per tools/call timeout. */
    timeout_ms: z.number().int().positive().default(660_000),
    /** The provider process exits after this long without calls. */
    idle_ms: z.number().int().positive().default(300_000),
  })
  .passthrough();
export type ToolProviderConfig = z.infer<typeof ToolProviderSchema>;

/** M2 (capability `org-endpoint-roles`): an endpoint role's delivery target. */
export const EndpointSchema = z
  .object({
    url: z.string().url(),
    /** Absolute path; must be mode 0600 and owned by the daemon user. Sent as a bearer. */
    credential_file: z.string().optional(),
    /** Reply-wait hold for the idle watchdog; default 600000. */
    timeout_ms: z.number().int().positive().optional(),
    /** One line for the boss briefing. */
    input_hint: z.string().optional(),
  })
  .passthrough();
export type EndpointConfig = z.infer<typeof EndpointSchema>;

export const RoleSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().default(''),
    type: z.string().default('specialist'),
    reports_to: z.string().nullable().default(null),
    responsibilities: z.array(z.string()).default([]),
    instructions_file: z.string().optional(),
    /** Skills from the org skill library (orgrt/skill-library.ts) pinned into
     *  this role's system prompt for its whole life. */
    skills: z.array(z.string()).optional(),
    /** Skills this role may load mid-run with org_skill_load: names or
     *  `tag:<tag>` selectors. Only their one-line descriptions sit in the
     *  prompt, so it stays a stable cache prefix. */
    skill_pool: z.array(z.string()).optional(),
    /** Catalog blueprint whose skills/skill_pool fill the fields above when
     *  unset (catalog/blueprints.ts `resolveOrgDefBlueprints`). */
    blueprint: z.string().regex(CATALOG_NAME_RE).optional(),
    /** Canvas/UI-owned metadata (position, icon, color) — round-tripped
     *  unchanged by the runtime, which never reads it. Still `.passthrough()`
     *  so unknown UI-client fields keep round-tripping. */
    ui: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
      })
      .passthrough()
      .optional(),
    adapter_config: z
      .object({
        model: z.string().optional(),
        max_tokens: z.number().optional(),
        /** Reference by name to a provider configured via
         *  `monomind providers configure -p <name> -k <key> -e <endpoint>`.
         *  Resolved at session start into a concrete base-url/api-key provider
         *  for the role's sessions. An explicit role-level `provider` block wins. */
        provider: z.string().optional(),
      })
      .partial()
      .optional(),
    provider: ProviderSchema.optional(),
    policy: RolePolicySchema.optional(),
    /** ADR-O001 D3: overrides run_config.session_scope for this role. */
    session_scope: z.enum(['role', 'task']).optional(),
    /** ADR-O001 D6: 'artifact-only' makes this a cold reviewer — a new model
     *  session per message, fed only runtime-built review packets
     *  (org_review); other agents' org_send to it is refused, so the doer's
     *  framing cannot reach it. Absent = an ordinary role. */
    review_input: z.enum(['artifact-only']).optional(),
    /** ADR-O001 "What this does NOT apply to": a role whose value is the
     *  disagreement itself (a debater, a critic, a synthesiser). The runtime
     *  does not apply the execution-work gates to it: org_task_done needs no
     *  evidence (there is no oracle, and none should be faked), so the
     *  evidence retry cap never fires either. It cannot be an artifact-only
     *  reviewer — a synthesiser must see every position. */
    deliberative: z.boolean().optional(),
    /** Per-role runtime override: when set, this role's sessions run on the given
     *  agent runtime regardless of the org-level `runtime` field or the
     *  MONOMIND_RUNTIME env var ('claude' explicitly forces the Claude default).
     *  Enables mixed-runtime orgs — e.g. a Claude coordinator with opencode workers. */
    runtime: z
      .enum([
        'claude',
        'kimicode',
        'opencode',
        'vercel',
        'codex',
        'antigravity',
        'grok',
        'qwen',
        'crush',
        'copilot',
        'pi',
        'pi-rpc',
        'qwen-rpc',
        'hermes',
      ])
      .optional(),
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
    /** Config-defined tools for this role: stdio MCP servers (M1). */
    tool_providers: z.array(ToolProviderSchema).optional(),
    /** M2: 'endpoint' = an automation reached over HTTP, not an agent session. */
    kind: z.enum(['agent', 'endpoint']).optional(),
    /** M2: where an endpoint role's messages are POSTed. */
    endpoint: EndpointSchema.optional(),
  })
  .passthrough()
  .superRefine((r, ctx) => {
    if (r.deliberative && r.review_input === 'artifact-only') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['review_input'],
        message: `role "${r.id}" is deliberative, so it cannot be an artifact-only reviewer: deliberation needs every position in full`,
      });
    }
  });

/** Default per-message turn budget for a role session. Deliberately huge so
 *  the ceiling never bricks a legitimately long-running task (#140: a role
 *  mid-task on `error_max_turns` used to crash with no recovery) — real
 *  guardrails are budget_tokens, the idle watchdog, and the circuit breaker.
 *  Set run_config.max_turns_per_message (or a role's own
 *  max_turns_per_message) to cap turns when you want a hard limit. */
export const DEFAULT_MAX_TURNS_PER_MESSAGE = 100_000;

/** ADR-O001 D8 cost tiers. Keys are provider keys — a Vercel vendor slug
 *  (`glm`, `openai`, …) when the role has one, else the role's runtime id
 *  (`claude`, `codex`, `kimicode`, …) — so a tier is expressible for a
 *  provider this code has never heard of without touching code. Resolution,
 *  the built-in Claude catalog and the deliberative-role warning live in
 *  orgrt/cost-tier.ts. */
const EffortLevelSchema = z.enum(ORG_EFFORT_LEVELS);
export const CostTiersSchema = z
  .object({
    /** Tier applied to every role with no `roles` entry of its own. */
    default: z.string().optional(),
    /** Per-role tier. A bare string is a tier name or `"exempt"`; the object
     *  form also overrides the tier's effort — how "patrol roles drop effort
     *  since they do simpler, more repetitive work" is expressed. */
    roles: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.object({ tier: z.string(), effort: EffortLevelSchema.optional() }).passthrough(),
        ]),
      )
      .optional(),
    /** tier name → provider key → { model, effort }. Merged over the built-in
     *  catalog per provider, so adding one provider to a built-in tier keeps
     *  the rest of that tier. */
    tiers: z
      .record(
        z.string(),
        z.record(
          z.string(),
          z
            .object({ model: z.string().min(1), effort: EffortLevelSchema.optional() })
            .passthrough(),
        ),
      )
      .optional(),
    /** provider key → how that provider expresses an effort level. Claude is
     *  handled natively (the SDK's own `effort`/`thinking` options); anything
     *  else declares env vars here, or encodes effort in the per-tier model id
     *  (e.g. `gemini-3.6-flash-high`). A provider with neither ignores it. */
    providers: z
      .record(
        z.string(),
        z
          .object({
            // partialRecord, not record: z.record() over an enum key demands
            // EVERY level be present, so an org declaring only `low` would be
            // rejected for not also declaring medium/high/xhigh/max.
            effort_env: z
              .partialRecord(EffortLevelSchema, z.record(z.string(), z.string()))
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** ADR-O001 D7: one named loadout — a stable bundle of role-prompt text and
 *  skills that becomes part of the SYSTEM PROMPT of the session serving a
 *  task. Validation (catalog size, names, skills, file) and resolution live in
 *  orgrt/loadouts.ts. */
export const LoadoutSchema = z
  .object({
    /** One line shown to the boss in org_task's description, to select by. */
    description: z.string().optional(),
    /** Role-prompt text for this kind of work. */
    prompt: z.string().optional(),
    /** Skills from the org skill library (orgrt/skill-library.ts) to include. */
    skills: z.array(z.string()).optional(),
    /** Extra guidance file, resolved against the project root. */
    instructions_file: z.string().optional(),
  })
  .passthrough();

/** ADR-O001 D4's number: three failed evidence checks on one task, then
 *  escalate instead of handing it back again. Exported so the call site can
 *  fall back to it for an org definition that never went through the schema
 *  (a hand-built RunningOrg, a config written before this field existed). */
export const DEFAULT_MAX_EVIDENCE_ATTEMPTS = 3;

export const OrgDefSchema = z
  .object({
    name: z.string().min(1),
    goal: z.string().default(''),
    status: z.string().default('stopped'),
    schedule: z.union([z.string(), z.number(), z.null()]).default(null),
    run_config: z
      .object({
        max_concurrent_agents: z.number().int().positive().default(4),
        budget_tokens: z.number().int().positive().default(1_000_000),
        /** ADR-O001 D1: which token basis `budget_tokens` is enforced on.
         *  'uncached' (default) counts input + output, the basis this value
         *  has always meant. 'billable' also counts cache reads/writes — the
         *  honest basis, but ~100x larger on a well-cached run, so opting in
         *  means re-sizing budget_tokens. The meter itself is always billable
         *  (usage events, checkpoints, dashboards); this knob only governs
         *  enforcement, so switching it can never change what is reported.
         *  Prefer `budget_usd`, which needs no basis. */
        budget_tokens_basis: z.enum(['uncached', 'billable']).optional(),
        memory_namespace: z.string().optional(),
        max_turns_per_message: z.number().int().positive().default(DEFAULT_MAX_TURNS_PER_MESSAGE),
        /** idle watchdog window in minutes (fractions allowed); 0 disables. Default 10. */
        idle_minutes: z.number().nonnegative().optional(),
        /** #302: how strictly `org_complete` is gated. 'boss' (default) only
         *  constrains `outcome: 'partial'` — it must name a `blocker`
         *  ('budget' | 'human' | 'external' | 'time'), cross-checked against
         *  real run state; `achieved`/`failed` are never refused. 'dag'
         *  additionally refuses `achieved`/`partial` while `org_tasks` has
         *  runnable work and nothing is time-blocked — opt-in because a run
         *  with no populated DAG (the common case today) gets no benefit
         *  from it, only a new refusal path. See completion-gate.ts. */
        completion: z.enum(['boss', 'dag']).optional(),
        /** ADR-O001 D5: gate `org_task_done` on machine-checkable evidence —
         *  acceptance commands with their real exit codes, pinned to the
         *  workspace's current commit sha. Adjacent FLAG rather than a third
         *  `completion` value because it constrains a different call
         *  (org_task_done, per item) than `completion` does (org_complete,
         *  per run): an org wants to choose both independently. Default
         *  false — turning it on refuses task completions that previously
         *  succeeded, which is the point, but must not happen on upgrade.
         *  See completion-gate.ts's `checkTaskEvidence`. */
        completion_evidence: z.boolean().optional(),
        /** ADR-O001 D4 ("bound retries (3) and escalate"): how many times one
         *  task may fail the `completion_evidence` gate before the runtime
         *  stops handing it back to its assignee and escalates it to the boss
         *  instead. Counted per task and carried by the checkpoint (see
         *  `OrgTask.evidenceFailures`). Only meaningful with
         *  `completion_evidence` on — without the gate nothing fails. */
        max_evidence_attempts: z.number().int().positive().default(3),
        /** ADR-O001 D3: how a role's MODEL sessions are keyed. 'role'
         *  (the default, and the behaviour before D3) keeps one session for
         *  the role's life. 'task' keeps one per task: the role's process
         *  exits at a task boundary and the next wake resumes that task's
         *  session from the run's session ledger. Applies to every role
         *  except the coordinator, whose work spans tasks — a role's own
         *  `session_scope` overrides it either way. */
        session_scope: z.enum(['role', 'task']).optional(),
        /** ADR-O001 D3: end a role's process after this many ms with no mail;
         *  the next message resumes the same model session. Absent = never
         *  (the process parks, as before). Idle residency costs no tokens,
         *  so this is about process count, not spend. */
        session_idle_exit_ms: z.number().int().positive().optional(),
        /** When a task completes, send its creator (the role that called
         *  org_task / org_plan_graph) a `[task:<id>] DONE` message with the
         *  result and evidence summary. Off by default: without it a
         *  completion is only a bus event, and a creator waiting on it idles
         *  until the watchdog nudges. */
        notify_task_creator: z.boolean().optional(),
        /** Where role sessions run.
         *  'repo' (default) — the project root, so roles can Read/Edit real files.
         *  'isolated' — a scratch dir under .monomind/orgs/<name>/workspace, which the
         *  policy engine's workdir check then confines every path to.
         *  An absolute path is used verbatim. */
        workspace: z
          .union([
            z.literal('repo'),
            z.literal('isolated'),
            z.literal('worktree'),
            z.literal('worktree-per-role'),
            z.string(),
          ])
          .optional(),
        /** Circuit breaker: after N consecutive non-success session results from
         *  a role, trip the circuit and close the role's mailbox instead of looping. */
        circuit_breaker: z
          .object({
            failure_threshold: z.number().int().positive().default(5),
            cooldown_ms: z.number().int().nonnegative().default(0),
          })
          .partial()
          .optional(),
        /** Non-negative cap on accepted org_respawn_role calls per run; 0 disables
         *  the tool entirely (initial default — see rollout plan in the design doc). */
        max_role_respawns: z.number().int().nonnegative().default(0),
        /** How long a draining role's mailbox gets to finish its in-flight message
         *  before a forced stop. */
        respawn_drain_timeout_ms: z.number().int().nonnegative().default(30_000),
        /** How long a forced stop gets to confirm the old runner terminated. */
        respawn_force_stop_timeout_ms: z.number().int().nonnegative().default(5_000),
        /** How long the replacement incarnation gets to reach its readiness boundary. */
        respawn_start_timeout_ms: z.number().int().positive().default(60_000),
        failure_routing: FailureRoutingSchema.optional(),
        /** Stale-base drift detection: warn (or refuse) when the working tree is
         *  too many commits behind its tracking branch. 0 disables. */
        stale_base_threshold: z.number().int().nonnegative().default(0),
        /** Precondition checks: shell commands that must exit 0 before a scheduled
         *  run starts. If any fail, the run is skipped and the failure logged. */
        prechecks: z
          .array(
            z.object({
              name: z.string(),
              command: z.string(),
            }),
          )
          .optional(),
      })
      .partial()
      .passthrough()
      .default({})
      .transform((rc) => ({
        max_concurrent_agents: 4,
        budget_tokens: 1_000_000,
        budget_tokens_basis: 'uncached' as const,
        max_turns_per_message: DEFAULT_MAX_TURNS_PER_MESSAGE,
        workspace: 'repo' as string,
        stale_base_threshold: 0,
        max_role_respawns: 0,
        completion: 'boss' as const,
        completion_evidence: false,
        max_evidence_attempts: DEFAULT_MAX_EVIDENCE_ATTEMPTS,
        respawn_drain_timeout_ms: 30_000,
        respawn_force_stop_timeout_ms: 5_000,
        respawn_start_timeout_ms: 60_000,
        ...rc,
      })),
    fence: FenceConfigSchema.optional(),
    /** M4 (capability `org-federation`): cross-root messaging allowlists —
     *  org names, '*' = any. Orgs under the same project root are one trust
     *  domain and never restricted. */
    federation: z
      .object({
        allow_from: z.array(z.string()).optional(),
        allow_to: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    /** ADR-O001 D8: named cost tiers, each setting BOTH the model AND the
     *  reasoning/thinking effort for a role, per provider. Absent (the
     *  default) = no tiering at all and today's model resolution, unchanged.
     *
     *  Precedence at session start: an explicit `adapter_config.model` wins
     *  over the tier's model; the tier wins over a named provider's default
     *  and the runtime default. A tier's EFFORT applies either way, since it
     *  is a separate axis from which model to run.
     *
     *  DO NOT TIER A DELIBERATIVE ROLE INTO A WEAK VOICE. The ADR is explicit:
     *  tier by *difficulty of the judgement*, not by role label — "a cheap
     *  model in a debate produces cheap arguments and the synthesiser cannot
     *  tell". Assign `"exempt"` to any role whose value is the quality of its
     *  disagreement (design reviewer, red-teamer, debate synthesiser) and
     *  control its cost with a budget instead. See orgrt/cost-tier.ts. */
    cost_tiers: CostTiersSchema.optional(),
    /** ADR-O001 D7: the org's catalog of named loadouts (target 5–15; more
     *  than 15 fails `org validate` and `org run`). When present, org_task and
     *  org_plan_graph take an optional `loadout` the boss SELECTS by name; it
     *  is recorded on the task row and every re-dispatch reuses it. Absent
     *  (the default) = no loadout argument and byte-identical prompts/tools.
     *  Deliberative work that wants many one-off perspectives belongs in its
     *  own org (ADR-O001, "What this does NOT apply to"). See orgrt/loadouts.ts. */
    loadouts: z.record(z.string(), LoadoutSchema).optional(),
    roles: z.array(RoleSchema).min(1),
    /** Which agent runtime hosts this org's role sessions. When absent, the
     *  MONOMIND_RUNTIME env var is honored, falling back to the default Claude
     *  runner. Per-org values override the env var, and a role's own `runtime`
     *  field (see RoleSchema) overrides this per role. */
    runtime: z
      .enum([
        'claude',
        'kimicode',
        'opencode',
        'vercel',
        'codex',
        'antigravity',
        'grok',
        'qwen',
        'crush',
        'copilot',
        'pi',
        'pi-rpc',
        'qwen-rpc',
        'hermes',
      ])
      .optional(),
  })
  .passthrough();

export type OrgDef = z.infer<typeof OrgDefSchema>;
export type OrgRole = z.infer<typeof RoleSchema>;
export type RolePolicy = z.infer<typeof RolePolicySchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;

/** #290: why a `decision-trace` audit event was recorded. Before this, a
 *  prompt-injection fence block and a routine "waiting for a human to approve
 *  this tool" emitted byte-identical structured fields (`decisionType: 'tool'`,
 *  `outcome: 'denied'`) and differed only in free text — so a consumer wanting
 *  to tell "blocked by the security fence" from "waiting for you" had to regex
 *  English out of `data.context`/`data.reasoning`. Prose stays for humans;
 *  consumers switch on `data.kind`. Set where the decision is made, never
 *  reconstructed by a reader. */
export type DecisionKind =
  /** monofence scanInput() rejected the tool's own input (prompt injection). */
  | 'fence-block'
  /** A pending decision gate is hard-blocking every tool call for this role. */
  | 'gate-pending'
  /** PolicyEngine.decide() denied it (allowlist, scope, budget, git level, …). */
  | 'policy-deny'
  /** Routine: an approval request is open and waiting on a human. */
  | 'approval-pending'
  /** A human (or a guardrail) rejected the approval request. */
  | 'approval-denied'
  /** An open approval request was resolved (approved or rejected). */
  | 'approval-resolved'
  /** Work/context crossed an org boundary via deliver(). */
  | 'cross-org-handoff';

/** #289: how much of a tool's result body a `tool_result` event carries.
 *  A single Bash result can be megabytes and there is one of these per tool
 *  call — two orders of magnitude more frequent than the 20k-char 'asset'
 *  content snapshot — so the head is kept and the rest dropped. Truncation is
 *  never implied by the text: `truncated` and `output_chars` say it outright. */
export const TOOL_RESULT_OUTPUT_MAX_CHARS = 4_000;

/** #289: the `data` payload of a `tool_result` bus event — the outcome of a
 *  tool call that a consumer can read without pattern-matching the agent's own
 *  narration about whether its command worked. */
export interface ToolResultEventData {
  /** The harness's tool-use id, matching `call_id` on the `tool` event that
   *  recorded the invocation. Correlating by id (not by tool name) is what
   *  makes two concurrent Bash calls from the same role tellable apart. */
  call_id?: string;
  /** Did the call succeed? The universal outcome: harnesses report a per-call
   *  error flag for every tool, including ones that never exit with a code
   *  (Read, WebFetch, an MCP tool). No `exitCode` is carried — the Claude
   *  Agent SDK does not surface one, and recovering it would mean parsing the
   *  result prose, which is the very thing this event exists to replace. */
  ok: boolean;
  /** Wall time from the invocation to the result landing, when observable. */
  duration_ms?: number;
  /** Redacted head of the result body, at most TOOL_RESULT_OUTPUT_MAX_CHARS. */
  output?: string;
  /** True when `output` is only the head of a longer body. */
  truncated?: boolean;
  /** Length of the result body BEFORE truncation, in characters. */
  output_chars?: number;
}

/** Superset of the legacy *-threads.jsonl line shape ({type,id,run_id,ts,from,to,msg,subject}). */
export interface BusEvent {
  id: string;
  ts: number;
  org: string;
  run: string;
  type:
    | 'message'
    | 'xorg'
    | 'tool'
    /** #289: a completed tool call. `tool` is the tool name, `from` the role,
     *  `data` a ToolResultEventData correlated to the 'tool' event by call_id. */
    | 'tool_result'
    | 'asset'
    | 'chat'
    | 'status'
    | 'audit'
    | 'usage'
    | 'question'
    | 'gate'
    | 'trace';
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
