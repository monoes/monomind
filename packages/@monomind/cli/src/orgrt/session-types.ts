// packages/@monomind/cli/src/orgrt/session-types.ts
// Extracted from session.ts — the options a role session runs with.
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner, OrgToolDef } from './agent-runner.js';
import type { ApprovalVerdict } from './approval-decider.js';
import type { OrgBus } from './bus.js';
import type { TaskEvidence } from './completion-gate.js';
import type { DocumentToolHost } from './documents/host.js';
import type { RoleFence } from './fence.js';
import type { LoadoutSummary, ResolvedLoadout } from './loadouts.js';
import type { Mailbox } from './mailbox.js';
import type { TaskReferences } from './packet.js';
import type { PolicyEngine } from './policy.js';
import type { RoleDepsResult } from './role-deps.js';
import type { SessionLedger } from './session-ledger.js';
import type { TaskProcesses } from './task-cancel.js';
import type { RolePick, TaskPick } from './task-match.js';
import type { DecisionKind, OrgDef, OrgRole } from './types.js';

export type DeliverFn = (
  from: string,
  to: string,
  subject: string,
  body: string,
) => Promise<string>;

export interface SessionOpts {
  /** The session key (a task id under task scope, `_role` otherwise), recorded
   *  on each context-log record. Set by the session loop; unset = `_role`. */
  contextKey?: string;
  /** The session cap's hooks for this session (session-cap.ts), built by the
   *  session loop for an org with `context.session_cap`; unset = no cap. */
  sessionCap?: {
    /** A message was admitted to the session (every message, first included). */
    admit: (message: string) => void;
    /** De-duplicated main-session tokens of one model call. */
    addTokens: (n: number) => void;
    /** A turn ended with no usage reported. */
    usageMissing: () => void;
    /** The rotation digest owed to this fresh session's first message, built within `maxChars`. */
    rotation: (maxChars: number) => { digest: string; generation: number } | undefined;
    /** The digest went out with the first message. */
    rotationApplied: () => void;
  };
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
   *  not just the tool name; see approvals.ts's checkApproval for why.
   *  #553: may return an ApprovalVerdict naming who owns the request (a bare
   *  boolean/null is read as human-owned). */
  beforeTool?: (
    role: string,
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<boolean | null | ApprovalVerdict>;
  /** Called whenever gatedCanUseTool denies a tool call — wired to daemon.recordDecision()
   *  so those denials show up in `org decisions` traces. `kind` (#290) says which
   *  deny path fired, so the trace is machine-readable rather than prose-only. */
  onDecision?: (role: string, toolName: string, message: string, kind: DecisionKind) => void;
  /** ORG-9: reports whether this role currently has a pending decision gate —
   *  wired to daemon.listGates(org, 'pending'). When true, gatedCanUseTool
   *  denies every tool call until the gate is resolved. */
  hasPendingGate?: () => boolean;
  def?: OrgDef;
  /** The run's task text (`org run --task`), carried in every role's system prompt (session-prompt.ts). */
  runTask?: string;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
  /** Provider-agnostic runner. Takes precedence over queryFn. When unset,
   *  session.ts builds a ClaudeAgentRunner from queryFn (or the default),
   *  preserving the previous Claude-only behaviour exactly. */
  runner?: AgentRunner;
  /** #559: installs, host side, the pinned deps the role may need before
   *  its runner starts (role-deps.ts). Tests replace it. */
  ensureRoleDeps?: (runtime: string) => RoleDepsResult | Promise<RoleDepsResult>;
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
  /** #480: this session's private TMPDIR (role-tmpdir.ts), set by the
   *  session loop; exported as TMPDIR/TMP/TEMP. */
  roleTmpdir?: string;
  /** #480: whether task `taskId` is closed, so the session loop can remove
   *  that task session's TMPDIR. Absent = only removed when the role ends. */
  isTaskClosed?: (taskId: string) => boolean;
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
    references?: TaskReferences,
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
  /** Org sections (plan P3.6): this role's document tool host. Set only for a run whose org is on the
   *  sections surface; unset, no `org_doc_*` tool exists and the tool list is byte-identical to before. */
  documents?: DocumentToolHost;
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
