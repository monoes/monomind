// packages/@monomind/cli/src/orgrt/types-role.ts
import { z } from 'zod';
import { CATALOG_NAME_RE } from '../catalog/types.js';
import { ProviderSchema, RolePolicySchema } from './types-policy.js';

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

/** Upper bound for `max_tool_rounds` (#326): each round is a full model turn,
 *  so the cap still has to stop a model that keeps calling tools. */
export const MAX_TOOL_ROUNDS_LIMIT = 200;

/** Upper bound for a blocked task's re-check interval (#329), in minutes —
 *  both run_config.block_recheck_minutes and org_task_block's
 *  recheckAfterMinutes. A block may last hours; its assignee may not go
 *  unasked for longer than this. */
export const MAX_BLOCK_RECHECK_MINUTES = 60;

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
        'cline',
        'aider',
        'dsh',
        'freebuff',
        'kilo',
      ])
      .optional(),
    /** Per-role override of run_config.max_turns_per_message — roles that legitimately
     *  need many more turns per message (e.g. a developer doing sequential build/fix/verify
     *  cycles) than others (e.g. docs, pm) shouldn't be forced onto one global budget. */
    max_turns_per_message: z.number().int().positive().optional(),
    /** Per-role override of run_config.max_tool_rounds (#326). */
    max_tool_rounds: z.number().int().positive().max(MAX_TOOL_ROUNDS_LIMIT).optional(),
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
