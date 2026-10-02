// packages/@monomind/cli/src/orgrt/types.ts
import { z } from 'zod';
import { MAX_CLAUDE_BASH_TIMEOUT_MS } from './bash-timeout.js';
import { CostTiersSchema, DEFAULT_MAX_EVIDENCE_ATTEMPTS, LoadoutSchema } from './types-cost.js';
import { FailureRoutingSchema } from './types-handoff.js';
import { FenceConfigSchema, type ProviderSchema, type RolePolicySchema } from './types-policy.js';
import {
  DEFAULT_MAX_TURNS_PER_MESSAGE,
  MAX_BLOCK_RECHECK_MINUTES,
  MAX_TOOL_ROUNDS_LIMIT,
  RoleSchema,
} from './types-role.js';

export { CostTiersSchema, DEFAULT_MAX_EVIDENCE_ATTEMPTS, LoadoutSchema } from './types-cost.js';
export type { BusEvent, DecisionGate, DecisionKind, ToolResultEventData } from './types-events.js';
export { TOOL_RESULT_OUTPUT_MAX_CHARS } from './types-events.js';
export type {
  ArtifactRef,
  ContextSlice,
  FailureRouting,
  HandoffDecision,
  OrgHandoff,
} from './types-handoff.js';
export {
  ArtifactRefSchema,
  ContextSliceSchema,
  FailureRoutingSchema,
  HandoffDecisionSchema,
  OrgHandoffSchema,
} from './types-handoff.js';
export type { FenceAllowlistRule, FenceConfig } from './types-policy.js';
export {
  FenceAllowlistRuleSchema,
  FenceConfigSchema,
  ProviderSchema,
  RolePolicySchema,
} from './types-policy.js';
export type { EndpointConfig, ToolProviderConfig } from './types-role.js';
export {
  DEFAULT_MAX_TURNS_PER_MESSAGE,
  EndpointSchema,
  MAX_BLOCK_RECHECK_MINUTES,
  MAX_TOOL_ROUNDS_LIMIT,
  RoleSchema,
  ToolProviderSchema,
} from './types-role.js';

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
        /** #326: how many tool_call → tool_result rounds a fence-protocol
         *  runtime (every runtime but claude and vercel) runs per mailbox
         *  message. Unset = 10. At the cap the role gets its pending calls
         *  back unrun, with a notice, and one round to report and ask to be
         *  continued. A role's own max_tool_rounds overrides it. */
        max_tool_rounds: z.number().int().positive().max(MAX_TOOL_ROUNDS_LIMIT).optional(),
        /** idle watchdog window in minutes (fractions allowed); 0 disables. Default 10. */
        idle_minutes: z.number().nonnegative().optional(),
        /** #329: how often (minutes, fractions allowed) the assignee of a
         *  task blocked with org_task_block is woken to re-check it, until its
         *  deadline or close. Nothing external wakes a blocked task, so a
         *  block cannot opt out; the role may ask for a different interval
         *  per block (recheckAfterMinutes), within the same bound. Default 5. */
        block_recheck_minutes: z.number().positive().max(MAX_BLOCK_RECHECK_MINUTES).optional(),
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
        /** Org sections spec 6.8, Phase 2: the opt-in surface. Setting any
         *  key adds the typed brief fields (require_brief), org_note_append and
         *  notes injection (notes), and the between-turn session rotation
         *  threshold (session_cap); an org with none keeps its tool list and
         *  prompt byte for byte. See context-surface.ts. */
        context: z
          .object({
            require_brief: z.boolean().optional(),
            notes: z.boolean().optional(),
            session_cap: z
              .object({
                tasks: z.number().int().positive().optional(),
                tokens: z.number().int().positive().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        /** ADR-O001 D3: end a role's process after this many ms with no mail;
         *  the next message resumes the same model session. Absent = never
         *  (the process parks, as before). Idle residency costs no tokens,
         *  so this is about process count, not spend. */
        session_idle_exit_ms: z.number().int().positive().optional(),
        /** Claude-runtime roles: the Bash tool's default and maximum command
         *  timeout (BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS in the role's
         *  session env). Default 600000 — Claude Code's own default is 2
         *  minutes, too short for an install or a full build. Ignored by
         *  other runtimes. See bash-timeout.ts. */
        bash_timeout_ms: z.number().int().positive().max(MAX_CLAUDE_BASH_TIMEOUT_MS).optional(),
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
        /** #365: human-only. A `policy.access: 'full'` role runs scoped
         *  (`access_state: 'unattended-blocked'`) on an unattended run (a
         *  scheduled org — `schedule` set — including one ticked by `org
         *  serve`) unless this is `true`. In this project's ack-hash model
         *  "human-only" means: never set programmatically by an
         *  agent-reachable write path; edit the org config directly (like
         *  `schedule` itself) and re-run `org role set-access <org> <role>
         *  full` to re-acknowledge, since this value is covered by every
         *  full-access role's access_ack hash. */
        allow_unattended_full_access: z.boolean().optional(),
        /** #365: human-only, in the ack hash (see above). Accepts a specific
         *  taint path `org validate` would otherwise error on — a role that
         *  ingests untrusted input (webAllow, or a messaging/social/email
         *  tool provider) can reach a `policy.access: 'full'` role through
         *  `reports_to`. Entries match either the full path
         *  ("scraper → analyst → builder") or just its endpoints
         *  ("scraper→builder") — see access-taint.ts. */
        accept_full_access_taint: z.array(z.string()).optional(),
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
        'cline',
        'aider',
        'dsh',
      ])
      .optional(),
  })
  .passthrough();

export type OrgDef = z.infer<typeof OrgDefSchema>;
export type OrgRole = z.infer<typeof RoleSchema>;
export type RolePolicy = z.infer<typeof RolePolicySchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;

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
