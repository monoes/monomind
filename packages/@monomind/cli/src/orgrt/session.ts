// packages/@monomind/cli/src/orgrt/session.ts

import type { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { AgentMessage, AgentRunner, OrgToolDef } from './agent-runner.js';
import { ClaudeAgentRunner, defaultClaudeRunner } from './agent-runner.js';
import {
  CLAUDE_SANDBOX_CWD_ENV,
  claudeBashTimeoutEnv,
  claudeSandboxCwdNote,
} from './bash-timeout.js';
import type { OrgBus } from './bus.js';
import type { TaskEvidence } from './completion-gate.js';
import { endpointBriefingLines } from './endpoint-roles.js';
import type { RoleFence } from './fence.js';
import { scanInput } from './fence.js';
import type { LoadoutSummary, ResolvedLoadout } from './loadouts.js';
import { Mailbox } from './mailbox.js';
import type { Decision, PolicyEngine, TokenUsage } from './policy.js';
import { summarizeToolOutput } from './policy.js';
import { FaultRestarts, ProcessFaultError } from './sandbox-fault.js';
import { StateDetector } from './state-detector.js';
import {
  linkAbort,
  queueCancelNotice,
  TaskCancelledError,
  type TaskProcesses,
  trackTaskProcess,
} from './task-cancel.js';
import { MAX_TASK_BRIEF } from './task-dag.js';
import type { RolePick, TaskPick } from './task-match.js';
import { orgTaskTool } from './task-tools.js';
import {
  type DecisionKind,
  MAX_BLOCK_RECHECK_MINUTES,
  type OrgDef,
  type OrgRole,
  type ToolResultEventData,
} from './types.js';

/** How long an SDK stream may stay open with zero messages before we say so.
 *  Comfortably longer than a slow first turn, shorter than the idle watchdog's
 *  10-minute window so the specific cause is reported before the generic
 *  "boss appears hung". */
const SILENT_SESSION_MS = 4 * 60_000;
const CONTEXT_LIMIT_RE = /context.window.limit|context.length.exceeded|maximum.context/i;

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureAuthorityDirs } from './authority-mask.js';
import { resolveRoleCostTier } from './cost-tier.js';
import { CumulativeMeter } from './cumulative-meter.js';
import type { StreamOptions } from './mailbox.js';
import { expandRolePromptVars, promptVarsFor } from './prompt-vars.js';
import { resolveProviderEnv, resolveRoleProvider } from './provider.js';
import { resolveRoleGitEnforcement, roleAuthorityMask } from './role-sandbox.js';
import type { SessionStartReason } from './session-ledger.js';
import {
  mailRouteKey,
  ROLE_SESSION_KEY,
  resolveSessionScope,
  SessionLedger,
} from './session-ledger.js';
import { roleSkillGuidance } from './skill-library.js';
import { skillTools } from './skill-tools.js';
import { strictArgs } from './tool-fence.js';
import { DEFAULT_CLAUDE_MODEL, VERCEL_PROVIDERS } from './vercel-providers.js';

/**
 * Resolves the extra system-prompt block for a role: its pinned library
 * skills and on-demand skill catalog (skill-library.ts) plus the role's own
 * `instructions_file`, if any — all optional and independent. A missing or
 * unreadable `instructions_file` is skipped (not an error): a role shouldn't
 * fail to start a session over a stale/typo'd custom-file path.
 */
export function resolveRoleExtraGuidance(role: OrgRole, projectRoot?: string): string | undefined {
  const parts: string[] = [];
  const skills = roleSkillGuidance(role, projectRoot);
  if (skills) parts.push(skills);
  if (role.instructions_file) {
    try {
      const custom = readFileSync(role.instructions_file, 'utf-8').trim();
      if (custom) parts.push(custom);
    } catch {
      // missing/unreadable custom instructions file — skip, don't crash session start
    }
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

/** Resolve the model string for a role: explicit adapter_config.model wins;
 *  otherwise fall back to the vendor/runtime default.
 *
 *  Vendor defaults are read straight off VERCEL_PROVIDERS, which already
 *  carries a defaultModel per vendor. A second hand-kept table lived here and
 *  restated all sixteen of them — two lists of per-vendor defaults that would
 *  eventually disagree, which is precisely the drift #252 was. An empty
 *  registry default (openai-compatible, which serves arbitrary endpoints) is
 *  falsy and so falls through to the runtime switch, as it always did. */
export function resolveModel(role: OrgRole, runtime?: string, vendor?: string): string {
  const explicit = role.adapter_config?.model;
  if (explicit) return explicit;
  const vendorDefault = vendor ? VERCEL_PROVIDERS[vendor]?.defaultModel : undefined;
  if (vendorDefault) return vendorDefault;
  switch (runtime) {
    case 'claude':
      return DEFAULT_CLAUDE_MODEL;
    // Kimi Code CLI namespaces model ids as <provider>/<model> (its own
    // default_model is "kimi-code/kimi-for-coding-highspeed") — a bare "k3"
    // 404s with "Model \"k3\" is not configured in config.toml".
    case 'kimicode':
      return 'kimi-code/k3';
    case 'opencode':
      return 'glm-5.2'; // opencode is typically paired with a vendor; this is the bare-runtime fallback
    case 'codex':
      return 'gpt-5.6-terra';
    case 'antigravity':
      return 'gemini-3.6-flash-high';
    case 'vercel':
      return 'gpt-5.5';
    default:
      return DEFAULT_CLAUDE_MODEL;
  }
}

export type DeliverFn = (
  from: string,
  to: string,
  subject: string,
  body: string,
) => Promise<string>;

/** The SDK's `canUseTool` gate, composed from two independent layers: PolicyEngine's
 *  static config checks (deny/allow lists, path scoping, git level, web allowlist,
 *  budget), then — only for calls policy would allow — the human-approval guardrail
 *  (`beforeTool`, i.e. daemon.checkApproval) for whatever action names it treats as
 *  sensitive (Bash/WebFetch/WebSearch/org_complete). Exported standalone so this
 *  composition is unit-testable without spinning up a real SDK session: previously
 *  `beforeTool` was wired into SessionOpts but never actually called from here, so
 *  none of those sensitive actions ever paused for a human. */
export function gatedCanUseTool(
  policy: PolicyEngine,
  beforeTool: SessionOpts['beforeTool'],
  roleId: string,
  fence?: RoleFence,
  /** Optional hook invoked whenever this gate denies a tool call — wired to
   *  daemon.recordDecision() so denials show up in `org decisions` traces.
   *  #290: `kind` names WHICH of this function's four deny paths fired, so a
   *  consumer never has to tell a fence block from a routine pending approval
   *  by matching the English in the message. */
  onDeny?: (
    toolName: string,
    input: Record<string, unknown>,
    decision: Extract<Decision, { behavior: 'deny' }>,
    kind: DecisionKind,
  ) => void,
  /** ORG-9: reports whether this role has a pending (unresolved) decision gate.
   *  org_gate is documented as creating a "hard-blocking" checkpoint, but until
   *  this was wired in nothing actually stopped tool use while a gate sat
   *  pending — only approvals did that. When set and true, ALL tool calls are
   *  denied (not just the sensitive subset approvals gate) until the gate is
   *  resolved, matching the "hard-blocking" description. */
  hasPendingGate?: () => boolean,
): (
  toolName: string,
  input: Record<string, unknown>,
  /** #289: the harness's id for this call, forwarded to policy.decide so the
   *  invocation event can be joined to the later tool_result event. */
  meta?: { toolUseId?: string },
) => Promise<Decision> {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    meta?: { toolUseId?: string },
  ): Promise<Decision> => {
    if (hasPendingGate?.()) {
      const decision: Decision = {
        behavior: 'deny',
        message: `Tool "${toolName}" is blocked — awaiting gate resolution. A decision gate is pending; wait for a human to approve or reject it via 'monomind org gate-approve/gate-reject'.`,
      };
      onDeny?.(toolName, input, decision, 'gate-pending');
      return decision;
    }
    if (fence) {
      const text =
        typeof input.command === 'string'
          ? input.command
          : typeof input.content === 'string'
            ? input.content
            : typeof input.url === 'string'
              ? input.url
              : JSON.stringify(input);
      const fenceDecision = await scanInput(fence.instance, text, fence.abortThreshold);
      if (fenceDecision.behavior === 'deny') {
        onDeny?.(toolName, input, fenceDecision, 'fence-block');
        return fenceDecision;
      }
    }
    const decision = await policy.decide(toolName, input, meta?.toolUseId);
    if (decision.behavior === 'deny') {
      onDeny?.(toolName, input, decision, 'policy-deny');
      return decision;
    }
    if (!beforeTool) return decision;
    const approved = await beforeTool(roleId, toolName, input);
    if (approved === false) {
      const denied: Decision = {
        behavior: 'deny',
        message: `Tool "${toolName}" was denied by guardrail approval`,
      };
      onDeny?.(toolName, input, denied, 'approval-denied');
      return denied;
    }
    if (approved === null) {
      const pending: Decision = {
        behavior: 'deny',
        message: `Tool "${toolName}" is pending human approval — it will be available once approved or denied via 'monomind org approve/deny'.`,
      };
      onDeny?.(toolName, input, pending, 'approval-pending');
      return pending;
    }
    return decision;
  };
}

export interface SessionOpts {
  org: string;
  role: OrgRole;
  bus: OrgBus;
  policy: PolicyEngine;
  mailbox: Mailbox;
  cwd: string;
  /** Org state directory (`.monomind/orgs/<name>`). Used to pass
   *  MONOMIND_ORG_DIR to runners that persist per-role state (VercelAgentRunner
   *  stores session history under `<orgDir>/sessions/`). */
  orgDir?: string;
  /** Project root for resolving `adapter_config.provider` named providers
   *  (config search must start at the project root even when the role's
   *  workspace cwd is an isolated scratch dir). Defaults to opts.cwd. */
  orgRoot?: string;
  /** Run id of the org run this session belongs to (MONOMIND_ORG_RUN). */
  run?: string;
  /** M1: build this session's tool-provider tools (role `tool_providers`).
   *  Called once per session start; the returned set is closed (provider
   *  processes killed) when the session ends. */
  buildProviderTools?: () => Promise<{ tools: OrgToolDef[]; close(): void } | undefined>;
  deliver: DeliverFn;
  askHuman?: (role: string, question: string, blocking?: boolean) => Promise<string>;
  /** Coordinator-only: records the run's outcome (daemon persists it to run
   *  history) — #302: the daemon gathers the facts, calls the completion
   *  gate, and returns a refusal string instead of recording anything when
   *  the call is unsatisfiable; `null`/`undefined` means allowed. */
  onComplete?: (
    role: string,
    outcome: 'achieved' | 'partial' | 'failed',
    summary: string,
    blocker?: 'budget' | 'human' | 'external' | 'time',
    blockerDetail?: string,
  ) => string | null | undefined;
  /** Present only for the selected coordinator (same gating pattern as
   *  onComplete) — mid-run role replacement. Returns the JSON-shaped
   *  RespawnReceipt (see role-slot.ts). */
  onRespawnRole?: (
    callerId: string,
    args: {
      roleId: string;
      runtime?: string;
      model?: string;
      providerName?: string;
      budgetTokens?: number;
      reason: string;
      briefing: string;
    },
  ) => Promise<unknown>;
  /** Present only for the selected coordinator. Returns the JSON-shaped
   *  runtime/named-provider listing (see runtime-options.ts). */
  onListRuntimeOptions?: () => Promise<unknown>;
  /** Search the org's accumulated cross-run memory (memory_namespace). */
  recall?: (role: string, query: string) => Promise<string>;
  /** Write a memory deliberately: scope 'org' (shared, default) or 'agent' (private to this role). */
  remember?: (role: string, content: string, scope: 'org' | 'agent') => Promise<string>;
  /** Persist extracted entities/relations/rules into the org's knowledge graph. */
  learn?: (
    role: string,
    payload: {
      nodes?: { name: string; type?: string; description?: string }[];
      edges?: { source: string; target: string; relation: string; description?: string }[];
      rules?: { rule: string; context?: string }[];
    },
  ) => Promise<string>;
  /** Top existing KG entity names - injected into the coordinator prompt so
   *  extraction reuses canonical names instead of minting near-duplicates. */
  glossary?: string[];
  /** Search the user's Second Brain (project documents + personal global brain). */
  searchKnowledge?: (role: string, query: string) => Promise<string>;
  /** Guardrail beforeTool hook: checks if a tool call requires approval before execution.
   *  `input` is the tool's actual call arguments — required so the approval cache can
   *  key on what's actually being called (e.g. the Bash command, the WebFetch url),
   *  not just the tool name; see approvals.ts's checkApproval for why. */
  beforeTool?: (
    role: string,
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<boolean | null>;
  /** Called whenever gatedCanUseTool denies a tool call — wired to daemon.recordDecision()
   *  so those denials show up in `org decisions` traces. `kind` (#290) says which
   *  deny path fired, so the trace is machine-readable rather than prose-only. */
  onDecision?: (role: string, toolName: string, message: string, kind: DecisionKind) => void;
  /** ORG-9: reports whether this role currently has a pending decision gate —
   *  wired to daemon.listGates(org, 'pending'). When true, gatedCanUseTool
   *  denies every tool call until the gate is resolved. */
  hasPendingGate?: () => boolean;
  def?: OrgDef;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
  /** Provider-agnostic runner. Takes precedence over queryFn. When unset,
   *  session.ts builds a ClaudeAgentRunner from queryFn (or the default),
   *  preserving the previous Claude-only behaviour exactly. */
  runner?: AgentRunner;
  /** Caller-owned cancellation handle for THIS incarnation. Every session
   *  attempt runs on its own AbortController linked to this one: aborting it
   *  aborts the in-flight attempt, which lets the daemon force-stop a specific
   *  incarnation (org stop, mid-run role replacement's forced-stop step)
   *  without reaching into runAgentSession's internals. An attempt's own abort
   *  (the silent-stream kill) never propagates back to it (#256). */
  externalAbort?: AbortController;
  /** Lets org_task_cancel end this role's task-scoped process for the
   *  cancelled task (task-cancel.ts). */
  taskProcesses?: TaskProcesses;
  /** Override how long a session's first stream pull may stay silent before
   *  the attempt is aborted and retried (tests only; default 4 minutes). */
  silentSessionMs?: number;
  /** ID of the last message received by this agent (for threading responses). Function to ensure live reading. */
  lastMessageId?: () => string | undefined;
  /** Callback for each output line — feeds ScrollbackBuffer. */
  onOutput?: (line: string) => void;
  /** Callback when the SDK assigns a session ID — enables checkpoint resume (P2-13). */
  onSessionId?: (id: string) => void;
  /** Called once per finished turn (the runner's `result` message), so the
   *  daemon can check what the role left open before its session parks. */
  onTurnEnd?: () => void;
  /** SDK session ID persisted in a checkpoint from a prior run — when set, the
   *  first query() call resumes it instead of starting a fresh conversation
   *  (P2-13: this is what actually makes checkpoint resume resume). */
  resumeSessionId?: string;
  /** ADR-O001 D3: the run's task-keyed session records. Every session run is
   *  recorded here (sessionIdBefore/After) in every scope; only
   *  `session_scope: 'task'` resumes from it. Omitted = in-memory. */
  sessionLedger?: SessionLedger;
  /** Circuit breaker config for this role. */
  circuitBreaker?: { threshold: number; state: { failures: number; tripped: boolean } };
  /** Called when the coordinator's context window is exhausted. */
  onContextLimit?: () => void;
  /** MonoFence guardrail instance for this role. */
  fence?: RoleFence;
  /** Decision gate: creates a hard-blocking human-approval checkpoint. */
  onGate?: (role: string, name: string, description: string) => Promise<string>;
  /** Task DAG: create a task with dependencies. `loadout` (ADR-O001 D7) is
   *  the catalog entry the caller selected; only offered when the org has a
   *  catalog (`loadoutCatalog`). */
  createTask?: (
    role: string,
    title: string,
    assignee: string,
    deps: string[],
    loadout?: string,
    brief?: string,
    pick?: TaskPick,
  ) => string;
  /** Resolves `assignee: "auto"` on org_task from the title and brief: the
   *  decision model (or, without one, a keyword match over role titles and
   *  responsibilities) picks among the agent roles other than `caller`.
   *  `role: null` = no role fits (or the best ones tie); the caller must name
   *  one. The pick is recorded on the task (OrgTask.pick). */
  pickAssignee?: (title: string, brief: string | undefined, caller: string) => Promise<RolePick>;
  /** Called after org_skill_load served one of the role's skills, so the
   *  daemon can record it against a task that suggested it. */
  onSkillLoad?: (role: string, name: string) => void;
  /** ADR-O001 D7: the org's loadout catalog. Set only when the org declares
   *  one; it adds the optional `loadout` argument to org_task/org_plan_graph.
   *  Unset, those tools are byte-identical to before (same gating idea as
   *  `requireTaskEvidence`). Identical for every role and every loadout, so
   *  the tool list — prefix position 0 — never varies with the loadout. */
  loadoutCatalog?: LoadoutSummary[];
  /** ADR-O001 D7: the loadout THIS session's system prompt is built with.
   *  Plain data resolved by the caller before the session starts, so it is
   *  fixed for the session's whole life — every maxTurns/crash restart
   *  rebuilds the identical prompt, and nothing can edit it mid-session.
   *  D3 hook: a task-keyed session for (role, taskKey) passes
   *  `resolveLoadout(def, task.loadout, root)` here. */
  loadout?: ResolvedLoadout;
  /** ADR-O001 D3 x D7: in task scope each task's session is built with that
   *  task's recorded loadout (undefined = none selected) instead of the
   *  incarnation's `loadout`, which then only serves untagged mail. */
  loadoutFor?: (taskId: string) => ResolvedLoadout | undefined;
  /** Task DAG: mark a task as completed. `evidence` is ADR-O001 D5's
   *  machine-checkable proof — acceptance commands with their real exit
   *  codes, pinned to a commit sha. Only demanded when the org sets
   *  run_config.completion_evidence (see `requireTaskEvidence`). */
  completeTask?: (role: string, taskId: string, result?: string, evidence?: TaskEvidence) => string;
  /** run_config.completion_evidence: when true, org_task_done advertises the
   *  evidence argument as required. Off by default, so a role in an org that
   *  has not opted in sees a byte-identical tool description (D7: the tool
   *  list is prefix position 0 — changing it for every org would invalidate
   *  every cached prompt). */
  requireTaskEvidence?: boolean;
  /** ADR-O001 D6: request an artifact-only review. Set only when the org has
   *  a role with review_input: 'artifact-only'; otherwise org_review is not
   *  registered and the tool list is unchanged. */
  requestReview?: (role: string, taskId: string, reviewer: string, base?: string) => string;
  /** Task DAG: list all tasks, or just `taskId`. */
  listTasks?: (taskId?: string) => string;
  splitTask?: (
    role: string,
    parentId: string,
    children: { title: string; assignee: string }[],
  ) => string;
  mergeTask?: (role: string, sourceId: string, targetId: string) => string;
  cancelTask?: (role: string, taskId: string, reason?: string) => string;
  /** Task DAG: mark a 'running' task as waiting on a real-world time (not a
   *  dependency) — e.g. a scheduled soak test, a CI run, a human-set
   *  deadline. The idle watchdog skips nudging while any task is actively
   *  blocked, auto-resumes (re-dispatches) it once the time passes, and
   *  wakes its assignee to re-check it every recheckAfterMinutes (#329). */
  blockTask?: (
    role: string,
    taskId: string,
    untilIso: string,
    reason?: string,
    recheckAfterMinutes?: number,
  ) => string;
  planGraph?: (
    role: string,
    specs: {
      name: string;
      title: string;
      assignee: string;
      after?: string[];
      loadout?: string;
      brief?: string;
    }[],
  ) => string;
}

/** Role briefing given to each agent session (SDK systemPrompt option).
 *  `extraGuidance` carries pre-resolved text the caller already loaded from
 *  disk — the role's library skills and/or its own `instructions_file`,
 *  if either resolved to something. Kept as a plain string param (not read here)
 *  so this function stays synchronous/pure and trivially testable. */
export function buildRolePrompt(
  role: OrgRole,
  def: Pick<OrgDef, 'name' | 'goal'>,
  roster: string[],
  glossary?: string[],
  extraGuidance?: string,
  /** M2: one line per endpoint role (endpointBriefingLines) — boss only. */
  endpointBriefing?: string[],
): string {
  const isCoordinator = role.reports_to == null;
  return [
    `You are agent "${role.id}" (${role.title || role.type}) in the org "${def.name}".`,
    `Org goal: ${def.goal}`,
    isCoordinator ? `You are the coordinator of this org.` : `You report to "${role.reports_to}".`,
    role.responsibilities?.length
      ? `Your responsibilities:\n- ${role.responsibilities.join('\n- ')}`
      : '',
    extraGuidance || '',
    `## Communication protocol`,
    `The ONLY way to communicate with other agents is the org_send tool.`,
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    endpointBriefing?.length ? `Automations in this org:\n${endpointBriefing.join('\n')}` : '',
    `If you need a human decision, call ask_human with your question, then end your turn - you'll receive the human's answer as a new message when it arrives. Do not call ask_human for anything you can resolve yourself.`,
    `For irreversible or high-risk actions (deployments, deletions, external communications), call org_gate to create a decision gate — a hard-blocking approval checkpoint. End your turn and wait for the human's approval or rejection before proceeding.`,
    `You can structure work as a task DAG: use org_task to create tasks with dependencies, org_task_done to mark them complete, and org_tasks to see the full DAG. Tasks with satisfied dependencies are automatically dispatched to their assignee.`,
    `The work graph is dynamic: call org_task_split when scope expands, org_task_merge when parallel branches converge early, or org_task_cancel when evidence makes a planned task moot. Use org_plan_graph to propose a full work graph in one call when you know the plan upfront. If a task genuinely can't proceed until a specific real-world time — a scheduled long-running process, a deadline someone gave you, anything with a known future unblock time — call org_task_block instead of leaving it idle: it stops the idle watchdog from nudging you about it and automatically resumes the task when the time arrives, instead of you repeatedly re-confirming "still waiting" every idle cycle.`,
    `Before starting substantial work, call org_recall to check what previous runs already learned or delivered - do not redo finished work.`,
    `The user's documents (notes, handbooks, specs) are searchable with knowledge_search - ground your work in them instead of guessing; results labeled [global] come from the user's personal cross-project brain.`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    isCoordinator
      ? `When the org's goal for this run is achieved (or clearly can't be): first call org_learn ONCE with the durable knowledge this run produced, then call org_complete exactly once with the outcome and a concise summary. Then end your turn.`
      : `When your current work is complete and no reply is needed, end your turn without further tool calls.`,
    isCoordinator && glossary?.length
      ? `Known entities (reuse these EXACT names in org_learn instead of near-duplicates): ${glossary.slice(0, 40).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The system prompt one session of this role is built with. */
function rolePromptFor(opts: SessionOpts): string {
  return buildRolePrompt(
    expandRolePromptVars(opts.role, promptVarsFor(opts.orgRoot ?? opts.cwd)),
    (opts.def ?? { name: opts.org, goal: '' }) as OrgDef,
    opts.def?.roles.map((r) => r.id) ?? [opts.role.id],
    opts.glossary,
    // D7: the loadout's text follows the role's own guidance. With no
    // loadout this is exactly resolveRoleExtraGuidance(role), as before.
    [resolveRoleExtraGuidance(opts.role, opts.orgRoot ?? opts.cwd), opts.loadout?.guidance]
      .filter(Boolean)
      .join('\n\n') || undefined,
    opts.onComplete ? endpointBriefingLines(opts.def) : undefined,
  );
}

/**
 * Runs a role for the life of the org, transparently restarting the
 * underlying SDK session whenever it ends on its own (`maxTurns` reached)
 * while the mailbox is still open. `maxTurns` bounds a single SDK query()
 * call's TOTAL turns, not "turns per incoming message" - since one query()
 * call stays open across every mailbox message for as long as the mailbox
 * itself stays open, without a restart the role would go permanently silent
 * (no crash, no alert) once its lifetime turn count crossed the limit, while
 * deliver() kept queuing new messages into a mailbox nobody was reading.
 */
export async function runAgentSession(opts: SessionOpts): Promise<void> {
  // `emit()` intentionally does not block agents on disk I/O, but a completed
  // session is a lifecycle boundary: callers may immediately summarize a run,
  // stop its daemon, or remove an isolated workspace.  Do not let queued bus
  // writes outlive that boundary (which could otherwise lose terminal events
  // or race cleanup of the run directory).
  try {
    await runAgentSessionLoop(opts);
  } finally {
    await opts.bus.flush();
  }
}

async function runAgentSessionLoop(opts: SessionOpts): Promise<void> {
  const { mailbox } = opts;
  // Carries the SDK's own session_id across a maxTurns restart so the next
  // query() call resumes the prior conversation instead of starting cold -
  // without this, a restart silently discarded all in-progress reasoning.
  // Seeded from opts.resumeSessionId (a checkpoint's persisted sessionId) when
  // this is a checkpoint resume, not a fresh run — P2-13.
  let resumeSessionId: string | undefined = opts.resumeSessionId;
  // #149: a resumeSessionId seeded from a persisted checkpoint (org run
  // --resume) points at an SDK session that may no longer exist on the
  // provider's side by the time resume happens — hours can pass between
  // `org stop` and `org run --resume`. Track whether we've already tried
  // falling back to a fresh session for THIS specific session id, so a
  // stale checkpoint session gets one recovery attempt instead of crashing
  // the whole role outright, but a second failure (a real, non-staleness
  // error) still crashes normally rather than looping forever.
  const initialResumeSessionId = opts.resumeSessionId;
  let triedFreshAfterResumeFailure = false;
  // #1: when a session ends on the turn limit mid-work, push a continuation so
  // the restarted query() has input to act on instead of blocking on an empty
  // mailbox until the 10-minute idle watchdog. Bounded: if the role consumed no
  // real message since the last restart (it is spinning on its own
  // continuations), stop auto-pushing after MAX_CONTINUATIONS and let the
  // watchdog re-engage — so a stuck role can't burn tokens forever.
  const MAX_CONTINUATIONS = 3;
  let consecutiveSpin = 0;
  // The SDK's result message reports total_cost_usd CUMULATIVELY for the whole
  // SDK session: one query() call stays open across every mailbox message
  // (streaming-input mode) and emits one result per message, and the running
  // total can survive a resume after a restart. daemon.ts and
  // reporting.ts both SUM the cost_usd of usage events, so forwarding the raw
  // value charged every previous turn again on each new message - observed as
  // ~10-20x cost inflation on long org runs. The meter outlives individual
  // runOneSession calls and emits only deltas; see cumulative-meter.ts for why
  // it is also told when a new process starts.
  const sessionCostTotals = new CumulativeMeter<{ usd: number }>();
  // ADR-O001 D1: modelUsage is cumulative per session exactly like
  // total_cost_usd, so it needs the same meter to become a delta.
  const sessionTokenTotals = new CumulativeMeter<TokenUsage>();
  // bwrap errors and a closed tool permission channel restart the process, bounded (sandbox-fault.ts).
  const faultRestarts = new FaultRestarts({
    bus: opts.bus,
    roleId: opts.role.id,
    coordinator: opts.role.reports_to ?? undefined,
    deliver: (from, to, subject, body) => sessionOpts.deliver(from, to, subject, body),
  });
  // ADR-O001 D3. 'role' scope (the default) keeps the pre-D3 loop exactly: one
  // model session for the role's life, resumed across maxTurns restarts via
  // resumeSessionId. 'task' scope keys model sessions by the task a message
  // belongs to: the process exits at a task boundary (or on idle) and the next
  // one resumes that task's session from the ledger. Either way every session
  // run is recorded with its session id before and after.
  const scope = resolveSessionScope(opts.role, opts.def);
  const idleExitMs = (opts.def?.run_config as { session_idle_exit_ms?: number } | undefined)
    ?.session_idle_exit_ms;
  const ledger = opts.sessionLedger ?? new SessionLedger();
  const runtimeKey = opts.role.runtime ?? opts.def?.runtime ?? 'claude';
  let taskKey = ROLE_SESSION_KEY;
  // Why the next fresh session for a key is fresh, when the loop itself threw
  // the record away (stale resume, turn-limit error) — recorded, not guessed.
  const droppedBecause = new Map<string, SessionStartReason>();
  const staleTried = new Set<string>();
  // The options THIS session is built from — the role's own, except that a
  // task-scoped session carries its task's loadout (D7).
  let sessionOpts: SessionOpts = opts;
  let promptHash = '*';
  // Task scope: which task last wrote to each correspondent, so their
  // untagged reply goes back to that task's session (see mailRouteKey).
  const correspondents = new Map<string, string>();
  // Always run at least once: a mailbox can be closed with queued items still
  // pending (stream() drains the queue before honoring `closed`), which is a
  // normal, valid starting state - checking isClosed before the first run
  // would skip that drain entirely.
  while (true) {
    // Opt-in only: keep the process DOWN until there is mail, instead of
    // starting a query() that parks on an empty mailbox. waitForMessage()
    // still returns true for a closed mailbox with queued items.
    if (scope !== 'role' || idleExitMs !== undefined) {
      if (!(await mailbox.waitForMessage())) return;
    }
    let startReason: SessionStartReason;
    if (scope === 'cold') {
      // D6: nothing carries over — not a checkpointed session, not the last
      // message's. Paying the cache miss here is the point.
      resumeSessionId = undefined;
      startReason = 'fresh-cold';
    } else if (scope === 'task') {
      // An untagged message (mail, an answer, a continuation) belongs to the
      // session the role is already in.
      taskKey = mailRouteKey(mailbox.peek() ?? '', correspondents) ?? taskKey;
      const key = taskKey;
      sessionOpts = {
        ...opts,
        // D7: this task's session is built with this task's loadout.
        ...(key !== ROLE_SESSION_KEY && opts.loadoutFor ? { loadout: opts.loadoutFor(key) } : {}),
        // Mail sent from a task's session names the task in its subject, so
        // the reader knows what it is about and a reply can find its way back.
        deliver: (from, to, subject, body) => {
          if (key === ROLE_SESSION_KEY) return opts.deliver(from, to, subject, body);
          correspondents.set(to, key);
          const tagged = subject.includes('[task:') ? subject : `[task:${key}] ${subject}`;
          return opts.deliver(from, to, tagged, body);
        },
      };
      promptHash = createHash('sha256')
        .update(rolePromptFor(sessionOpts))
        .digest('hex')
        .slice(0, 16);
      const pick = ledger.resumeFor({
        role: opts.role.id,
        runtime: runtimeKey,
        taskKey,
        cwd: opts.cwd,
        promptHash,
      });
      resumeSessionId = pick.sessionId;
      startReason =
        pick.reason === 'fresh-no-record'
          ? (droppedBecause.get(taskKey) ?? pick.reason)
          : pick.reason;
    } else {
      startReason = resumeSessionId ? 'resumed' : 'fresh-no-record';
    }
    const sessionKey = taskKey;
    const streamOpts: StreamOptions | undefined =
      scope === 'cold'
        ? { stopBefore: () => true, idleExitMs }
        : scope === 'task'
          ? {
              stopBefore: (next) => {
                const k = mailRouteKey(next, correspondents);
                return k !== undefined && k !== sessionKey;
              },
              idleExitMs,
            }
          : idleExitMs !== undefined
            ? { idleExitMs }
            : undefined;
    const sessionIdBefore = resumeSessionId;
    const startedAt = Date.now();
    const recordRun = (after: string | undefined, error?: string): void => {
      const run = ledger.recordRun({
        role: opts.role.id,
        runtime: runtimeKey,
        taskKey: sessionKey,
        sessionIdBefore,
        sessionIdAfter: after,
        reason: startReason,
        startedAt,
        endedAt: Date.now(),
        ...(error ? { error } : {}),
      });
      opts.bus.emit({
        type: 'audit',
        from: opts.role.id,
        reason: 'session-run',
        msg: `session ${run.resumed ? 'resumed' : 'started fresh'} (${startReason}) for ${sessionKey}`,
        data: run as unknown as Record<string, unknown>,
      });
    };
    const realBefore = mailbox.consumedRealCount;
    let sessionId: string | undefined;
    let hitTurnLimit: boolean | undefined = false;
    const attempt = { replied: false };
    // Task scope: this process works on one task, so cancelling it ends it.
    const tracked = trackTaskProcess(opts.taskProcesses, scope, sessionKey);
    try {
      const res = await runOneSession(
        sessionOpts,
        resumeSessionId,
        sessionCostTotals,
        attempt,
        sessionTokenTotals,
        streamOpts,
        faultRestarts.watch(sessionKey),
        tracked?.signal,
      );
      // Cancelled as the process was ending on its own: still owed the notice.
      if (tracked?.signal.aborted) throw tracked.signal.reason;
      sessionId = res.sessionId;
      hitTurnLimit = res.hitTurnLimit;
      resumeSessionId = sessionId;
      recordRun(sessionId);
      if (scope === 'task' && sessionId) {
        droppedBecause.delete(sessionKey);
        ledger.set({
          role: opts.role.id,
          runtime: runtimeKey,
          taskKey: sessionKey,
          cwd: opts.cwd,
          promptHash,
          sessionId,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      recordRun(undefined, errMsg);
      // #304 (review round 3): an org's own stop aborts whatever this attempt
      // was doing — max-turns and stale-resume below are diagnoses for a
      // genuinely failed attempt, not for one the org itself just cut off.
      // Both branches SWALLOW (the loop continues or returns normally instead
      // of rethrowing), so if either fired during a stop the daemon's role
      // loop never runs its catch at all: no agent-stopped, no crash audit —
      // runAgentSession simply resolves. Excluding a stop/external-abort from
      // both conditions lets the error fall through to `else { throw err; }`
      // instead, so the daemon classifies it the same way it classifies every
      // other abort during a stop. Neither branch's own "retry"/"continue"
      // promise is worth anything once the mailbox is closed anyway — the
      // very next check below (`mailbox.isClosed || mailbox.isDraining`)
      // returns immediately — so rethrowing here costs nothing.
      const stopping = mailbox.isClosed || (opts.externalAbort?.signal.aborted ?? false);
      if (!stopping && err instanceof TaskCancelledError) {
        // Its work is abandoned: the notice starts a fresh, small session.
        sessionId = undefined;
        resumeSessionId = undefined;
        ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: sessionKey });
        queueCancelNotice(err, mailbox, opts.bus, opts.role.id, sessionKey);
      } else if (!stopping && err instanceof ProcessFaultError) {
        // Same session, new process: resume it and tell the role why.
        resumeSessionId = err.sessionId ?? resumeSessionId;
        if (scope === 'task' && err.sessionId) {
          ledger.set({
            role: opts.role.id,
            runtime: runtimeKey,
            taskKey: sessionKey,
            cwd: opts.cwd,
            promptHash,
            sessionId: err.sessionId,
          });
        }
        mailbox.push(faultRestarts.restarted(sessionKey, err.kind));
      } else if (!stopping && /Reached maximum number of turns|error_max_turns/i.test(errMsg)) {
        // Runner/SDK threw an error on max turns or exhausted turns on resume.
        // Drop the dead resumeSessionId and grant continuation turn with fresh session.
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = true;
        if (scope === 'task') {
          ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: sessionKey });
          droppedBecause.set(sessionKey, 'fresh-after-turn-limit');
        }
      } else if (
        !stopping &&
        scope === 'task' &&
        sessionIdBefore !== undefined &&
        !staleTried.has(sessionKey) &&
        !attempt.replied
      ) {
        // D3's per-key form of #149 below: a recorded session that fails
        // before replying is treated as expired — forget it and retry that
        // task fresh once. Anything it had already pulled goes back first.
        staleTried.add(sessionKey);
        ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: sessionKey });
        droppedBecause.set(sessionKey, 'fresh-after-stale-resume');
        mailbox.reclaimInFlight();
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = false;
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'resume-session-stale',
          msg: `agent "${opts.role.id}" could not resume its session for ${sessionKey} — retrying with a fresh session`,
          data: { error: errMsg },
        });
      } else if (
        !stopping &&
        scope === 'role' &&
        resumeSessionId &&
        resumeSessionId === initialResumeSessionId &&
        !triedFreshAfterResumeFailure &&
        // #247: a resumed session that already replied was resumable — a
        // later failure is a real crash. Let it reach the daemon's
        // crash-restart (which resumes again) instead of silently
        // continuing in a fresh, context-less session.
        !attempt.replied
      ) {
        // #149: first failure on a checkpoint-provided session id — treat as
        // a stale/expired resume, not a genuine crash. Retry once with a
        // fresh session before falling into the crash/backoff path below;
        // a second failure with no resumeSessionId in play is a real error.
        triedFreshAfterResumeFailure = true;
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = false;
        // #304: no raw SDK text here either, same reason as runOneSession's
        // breadcrumb — this describes what session.ts itself did (retried),
        // not a characterisation of the underlying error. Kept in `data` for
        // debugging.
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'resume-session-stale',
          msg: `agent "${opts.role.id}" could not resume its prior session — retrying with a fresh session`,
          data: { error: errMsg },
        });
      } else {
        throw err;
      }
    } finally {
      tracked?.release();
    }
    // The dead session's generator may still hold the waker - drop it so a
    // push() before the next stream() starts only queues instead of being
    // consumed by the abandoned generator (silent message loss).
    mailbox.detach();
    // A draining mailbox (mid-run role replacement's graceful quiesce, see
    // Mailbox.beginDrain) is the same terminal condition as closed for THIS
    // loop's purposes: stream() already returned cleanly instead of throwing,
    // so without this check the loop would just keep calling runOneSession
    // forever, since isClosed alone stays false for a deliberate drain.
    if (mailbox.isClosed || mailbox.isDraining) return;
    const madeProgress = mailbox.consumedRealCount > realBefore;
    if (hitTurnLimit && madeProgress) consecutiveSpin = 0;
    if (hitTurnLimit) {
      if (!madeProgress) consecutiveSpin++;
      if (consecutiveSpin < MAX_CONTINUATIONS) {
        mailbox.push(
          `${Mailbox.CONTINUE_PREFIX} You reached the per-session turn limit while still working. Continue your in-progress task from where you left off; if nothing remains, end your turn.`,
        );
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'turn-limit-resume',
          msg: 'session restarting (turn limit reached, mailbox still open)',
        });
      } else {
        // Spinning on continuations alone — park for the watchdog instead of
        // looping forever. Reset so the watchdog's nudge buys a fresh budget.
        consecutiveSpin = 0;
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'turn-limit-park',
          msg: 'turn limit hit repeatedly with no new input — parking for idle watchdog',
        });
      }
    } else if (mailbox.lastStreamEnd) {
      // D3: the process ended on purpose — a task boundary or idle — and the
      // model session is kept for the next wake.
      opts.bus.emit({
        type: 'status',
        from: opts.role.id,
        reason: 'session-cycled',
        msg: `process cycled (${mailbox.lastStreamEnd}); model session kept for ${sessionKey}`,
        data: { taskKey: sessionKey, end: mailbox.lastStreamEnd, sessionId },
      });
    } else {
      opts.bus.emit({
        type: 'status',
        from: opts.role.id,
        msg: 'session restarting (turn limit reached, mailbox still open)',
      });
    }
  }
}

/** ADR-O001 D1 — token-metering helpers.
 *
 *  `cache_read_input_tokens` and `cache_creation_input_tokens` are siblings
 *  of `input_tokens` in the Anthropic API, not subsets of it, and both are
 *  billable. Everything below therefore sums all four. */
function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheCreation;
}

function addTo(target: TokenUsage, add: TokenUsage): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheCreation += add.cacheCreation;
}

/** One model turn's own usage, off an 'assistant' (or per-turn 'result')
 *  message. */
function turnBreakdown(m: AgentMessage): TokenUsage {
  return {
    input: m.input_tokens ?? 0,
    output: m.output_tokens ?? 0,
    cacheRead: m.cache_read_input_tokens ?? 0,
    cacheCreation: m.cache_creation_input_tokens ?? 0,
  };
}

/** What a 'result' message says this mailbox message consumed.
 *
 *  When the runner reports `cumulative_tokens` (the Claude SDK's whole-pipeline
 *  `modelUsage`, which unlike `usage` includes Task subagents and sidechains),
 *  that value is CUMULATIVE per session — the same lifecycle as
 *  `total_cost_usd` — so it is converted to a delta by the meter (see
 *  cumulative-meter.ts). Without `cumulative_tokens` the per-turn fields are
 *  used as before. */
function resultBreakdown(
  m: AgentMessage,
  tokenTotals: CumulativeMeter<TokenUsage> | undefined,
  sid: string,
): TokenUsage {
  const cum = m.cumulative_tokens;
  if (!cum) return turnBreakdown(m);
  const now: TokenUsage = {
    input: cum.input,
    output: cum.output,
    cacheRead: cum.cache_read,
    cacheCreation: cum.cache_creation,
  };
  return tokenTotals ? tokenTotals.delta(sid, now) : now;
}

/** ADR-O001 D1: the four quantities travel separately so every downstream
 *  consumer (forwarder → dashboard state.json, reporting, `org costs`) can
 *  record real values instead of the 0s they used to persist. `tokens` stays
 *  the single billable total. */
function emitUsage(
  bus: OrgBus,
  from: string,
  t: TokenUsage,
  costUsd: number | undefined,
  subtype: string | undefined,
): void {
  bus.emit({
    type: 'usage',
    from,
    data: {
      tokens: totalTokens(t),
      cost_usd: costUsd,
      subtype,
      tokens_in: t.input,
      tokens_out: t.output,
      cache_read: t.cacheRead,
      cache_creation: t.cacheCreation,
    },
  });
}

/** One bounded SDK session for a role; resolves with the SDK's session_id (for
 *  resuming on restart) and whether it ended by hitting the turn limit (so the
 *  caller can push a continuation) when the stream ends (mailbox closed or
 *  maxTurns reached). */
async function runOneSession(
  opts: SessionOpts,
  resume?: string,
  costTotals?: CumulativeMeter<{ usd: number }>,
  progress?: { replied: boolean },
  tokenTotals?: CumulativeMeter<TokenUsage>,
  streamOpts?: StreamOptions,
  faultWatch?: ReturnType<FaultRestarts['watch']>,
  cancelled?: AbortSignal,
): Promise<{ sessionId?: string; hitTurnLimit?: boolean }> {
  const { org, role, bus, policy, mailbox, cwd } = opts;
  // Each call starts a new runner process, whose cumulative totals may or may
  // not continue the previous one's (cumulative-meter.ts).
  costTotals?.newProcess();
  tokenTotals?.newProcess();
  // Read lastMessageId live from opts instead of capturing at session start
  // This ensures chat responses link to the most recent message delivered
  const getLastMessageId = () => (opts.lastMessageId ? opts.lastMessageId() : undefined);

  // Resolve runner. Precedence: explicit runner > queryFn-wrapped > default.
  // queryFn stays supported so daemon.ts / test-loop.ts need no changes.
  const runner: AgentRunner =
    opts.runner ?? (opts.queryFn ? new ClaudeAgentRunner(opts.queryFn) : defaultClaudeRunner);

  const tools = buildOrgTools(opts);
  // M1: provider tools are listed per session start, so a hot-reloaded
  // tool_providers block takes effect at the role's next session.
  const providerSet = opts.buildProviderTools ? await opts.buildProviderTools() : undefined;
  if (providerSet) tools.push(...providerSet.tools);

  // Named-provider resolution (`adapter_config.provider`): explicit role
  // provider wins, else the named entry from `monomind providers configure`.
  // The named provider's default model fills in adapter_config.model when the
  // role didn't pin one.
  const prov = resolveRoleProvider(role, opts.orgRoot ?? opts.cwd);
  // ADR-O001 D8: the role's cost tier, when the org declares one. Resolved
  // here — the single choke point where a role's model is decided — so the
  // documented precedence holds in exactly one place:
  //   explicit adapter_config.model > tier > named-provider default > runtime
  // The tier's EFFORT is applied even when the model came from an explicit
  // pin: which model to run and how hard to think are separate axes, and
  // silently dropping the effort because a model was pinned would be the
  // "silent downgrade" this decision exists to prevent.
  // Throws (fails the session) rather than guessing when the tier has no
  // entry for this role's provider — daemon.ts validates the whole roster
  // up front so that is normally caught before any token is spent.
  const tier = resolveRoleCostTier({
    role,
    def: opts.def,
    vendor: role.provider?.vendor ?? prov.cfg?.vendor,
  });
  const model =
    role.adapter_config?.model ??
    tier?.model ??
    prov.defaultModel ??
    resolveModel(role, role.runtime, role.provider?.vendor ?? prov.cfg?.vendor);

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  let sessionId: string | undefined = resume;
  let hitTurnLimit = false;
  let contextLimitFired = false;
  // #budget-realtime: real tokens already accounted for the message CURRENTLY
  // in flight, via the per-assistant-turn accounting below — reset to 0 each
  // time a 'result' message ends one mailbox message and the next one starts.
  // Exists purely so the 'result' branch never re-adds what this branch
  // already added (see there for why it can't just always add).
  let messageTurnTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  // Abort hook for the runner (AgentRunArgs.signal): the silent-stream
  // abort below used to call iterator.return() only, which queues behind a
  // subprocess runner blocked in `for await (child.stdout)` — the child was
  // never killed, so every supervisor retry stacked another live CLI.
  //
  // Per attempt, linked one way to the caller's externalAbort (#256): the
  // silent-stream abort used to fire the daemon's slot controller itself,
  // permanently. Every retry then started on an already-aborted signal (a
  // runner honoring it kills its child at once) and the daemon's crash
  // backoff, which races that controller to notice an org stop, resolved
  // immediately - the role burned its retries and crashed. An org stop still
  // aborts the attempt; the attempt's own abort stays its own.
  const abort = new AbortController();
  const external = opts.externalAbort?.signal;
  const onExternalAbort = (): void => abort.abort(external?.reason);
  if (external?.aborted) onExternalAbort();
  else external?.addEventListener('abort', onExternalAbort, { once: true });
  // org_task_cancel for this process's task: end it the same way (task-cancel.ts).
  // Already aborted when it landed during the setup awaits above.
  const unlinkCancelled = linkAbort(cancelled, abort);
  try {
    // #258: policy.git enforced where git runs, not only by Bash text
    // classification — guard env for every runtime, OS sandbox + file-tool
    // deny rules for Claude. Throws (session fails) when the role requires
    // the sandbox and it can't start.
    // Before the sandbox is built: it can only mask directories that exist.
    ensureAuthorityDirs(homedir(), process.env);
    const gitEnforcement = resolveRoleGitEnforcement({
      org,
      role,
      cwd,
      orgRoot: opts.orgRoot,
      orgDir: opts.orgDir,
      bus,
      claudeRuntime: runner instanceof ClaudeAgentRunner,
      runtime: role.runtime ?? opts.def?.runtime,
    });
    // What this session really got, not what the config asked for (policy-git.ts).
    policy.setOsSandboxed(!!gitEnforcement.claudeRestrictions?.sandbox);
    const authorityMask = roleAuthorityMask({
      bus,
      roleId: role.id,
      inSdkSandbox: !!gitEnforcement.claudeRestrictions?.sandbox,
      // vercel runs in-process with no shell; its file tools go through the policy engine.
      inProcess: (role.runtime ?? opts.def?.runtime) === 'vercel',
      cwd,
      orgRoot: opts.orgRoot,
    });
    const stream = runner.run({
      tools,
      // No options = the pre-D3 stream, exactly.
      prompt: streamOpts ? mailbox.stream('', streamOpts) : mailbox.stream(),
      systemPrompt: gitEnforcement.claudeRestrictions?.sandbox
        ? `${rolePromptFor(opts)}\n\n${claudeSandboxCwdNote(cwd)}`
        : rolePromptFor(opts),
      model,
      cwd,
      effort: tier?.effort,
      env: {
        ...resolveProviderEnv(prov.cfg),
        // D8: how a NON-Claude provider expresses the tier's effort level.
        // Empty for Claude (handled natively by ClaudeAgentRunner) and for a
        // provider that declares no mechanism — which simply ignores effort.
        ...(tier?.env ?? {}),
        // Claude Code's 2-minute Bash default is too short for org work.
        ...(runner instanceof ClaudeAgentRunner
          ? claudeBashTimeoutEnv(opts.def?.run_config?.bash_timeout_ms)
          : {}),
        // Custom-endpoint providers (named-provider path): pin the engine's
        // model env so background/haiku tasks also route to the endpoint's
        // model instead of erroring on an Anthropic-only default.
        ...(prov.cfg?.authToken
          ? { ANTHROPIC_MODEL: model, ANTHROPIC_SMALL_FAST_MODEL: model }
          : {}),
        ...gitEnforcement.env,
        ...(gitEnforcement.claudeRestrictions?.sandbox ? CLAUDE_SANDBOX_CWD_ENV : {}),
        // No MONOMIND_HOOK_QUIET / MONOMIND_GRAPH_GATE / MONOMIND_SDK_AGENT
        // here (#249): every CLI hands this env to its shell tool, so they
        // reached every command the role ran and silently muted monomind's
        // own hooks, graph gate and tests inside the role. ClaudeAgentRunner
        // loads no filesystem hooks (settingSources: []). The codex/kimi/
        // opencode hook bridges generated by `monomind init` read the
        // MONOMIND_ORG_ROLE marker below and set the quieting vars on the
        // hook-handler process they spawn — hooks stay quiet, commands don't.
        //
        // Per-role scoping for runners that persist state under the org dir
        // (VercelAgentRunner session files). Without these, session files would
        // land in args.cwd (project root for workspace:'repo') under the literal
        // 'default' roleId, polluting the repo and making files unattributable.
        MONOMIND_ORG_DIR: opts.orgDir ?? opts.cwd,
        MONOMIND_ROLE_ID: role.id,
        // M1: attribution for anything the role runs (C-16).
        MONOMIND_ORG_NAME: org,
        MONOMIND_ORG_ROLE: role.id,
        ...(opts.run ? { MONOMIND_ORG_RUN: opts.run } : {}),
        ...(opts.orgRoot ? { MONOMIND_ORG_ROOT: opts.orgRoot } : {}),
      },
      maxTurns: opts.maxTurns ?? 30,
      maxToolRounds: role.max_tool_rounds ?? opts.def?.run_config?.max_tool_rounds,
      resume,
      claudeRestrictions: gitEnforcement.claudeRestrictions,
      authorityMask,
      // ADR-O001 D2: tool results are 76% of a role's context mass and nothing
      // bounded them. Under the ORG STATE dir (never the workspace cwd, which
      // may be the repo), and under orgRoot — which file-roots.ts already
      // makes readable to the role's file tools and role-sandbox.ts already
      // makes readable to Bash — so the path in the digest actually resolves
      // when the role decides it needs the full text.
      toolSpillDir: join(
        opts.orgDir ?? opts.cwd,
        'tool-results',
        role.id.replace(/[^a-zA-Z0-9_.-]/g, '_'),
      ),
      canUseTool: gatedCanUseTool(
        policy,
        opts.beforeTool,
        role.id,
        opts.fence,
        opts.onDecision
          ? (toolName, _input, decision, kind) =>
              opts.onDecision?.(role.id, toolName, decision.message ?? 'denied', kind)
          : undefined,
        opts.hasPendingGate,
      ),
      // test seam forwarded through extras: lets the scripted fake SDK
      // (test-loop.ts) drive org_send and tool calls through the real
      // deliver/policy paths; the real SDK ignores it.
      extras: opts.runner
        ? undefined
        : {
            _orgTest: {
              deliver: (to: string, subject: string, body: string) =>
                opts.deliver(role.id, to, subject, body),
              callTool: (name: string, input: Record<string, unknown>) =>
                policy.decide(name, input),
            },
          },
      signal: abort.signal,
      // VercelAgentRunner-only fields — ignored by other runners.
      vendor: role.provider?.vendor,
      providerConfig: role.provider,
    } as any);

    // A silent session is its own failure mode, and until now an unnameable
    // one: nine consecutive cycles of a scheduled org opened all seven streams
    // and yielded NOTHING - no assistant message, no result, no error, and no
    // stream end. The only symptom was the idle watchdog reporting the boss
    // "appears hung" twenty minutes later, which described neither the scope
    // (every role) nor the cause.
    //
    // Naming it used to be all this did: log an audit event at 4 minutes and
    // then keep waiting on the same stuck `for await`, so recovery still
    // depended on the org-wide idle watchdog (10m nudge + 10m stop = 20m of
    // dead time per cycle - and it kills the WHOLE run, not just the stuck
    // session). Only the FIRST pull from the stream is raced against the
    // timeout: once any message has arrived the session is demonstrably
    // alive, so a slow-but-working tool call is never mistaken for a stall.
    // On silence, abandon this attempt (best-effort iterator.return() to
    // signal the SDK) and throw - the caller's crash-retry-with-backoff loop
    // (daemon.ts's `runtime.done`) already knows how to retry a failed
    // session with a fresh query() call and, for the boss, escalate to a
    // whole-org restart if it keeps failing. That gives the SDK several
    // fresh attempts within a single cycle instead of one silent attempt
    // followed by twenty minutes of nothing.
    const openedAt = Date.now();
    const detector = new StateDetector();
    const iterator = stream[Symbol.asyncIterator]();
    const SILENT = Symbol('silent');
    let silentTimer: ReturnType<typeof setTimeout> | undefined;
    const silentMs = opts.silentSessionMs ?? SILENT_SESSION_MS;
    const firstPull = await Promise.race([
      iterator.next(),
      new Promise<typeof SILENT>((resolve) => {
        silentTimer = setTimeout(() => resolve(SILENT), silentMs);
        (silentTimer as { unref?: () => void }).unref?.();
      }),
    ]);
    clearTimeout(silentTimer);
    if (firstPull === SILENT) {
      bus.emit({
        type: 'audit',
        from: role.id,
        reason: 'session-silent',
        msg: `SDK stream open ${Math.round((Date.now() - openedAt) / 1000)}s with zero messages - aborting this attempt and retrying. Set MONOMIND_DEBUG=1 to log raw message types.`,
      });
      // Kill the runner's subprocess FIRST: iterator.return() below cannot
      // reach a runner blocked in its stdout loop, and the retry would
      // otherwise spawn a second CLI next to the still-running first one.
      abort.abort();
      try {
        await Promise.race([
          iterator.return?.(undefined) ?? Promise.resolve(),
          new Promise<void>((r) => {
            const t = setTimeout(() => r(), 2_000);
            (t as { unref?: () => void }).unref?.();
          }),
        ]);
      } catch {
        /* best-effort */
      }
      throw new Error(
        `org "${org}" role "${role.id}": SDK stream silent for ${Math.round(silentMs / 1000)}s with zero messages`,
      );
    }
    const first: IteratorResult<AgentMessage> = firstPull;

    // Replay the first pulled message, then continue draining normally.
    async function* rest(): AsyncGenerator<AgentMessage> {
      if (!first.done) yield first.value;
      while (true) {
        const r = await iterator.next();
        if (r.done) return;
        yield r.value;
      }
    }

    for await (const m of rest()) {
      if (process.env.MONOMIND_DEBUG) {
        console.error(
          `[orgrt:${org}/${role.id}] runner message type=${m.type} subtype=${String(m.subtype ?? '-')}`,
        );
      }
      if (cancelled?.aborted) throw cancelled.reason;
      mailbox.observeTurn(m.type); // the prompt stream outlives a live turn (#331)
      if (m.session_id) {
        sessionId = m.session_id;
        // P2-13: propagate the session ID back to the daemon so checkpoints
        // can resume the SDK session after a crash/restart.
        opts.onSessionId?.(sessionId);
      }
      const prevState = detector.current();
      const textForDetect = m.type === 'assistant' ? m.text || '' : undefined;
      const newState = detector.onMessage(m.type, m.subtype, textForDetect);
      if (newState !== prevState) {
        bus.emit({
          type: 'status',
          from: role.id,
          reason: 'state-change',
          msg: `${prevState} → ${newState}`,
          data: { from: prevState, to: newState },
        });
      }
      if (m.type === 'assistant') {
        if (progress) progress.replied = true;
        const text = m.text || '';
        if (text.trim()) {
          opts.onOutput?.(text);
          bus.emit({ type: 'chat', from: role.id, msg: text, parentId: getLastMessageId() });
          if (opts.onContextLimit && !contextLimitFired && CONTEXT_LIMIT_RE.test(text)) {
            contextLimitFired = true;
            bus.emit({
              type: 'audit',
              from: role.id,
              reason: 'boss-context-limit',
              msg: 'coordinator context window exhausted — requesting whole-org restart with fresh sessions',
            });
            opts.onContextLimit();
          }
        }
        // #budget-realtime (HIGH): the SDK's 'result' message arrives once per
        // WHOLE mailbox message in streaming-input mode — with
        // max_turns_per_message defaulting to 100,000, a single message can
        // internally loop through hundreds/thousands of tool-use turns before
        // that 'result' ever arrives, during which policy.used never moved and
        // policy.decide() allowed every one of those turns' tool calls
        // regardless of real spend (the overspend was already done by the time
        // overBudget could ever trip). Each 'assistant' SDK message DOES carry
        // that ONE model turn's real usage (agent-runner.ts reads it off
        // BetaMessage.usage) — accumulate it as turns actually happen and
        // enforce the budget immediately, so overBudget can close the mailbox
        // DURING a runaway message instead of only once it finally completes.
        // (USD budget can't get the same real-time treatment: the SDK only
        // exposes cost as a cumulative total on 'result', not per-turn on
        // 'assistant' — verified against this project's Claude Agent SDK
        // .d.ts, which puts `usage`/token counts on BetaMessage but cost only
        // on SDKResultSuccess.total_cost_usd/modelUsage. overBudgetUsd is
        // still checked below, once per message, same as before this fix.)
        //
        // ADR-O001 D1: the sum must include BOTH cache fields. They are
        // siblings of input_tokens in the Anthropic API, not subsets of it —
        // `input_tokens` is the uncached remainder — and both are billable
        // (~0.1x and ~1.25x input). Omitting them meant the better the cache
        // worked the less the meter saw: on one measured run, 2,765M tokens
        // billed against 8.1M recorded, with input_tokens at 0.0M.
        const turn = turnBreakdown(m);
        const turnTokens = totalTokens(turn);
        if (turnTokens > 0) {
          addTo(messageTurnTokens, turn);
          policy.addTokenUsage(turn);
          if (policy.overBudget) {
            bus.emit({
              type: 'status',
              from: role.id,
              reason: 'budget-exhausted',
              msg: 'token budget exhausted - closing session',
            });
            mailbox.close('token-budget');
          }
        }
      } else if (m.type === 'tool_result') {
        // #289: the tool call's outcome. Until this event existed, a Bash
        // running a test suite looked identical on the bus whether the suite
        // passed, failed, or the binary was missing — one 'allow' at the moment
        // it started — so every consumer inferred success from the agent's own
        // narration. `call_id` joins this back to that invocation event; the
        // body is redacted and capped (policy.ts) so a megabyte of output, or a
        // credential echoed by a command, never lands in bus.jsonl.
        const body = summarizeToolOutput(m.text ?? '');
        const data: ToolResultEventData = {
          ...(m.tool_use_id ? { call_id: m.tool_use_id } : {}),
          ok: m.is_error !== true,
          ...(typeof m.duration_ms === 'number' ? { duration_ms: m.duration_ms } : {}),
          output: body.output,
          ...(body.truncated ? { truncated: true } : {}),
          output_chars: body.output_chars,
        };
        bus.emit({
          type: 'tool_result',
          from: role.id,
          ...(m.tool ? { tool: m.tool } : {}),
          data: data as unknown as Record<string, unknown>,
        });
        faultWatch?.observe(m, sessionId);
      } else if (m.type === 'result') {
        // ADR-O001 D1: prefer the SDK's `modelUsage` over `usage`. The SDK
        // documents `usage` as "MAIN AGENT LOOP ONLY — excludes Task
        // subagent, sidechain, and auxiliary model calls ... Prefer
        // modelUsage for token/cost accounting"; the measured run made 46
        // subagent calls this counter never saw. modelUsage is CUMULATIVE per
        // session (same lifecycle as total_cost_usd, per its own type doc),
        // so it is converted to a delta here rather than added, exactly as
        // cost is below. A runner that reports no modelUsage falls back to
        // the per-turn `usage` fields, which keep their old semantics.
        const resultTokens = resultBreakdown(m, tokenTotals, m.session_id ?? sessionId ?? '');
        // Per the SDK's own type docs, a 'result' message's usage is that
        // message's own (effectively last-turn) usage in streaming-input mode,
        // NOT a cumulative total across every turn of the mailbox message —
        // and that last turn was already counted above via its own 'assistant'
        // message, specifically so overBudget could trip mid-message. Adding
        // the result's own usage again unconditionally would double-count it.
        // (A modelUsage-derived delta is per-session-cumulative, so the same
        // subtraction is exactly right there too: it removes what the
        // assistant turns of THIS message already contributed and leaves the
        // subagent/auxiliary volume the main loop never reported.) Only make
        // up the shortfall (never negative) so a turn whose usage somehow
        // never reached the 'assistant' branch (e.g. a runner/test double that
        // doesn't emit per-turn usage) still gets counted at least once.
        const shortfall: TokenUsage = {
          input: Math.max(0, resultTokens.input - messageTurnTokens.input),
          output: Math.max(0, resultTokens.output - messageTurnTokens.output),
          cacheRead: Math.max(0, resultTokens.cacheRead - messageTurnTokens.cacheRead),
          cacheCreation: Math.max(0, resultTokens.cacheCreation - messageTurnTokens.cacheCreation),
        };
        if (totalTokens(shortfall) > 0) policy.addTokenUsage(shortfall);
        // What this whole mailbox message actually added to the meter: the
        // per-turn accounting above plus whatever the result topped up. This
        // is what the 'usage' event reports, so a consumer summing events
        // lands on the same number as policy.usage.
        const messageTokens: TokenUsage = {
          input: messageTurnTokens.input + shortfall.input,
          output: messageTurnTokens.output + shortfall.output,
          cacheRead: messageTurnTokens.cacheRead + shortfall.cacheRead,
          cacheCreation: messageTurnTokens.cacheCreation + shortfall.cacheCreation,
        };
        messageTurnTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
        // Convert the SDK's cumulative total_cost_usd into a per-result
        // delta before emitting - downstream sums usage events. A new session
        // id counts in full; a same-process dip (rounding, a provider-side
        // correction) floors at 0 rather than re-adding the cumulative cost,
        // which feeds USD budget enforcement (ORG-7). A resume in a new
        // process is judged by the meter (cumulative-meter.ts).
        let costDelta = m.cost_usd;
        if (costTotals && typeof m.cost_usd === 'number' && Number.isFinite(m.cost_usd)) {
          const sid = m.session_id ?? sessionId ?? '';
          costDelta = costTotals.delta(sid, { usd: m.cost_usd }).usd;
        }
        // ORG-7: accumulate real USD cost so policy.overBudgetUsd (role.budget_usd) is enforceable.
        if (typeof costDelta === 'number' && Number.isFinite(costDelta))
          policy.addUsageUsd(costDelta);
        emitUsage(bus, role.id, messageTokens, costDelta, m.subtype);
        if (m.subtype && m.subtype !== 'success') {
          if (m.subtype === 'error_max_turns') hitTurnLimit = true;
          bus.emit({
            type: 'audit',
            from: role.id,
            reason: 'session-result-error',
            msg: `turn ended with subtype "${m.subtype}"${m.is_error ? ' (is_error)' : ''} - the role produced no usable output`,
          });
          if (opts.circuitBreaker && m.subtype !== 'error_max_turns') {
            const cb = opts.circuitBreaker;
            cb.state.failures++;
            if (cb.state.failures >= cb.threshold) {
              cb.state.tripped = true;
              bus.emit({
                type: 'audit',
                from: role.id,
                reason: 'circuit-breaker-tripped',
                msg: `circuit breaker tripped after ${cb.state.failures} consecutive failures — closing role`,
                data: { failures: cb.state.failures, threshold: cb.threshold },
              });
              mailbox.close();
            }
          }
        } else if (m.subtype === 'success' && opts.circuitBreaker) {
          opts.circuitBreaker.state.failures = 0;
        }
        if (policy.overBudget) {
          bus.emit({
            type: 'status',
            from: role.id,
            reason: 'budget-exhausted',
            msg: 'token budget exhausted - closing session',
          });
          // #205: tag WHY the mailbox closed. A budget-exhausted boss is
          // recoverable (raise the budget, resume) — the idle watchdog reads
          // this to stop reporting it as generic "unreachable" (crash-like).
          mailbox.close('token-budget');
        }
        // ORG-7: parallel USD-budget enforcement, same pattern as the token check above.
        if (policy.overBudgetUsd) {
          bus.emit({
            type: 'status',
            from: role.id,
            reason: 'budget-exhausted',
            msg: 'USD budget exhausted - closing session',
          });
          mailbox.close('usd-budget');
        }
        // The turn is over: whatever tool calls it was going to make, it has
        // made. What the role left open is knowable here (decisions.ts's
        // nudgeOpenTasksAtTurnEnd) instead of only to the idle watchdog.
        opts.onTurnEnd?.();
      }
    }
    if (cancelled?.aborted) throw cancelled.reason;
    bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
    return { sessionId, hitTurnLimit };
  } catch (err) {
    // The turn in flight never got its 'result', so its metered turns (already
    // in policy) have no usage event yet. Cost is only on 'result': unknown.
    if (totalTokens(messageTurnTokens) > 0)
      emitUsage(bus, role.id, messageTurnTokens, undefined, 'aborted');
    // Ending the process was the point; sandbox-fault.ts already audited it.
    if (err instanceof ProcessFaultError) throw err;
    if (cancelled?.aborted) throw cancelled.reason;
    // org_complete / org stop close the mailbox and abort every session: a
    // normal stop, not a failure. The daemon still classifies it.
    const message = err instanceof Error ? err.message : String(err);
    if (
      (mailbox.isClosed || (external?.aborted ?? false)) &&
      ((err as { name?: string } | null)?.name === 'AbortError' || /\baborted\b/i.test(message))
    ) {
      bus.emit({
        type: 'status',
        from: role.id,
        reason: 'session-stopped',
        msg: 'session stopped',
      });
      throw err;
    }
    // #304: the daemon's role loop catches this same error one step later and
    // emits the authoritative CLASSIFIED status — crashed / stopped with the
    // org / terminated by stop — carrying the real error text when it is a
    // genuine crash (daemon.ts's 'agent-session-crash' audit). This
    // breadcrumb must not pre-empt that with the raw SDK string: on a
    // planned stop it announced "Claude Code process aborted by user" about
    // a stop nobody requested. It deliberately does NOT classify —
    // session.ts relays, the daemon decides — and it carries a `reason` so
    // it is filterable; its absence is why every #304/#251 test was
    // structurally unable to see this event.
    bus.emit({
      type: 'status',
      from: role.id,
      reason: 'session-error',
      msg: 'session ended with an error — see the classified status that follows',
    });
    throw err;
  } finally {
    // Unlink so a long-lived role doesn't pile a listener per attempt onto the
    // slot controller. Aborting the finished attempt keeps a runner abandoned
    // mid-stream by a throw from outliving it now that an org stop can no
    // longer reach it.
    external?.removeEventListener('abort', onExternalAbort);
    unlinkCancelled();
    abort.abort();
    providerSet?.close();
  }
}

/** Build the org tool surface as platform-agnostic OrgToolDef[]. The handlers
 *  close over sessionOpts callbacks (deliver, recall, remember, …) — same
 *  wiring as the previous inline createSdkMcpServer block, just decoupled from
 *  the Claude SDK's tool() shape so any AgentRunner can host them.
 *
 *  Behaviour is identical to the old inline definitions: conditional tools are
 *  gated on their callback being present, org_send/ask_human are always added. */
export { AUTO_ASSIGNEE } from './task-tools.js';

export function buildOrgTools(opts: SessionOpts): OrgToolDef[] {
  const { role, deliver } = opts;
  const tools: OrgToolDef[] = [];
  const text = (t: string): { text: string } => ({ text: t });

  const searchKnowledge = opts.searchKnowledge;
  if (searchKnowledge) {
    tools.push({
      name: 'knowledge_search',
      description:
        "Semantic search over the user's Second Brain: this project's indexed documents plus their personal cross-project global brain. Use to ground work in the user's actual notes, handbooks, and documents.",
      schema: { query: z.string() },
      handler: async (args) => text(await searchKnowledge(role.id, args.query as string)),
    });
  }
  tools.push(...skillTools(role, opts.orgRoot ?? opts.cwd, opts.onSkillLoad));
  const recall = opts.recall;
  if (recall) {
    tools.push({
      name: 'org_recall',
      description:
        "Search this org's accumulated memory from previous runs (outcomes, decisions, learnings). Use before starting work that may already have been done.",
      schema: { query: z.string() },
      handler: async (args) => text(await recall(role.id, args.query as string)),
    });
  }
  const remember = opts.remember;
  if (remember) {
    tools.push({
      name: 'org_remember',
      description:
        'Save a memory for future runs. scope "org" (default) shares it with the whole org; scope "agent" keeps it private to your role. Use for decisions, findings, and state worth recalling later - org_recall searches both.',
      schema: { content: z.string(), scope: z.enum(['org', 'agent']).optional() },
      handler: async (args) =>
        text(
          await remember(role.id, args.content as string, (args.scope as 'org' | 'agent') ?? 'org'),
        ),
    });
  }
  const learn = opts.learn;
  if (learn) {
    tools.push({
      name: 'org_learn',
      description:
        "Persist durable knowledge from this run into the org's knowledge graph: entities ({name, type?, description?}), relationships ({source, target, relation, description?}) and reusable rules ({rule, context?}). Entities merge by name across runs - reuse the exact names listed in your briefing. Call once, before org_complete.",
      schema: {
        nodes: z
          .array(
            strictArgs({
              name: z.string(),
              type: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
        edges: z
          .array(
            strictArgs({
              source: z.string(),
              target: z.string(),
              relation: z.string(),
              description: z.string().optional(),
            }),
          )
          .optional(),
        rules: z.array(strictArgs({ rule: z.string(), context: z.string().optional() })).optional(),
      },
      handler: async (args) => text(await learn(role.id, args as any)),
    });
  }
  // Gate purely on onComplete: the daemon passes it only to the role its
  // boss-selection rule picked, so tool availability always matches the
  // kickoff instruction (reports_to may be non-null for a fallback boss).
  if (opts.onComplete) {
    tools.push({
      name: 'org_complete',
      description:
        '⚠️ Ends the run — every agent session shuts down after this. Call exactly once, and only against the org\'s actual, full stated goal (see your briefing), never against just the current batch of dispatched tasks. "achieved" means the WHOLE goal is done, not "everyone assigned so far finished their piece" — a multi-phase or open-ended goal is very rarely achieved in a single run. If the current task batch is clearly done but the goal has more scope left: do NOT call this — use org_task/createTask to dispatch the next phase\'s work instead, so the org keeps making progress instead of stopping short. "achieved" only when the full goal is met; "failed" only when it clearly cannot be — neither requires a blocker (though if this org\'s run_config.completion is set to \'dag\', "achieved" is ALSO refused while org_tasks still has runnable work that is not blocked on a real-world time — check org_tasks first if that setting applies to you). Use outcome "partial" only when you are ending the run with real scope still remaining, and you MUST name why with `blocker`: \'budget\' (a role is genuinely near its token/USD ceiling), \'human\' (an ask_human question or decision gate is actually pending), \'time\' (if the only thing blocking further work is a scheduled process or deadline you know the time of, call org_task_block instead of ending the run so a future run can pick back up automatically — this blocker is refused unless a task is actually blocked that way), or \'external\' (anything else — `blockerDetail` must be a real, substantive explanation; placeholders like "none"/"n/a" and anything under 10 characters are refused, because this is the one blocker nothing else can check, and it is recorded verbatim in the run history under your name). A refusal names which of these to use instead. Before calling, check org_tasks — siblings with in-progress work only get a short drain window to finish before being cut off, so do not call this while others are still mid-build or mid-edit unless the run genuinely cannot continue. The outcome and summary are persisted to the org run history and briefed to the next run. If the run produced a concrete deliverable (a post, document, message, piece of content, code, etc.), summary MUST include that deliverable\'s full text verbatim — not a meta-description of what happened. Someone reading only summary should be able to see the actual result, not just that "a result was produced".',
      schema: {
        outcome: z.enum(['achieved', 'partial', 'failed']),
        summary: z.string(),
        blocker: z.enum(['budget', 'human', 'external', 'time']).optional(),
        blockerDetail: z.string().optional(),
      },
      handler: async (args) => {
        const refusal = opts.onComplete?.(
          role.id,
          args.outcome as 'achieved' | 'partial' | 'failed',
          args.summary as string,
          args.blocker as 'budget' | 'human' | 'external' | 'time' | undefined,
          args.blockerDetail as string | undefined,
        );
        // #302: a refusal must not claim the outcome was recorded — nothing
        // was, and the daemon never emitted the event that would stop the run.
        if (refusal) return text(refusal);
        return text(`outcome "${args.outcome}" recorded`);
      },
    });
  }
  const onRespawnRole = opts.onRespawnRole;
  if (onRespawnRole) {
    tools.push({
      name: 'org_respawn_role',
      description:
        "Replace one crashed, exhausted, or unsuitable WORKER role with a fresh session — keeping its role id, workspace, task ownership, and queued messages. Cannot target the coordinator (yourself) or an unknown/removed/not-yet-started role. Omit runtime/model/providerName to keep their current values. Omitted budgetTokens uses the normal per-role allocation for this run; it cannot raise the org-wide token budget. reason is a short operational reason for the audit log; briefing is what the replacement should know to continue the work — it starts a FRESH model session with no memory of the old one's conversation, so include everything it needs.",
      schema: {
        roleId: z.string(),
        runtime: z.string().optional(),
        model: z.string().optional(),
        providerName: z.string().optional(),
        budgetTokens: z.number().optional(),
        reason: z.string(),
        briefing: z.string(),
      },
      handler: async (args) => {
        const receipt = await onRespawnRole(role.id, args as any);
        return text(JSON.stringify(receipt));
      },
    });
  }
  const onListRuntimeOptions = opts.onListRuntimeOptions;
  if (onListRuntimeOptions) {
    tools.push({
      name: 'org_list_runtime_options',
      description:
        'List every runtime this daemon knows how to run a role on (availability, detected binary/version, install hint) and every named provider configured for this project (name and default model only — never keys, tokens, or endpoints). Use before org_respawn_role to pick a real runtime/providerName. "available" means locally resolvable/detected, not that login, quota, or a remote model is valid.',
      schema: {},
      handler: async () => text(JSON.stringify(await onListRuntimeOptions())),
    });
  }
  const onGate = opts.onGate;
  if (onGate) {
    tools.push({
      name: 'org_gate',
      description:
        'Create a decision gate — a hard-blocking human-approval checkpoint. Use before irreversible actions (deployments, deletions, external comms). The gate pauses your work until a human approves or rejects it. End your turn after calling this; you will receive the resolution as a new message.',
      schema: { name: z.string(), description: z.string() },
      handler: async (args) =>
        text(await onGate(role.id, args.name as string, args.description as string)),
    });
  }
  // ADR-O001 D7: the `loadout` argument exists only for an org with a
  // catalog, so every other org's tool list stays byte-identical.
  const catalog = opts.loadoutCatalog?.length ? opts.loadoutCatalog : undefined;
  const loadoutArg: Record<string, z.ZodType> = catalog
    ? { loadout: z.enum(catalog.map((l) => l.name) as [string, ...string[]]).optional() }
    : {};
  // Sent with the dispatch itself (task-provenance.ts dispatchLine), so the
  // instructions arrive with the task instead of in a follow-up message.
  const briefArg = z.string().max(MAX_TASK_BRIEF).optional();
  const orgTask = orgTaskTool(opts, loadoutArg, briefArg);
  if (orgTask) tools.push(orgTask);
  const completeTask = opts.completeTask;
  if (completeTask) {
    tools.push({
      name: 'org_task_done',
      description: opts.requireTaskEvidence
        ? 'Mark a task as completed. This org requires EVIDENCE (run_config.completion_evidence): pass `evidence` with the current commit sha of the work (the HEAD of any worktree of this repository, or any local branch tip), `worktree` naming the worktree you ran in when it is not the org workspace, and one entry per acceptance criterion — the command you actually ran, its real exit code, and its output. A check passes when its exit code equals `expectExit` (default 0): when the criterion is met by a non-zero exit (a lookup that must find nothing → 1, a timeout that must fire → 124), set `expectExit` instead of appending `|| true`, which erases the exit code, and always say why in a one-line `expectReason` ("404 = branch not protected") — `expectExit` without it is refused. `expectExit` is only for a SINGLE-PURPOSE command: on a test suite or any other aggregate runner (vitest, jest, `pnpm test`, `pnpm -r`, a verify script) it is refused outright, because a suite exit code means "at least one of many things failed" and declaring it expected accepts every other failure too — run the one failing test file on its own and declare `expectExit` on that, or exclude the known failure and record the exclusion in `result`. A task whose job is to REPORT (QA, an audit) closes on commands that prove the report exists and is complete (e.g. `test -s <report file>`); the failures it found are findings — put them in `result` and send them to the coordinator, not in `checks`. If you tested something outside a git worktree (a scratch dir, an installed tarball), pin `headSha`/`worktree` to the worktree the artifact was built from. Evidence pinned to a commit that is no longer the head of that work is stale and will be refused, and a refused completion puts the task back in your queue with the reason — but only up to run_config.max_evidence_attempts refused proofs (default 3; a call with no `evidence` at all is refused without counting), after which the task is recorded as failed and escalated to the boss instead of returned to you. Any downstream tasks whose deps are now all done become ready and are dispatched.'
        : 'Mark a task as completed and optionally provide a result summary. Any downstream tasks whose deps are now all done will become ready and be dispatched.',
      schema: {
        taskId: z.string(),
        result: z.string().optional(),
        evidence: strictArgs({
          headSha: z.string(),
          worktree: z.string().optional(),
          checks: z
            .array(
              strictArgs({
                command: z.string(),
                exitCode: z.number().int(),
                expectExit: z.number().int().optional(),
                expectReason: z.string().optional(),
                output: z.string().optional(),
              }),
            )
            .default([]),
        }).optional(),
      },
      handler: async (args) =>
        text(
          completeTask(
            role.id,
            args.taskId as string,
            args.result as string | undefined,
            args.evidence as TaskEvidence | undefined,
          ),
        ),
    });
  }
  const requestReview = opts.requestReview;
  if (requestReview) {
    tools.push({
      name: 'org_review',
      description:
        "Ask an artifact-only reviewer for a verdict on a task. You pass ids only: the runtime builds the review from the task's text, its assignee's latest org_task_done evidence (commands, exit codes, output) and its own git diff of base...headSha — nothing you write is added, so there is no summary to give. The reviewer starts cold every time and replies to you with org_send. Refused if the task has no evidence yet.",
      schema: {
        taskId: z.string(),
        reviewer: z.string(),
        base: z.string().optional().describe("git ref to diff against (default 'main')"),
      },
      handler: async (args) =>
        text(
          requestReview(
            role.id,
            args.taskId as string,
            args.reviewer as string,
            args.base as string | undefined,
          ),
        ),
    });
  }
  const listTasks = opts.listTasks;
  if (listTasks) {
    tools.push({
      name: 'org_tasks',
      description:
        'List all tasks in the DAG with their current status and dependencies. Pass `taskId` to get just that task, including its result and latest evidence.',
      schema: { taskId: z.string().optional() },
      handler: async (args) => text(listTasks(args.taskId as string | undefined)),
    });
  }
  const splitTask = opts.splitTask;
  if (splitTask) {
    tools.push({
      name: 'org_task_split',
      description:
        'Split a task into parallel children when scope expands. The parent becomes "split"; children inherit its deps; downstream tasks are rewired to depend on all children.',
      schema: {
        parentId: z.string(),
        children: z.array(strictArgs({ title: z.string(), assignee: z.string() })).min(1),
      },
      handler: async (args) =>
        text(
          splitTask(
            role.id,
            args.parentId as string,
            (args.children as { title: string; assignee: string }[]) ?? [],
          ),
        ),
    });
  }
  const mergeTask = opts.mergeTask;
  if (mergeTask) {
    tools.push({
      name: 'org_task_merge',
      description:
        'Merge one task into another when parallel branches converge early. The source becomes "merged"; downstream deps are rewired to the target.',
      schema: { sourceId: z.string(), targetId: z.string() },
      handler: async (args) =>
        text(mergeTask(role.id, args.sourceId as string, args.targetId as string)),
    });
  }
  const cancelTask = opts.cancelTask;
  if (cancelTask) {
    tools.push({
      name: 'org_task_cancel',
      description:
        'Cancel a task as moot. The task becomes "cancelled" and unblocks downstream work. Its assignee is told to stop and not to commit or report further work for it; a role that runs one session per task has that session\'s process ended at once.',
      schema: { taskId: z.string(), reason: z.string().optional() },
      handler: async (args) =>
        text(cancelTask(role.id, args.taskId as string, args.reason as string | undefined)),
    });
  }
  const blockTask = opts.blockTask;
  if (blockTask) {
    tools.push({
      name: 'org_task_block',
      description: `Mark a task you are actively working (status "running") as blocked on a real-world time, not on other tasks — e.g. a scheduled soak test, a CI run that takes hours, a human-set deadline. Use this INSTEAD of leaving the task "running" with nothing actually happening, and instead of calling org_complete just because there is genuinely nothing to do right now: the idle watchdog will stop nudging you about this task until the time you give arrives, then automatically re-dispatch it to you. Give untilIso as an ISO 8601 date/time (e.g. "2026-08-19T09:00:00Z"). Nothing external wakes a blocked task — not a background command finishing, not a Monitor event, not npm propagation — so never block on a command you started: run waits in the foreground instead, with a command timeout long enough for them. Until the deadline you are woken periodically (every run_config.block_recheck_minutes, default 5; recheckAfterMinutes sets it for this block, 1-${MAX_BLOCK_RECHECK_MINUTES}) to re-check: close the task, re-block it, or report.`,
      schema: {
        taskId: z.string(),
        untilIso: z.string(),
        reason: z.string().optional(),
        recheckAfterMinutes: z.number().positive().max(MAX_BLOCK_RECHECK_MINUTES).optional(),
      },
      handler: async (args) =>
        text(
          blockTask(
            role.id,
            args.taskId as string,
            args.untilIso as string,
            args.reason as string | undefined,
            args.recheckAfterMinutes as number | undefined,
          ),
        ),
    });
  }
  const planGraph = opts.planGraph;
  if (planGraph) {
    tools.push({
      name: 'org_plan_graph',
      description:
        'Propose a full work graph in one call. Each task spec uses a local "name" and references other specs by name in "after", and may carry a "brief" with its instructions exactly as org_task does.' +
        (catalog ? ' Each spec may select a "loadout" exactly as org_task does.' : ''),
      schema: {
        tasks: z
          .array(
            strictArgs(
              {
                name: z.string(),
                title: z.string(),
                assignee: z.string(),
                after: z.array(z.string()).default([]),
                brief: briefArg,
                ...loadoutArg,
              },
              { deps: 'use `after` with node names' },
            ),
          )
          .min(1),
      },
      handler: async (args) =>
        text(
          planGraph(
            role.id,
            (args.tasks as {
              name: string;
              title: string;
              assignee: string;
              after?: string[];
              loadout?: string;
              brief?: string;
            }[]) ?? [],
          ),
        ),
    });
  }
  tools.push({
    name: 'org_send',
    description:
      'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.' +
      // D3: only orgs with a task-scoped role see this, so every other org's
      // tool list (prefix position 0) is unchanged.
      (opts.def?.roles.some((r) => resolveSessionScope(r, opts.def) === 'task')
        ? " When a message is about a task, start its subject with [task:<id>] so a task-scoped recipient reads it in that task's session."
        : ''),
    schema: { to: z.string(), subject: z.string(), message: z.string() },
    handler: async (args) => {
      if (opts.beforeTool) {
        const approved = await opts.beforeTool(role.id, 'org_send', args);
        if (approved === false) return text('Tool "org_send" was denied by guardrail approval');
        if (approved === null)
          return text(
            'Tool "org_send" is pending human approval - you will receive the result when it is approved or denied.',
          );
      }
      const receipt = await deliver(
        role.id,
        args.to as string,
        args.subject as string,
        args.message as string,
      );
      return text(receipt);
    },
  });
  tools.push({
    name: 'ask_human',
    description:
      'Ask a human a free-form question. Use only when you genuinely need human judgment. ' +
      'Set blocking: true ONLY if you cannot continue until it is answered — a blocking question pauses the ' +
      "org's idle watchdog (for up to an hour; after that the run resumes its normal idle checks either way). " +
      'If you can keep working while you wait — an FYI, a preference, anything you would describe as "not blocking on this" — ' +
      'pass blocking: false and carry on; the question is still recorded and answered, it just does not freeze the run. ' +
      'Defaults to blocking.',
    schema: { question: z.string(), blocking: z.boolean().optional() },
    handler: async (args) => {
      if (!opts.askHuman) return text('ask_human is not available in this session');
      const receipt = await opts.askHuman(
        role.id,
        args.question as string,
        args.blocking as boolean | undefined,
      );
      return text(receipt);
    },
  });
  // Built-in org tools reject undeclared keys instead of stripping them: a
  // stripped `deps` on an org_plan_graph node silently dropped every edge.
  for (const t of tools) t.strict ??= {};
  return tools;
}
