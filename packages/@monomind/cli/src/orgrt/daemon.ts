// packages/@monomind/cli/src/orgrt/daemon.ts
// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveOrgDefBlueprints } from '../catalog/blueprints.js';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import {
  configureResourceLimits,
  getResourceLimits,
  reapOrphanedSdkProcesses,
} from '../utils/resource-governor.js';
import type { AgentRunner } from './agent-runner.js';
import { AntigravityAgentRunner } from './antigravity-runner.js';
// ── Extracted module imports ────────────────────────────────────────────
import * as approvalOps from './approvals.js';
import { wakeDueBlockRechecks } from './block-recheck.js';
import { BrokerLease, normalizeCredential } from './broker.js';
import { onBudgetBusEvent, reopenBudgetClosedRoles } from './budget-closure.js';
import { OrgBus } from './bus.js';
import {
  captureCheckpoint,
  generateChecksum,
  isCheckpointExpired,
  migrateCheckpoint,
  type OrgCheckpoint,
  type RoleCheckpoint,
  restoredRoleStatus,
  restoreMailboxQueue,
  validateCheckpoint,
} from './checkpoint.js';
import * as checkpointOps from './checkpoint-ops.js';
import { CodexAgentRunner } from './codex-runner.js';
import { type CompletionFacts, checkCompletion, type TaskEvidence } from './completion-gate.js';
import { CopilotAgentRunner } from './copilot-runner.js';
import * as crossOrg from './cross-org.js';
import { CrushAgentRunner } from './crush-runner.js';
import * as decisionOps from './decisions.js';
import { openTaskCount } from './decisions.js';
import {
  agentRoles,
  type EndpointWait,
  hasActiveEndpointWait,
  isEndpointRole,
  retryQueuedEndpoints,
  startEndpointRetryLoop,
  stopEndpointRetries,
} from './endpoint-roles.js';
import {
  createFenceForRole,
  loadGlobalFenceConfig,
  mergeFenceConfigs,
  type RoleFence,
} from './fence.js';
import { fileToolRoots } from './file-roots.js';
import { attachForwarder } from './forwarder.js';
import { GrokAgentRunner } from './grok-runner.js';
import { HermesAgentRunner } from './hermes-runner.js';
import {
  advanceHold,
  clearIdleRecord,
  type HoldTrack,
  hookedOnWork,
  type IdleHoldState,
  noProgressRoles,
  projectIdleStop,
  type WaitHold,
  writeIdleRecord,
} from './idle-deadline.js';
import { drainInbox, newMessageId, queueMessage } from './inbox.js';
import { KimiCodeAgentRunner } from './kimicode-runner.js';
import { loadoutCatalog, resolveLoadout, sessionLoadoutFor, taskTag } from './loadouts.js';
import { isRecoverableCloseReason, Mailbox } from './mailbox.js';
import { OpencodeAgentRunner } from './opencode-runner.js';
import * as orgMemory from './org-memory.js';
import { PiRpcAgentRunner } from './pi-rpc-runner.js';
import { PiAgentRunner } from './pi-runner.js';
import { PolicyEngine } from './policy.js';
import { expandOrgPolicyPathVars, promptVarsFor } from './prompt-vars.js';
import { resolveRoleProvider } from './provider.js';
import * as questionOps from './questions.js';
import { QwenRpcAgentRunner } from './qwen-rpc-runner.js';
import { QwenAgentRunner } from './qwen-runner.js';
import {
  historyFile,
  type RunSummary,
  readHistory,
  readRunEvents,
  summarizeRun,
} from './reporting.js';
import {
  buildRespawnReceipt,
  computeReplacementBudget,
  mergeEffectiveRoleConfig,
  type RespawnReceipt,
  type RoleOverrides,
  type RoleSlot,
  redactRoleConfig,
  validateRespawnInput,
} from './role-slot.js';
import { currentRoleTrace, endTurn, type RoleTrace, withTrace } from './role-trace.js';
import { buildRuntimeOptions, type RuntimeOptionsReceipt } from './runtime-options.js';
import * as scheduler from './scheduler-integration.js';
import { runAgentSession } from './session.js';
import { SessionLedger } from './session-ledger.js';
import { effectiveToolProviders } from './skill-library.js';
import { TaskProcesses } from './task-cancel.js';
import { TaskDag } from './task-dag.js';
import { resolveAutoAssignee, type TaskPick } from './task-match.js';
import { type ChainTrace, roleProviderPrefixes, ToolProviderHub } from './tool-providers.js';
import {
  type BusEvent,
  type DecisionGate,
  type DecisionKind,
  ORG_DIR,
  type OrgDef,
  OrgDefSchema,
  type OrgRole,
  type ProviderConfig,
} from './types.js';
import { VercelAgentRunner } from './vercel-runner.js';

/** OpenTelemetry tracing helper - creates spans for major operations */
class _OtelTracer {
  private enabled = false;
  private spans = new Map<string, { start: number; metadata: Record<string, unknown> }>();

  enable(): void {
    this.enabled = true;
  }

  startSpan(name: string, metadata: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    this.spans.set(name, { start: Date.now(), metadata });
  }

  endSpan(name: string): void {
    if (!this.enabled) return;
    const span = this.spans.get(name);
    if (span) {
      const _duration = Date.now() - span.start;
      // Emit span as a bus event for export
      this.spans.delete(name);
    }
  }

  recordEvent(_name: string, _attributes: Record<string, unknown>): void {
    if (!this.enabled) return;
    // Could emit to bus for collection
  }
}

/** Drain window for a PLANNED stop (the boss called org_complete). Long enough
 *  for a sibling mid-build or mid-test to finish and flush its work. A hard
 *  stop keeps the short bound — see finishStop. */
const COMPLETE_DRAIN_MS = 5 * 60_000;

/** Resolve which AgentRunner hosts an org's role sessions.
 *  Precedence: role `runtime` field > org def `runtime` field >
 *  MONOMIND_RUNTIME env > auto-resolve from provider kind > undefined (the
 *  default path, where session.ts falls back to ClaudeAgentRunner). Returning
 *  undefined for the default path keeps Claude/Antigravity orgs byte-for-byte
 *  unchanged. Callers pass `role.runtime ?? def.runtime` as `orgRuntime`
 *  (see resolveRoleRunner). */
export type RuntimeKind =
  | 'claude'
  | 'kimicode'
  | 'opencode'
  | 'vercel'
  | 'codex'
  | 'antigravity'
  | 'grok'
  | 'qwen'
  | 'crush'
  | 'copilot'
  | 'pi'
  /** Opt-in alternate to 'pi': keeps the pi subprocess alive for the whole
   *  mailbox session (--mode rpc) instead of spawning fresh per turn — see
   *  pi-rpc-runner.ts's header for the protocol source (live-verified
   *  against pi v0.73.1, issue #179). Prefer plain 'pi' unless you
   *  specifically want session-lifetime context continuity. */
  | 'pi-rpc'
  /** Opt-in alternate to 'qwen': keeps the qwen subprocess alive for the
   *  whole mailbox session (--input-format/--output-format stream-json)
   *  instead of spawning fresh per turn — see qwen-rpc-runner.ts's header
   *  for the protocol source (live-verified against qwen-code v0.21.13,
   *  issue #182). One gap not independently re-verified: whether `result`
   *  fires exactly once per turn even when qwen runs several of its own
   *  native tools in sequence first (inferred by symmetry with the non-RPC
   *  QwenAgentRunner, not separately live-tested for this runner). Prefer
   *  plain 'qwen' unless you specifically want session-lifetime context
   *  continuity. */
  | 'qwen-rpc'
  /** Nous Research's Hermes Agent CLI (`hermes`), spawned fresh per
   *  tool-call round like 'codex' — but with NO session-resume flag in
   *  headless mode (see hermes-runner.ts's header): every round resends the
   *  full transcript, and args.resume across mailbox messages cannot be
   *  honored. Docs-only verified, streamsIncrementally: false — see
   *  runner-registry.ts. */
  | 'hermes';
export type ProviderKind =
  | 'subscription'
  | 'api-key'
  | 'base-url'
  | 'bedrock'
  | 'vertex'
  | 'gemini'
  | 'openai'
  | 'vercel-api-key'
  | 'codex'
  | 'antigravity';

/** Auto-resolve runtime from provider kind. Returns undefined for Claude default. */
function autoRuntimeFromProvider(kind?: ProviderKind): RuntimeKind | undefined {
  if (kind === 'vercel-api-key') return 'vercel';
  if (kind === 'codex') return 'codex';
  if (kind === 'antigravity') return 'antigravity';
  return undefined;
}

export function resolveRunner(
  orgRuntime?: RuntimeKind,
  providerKind?: ProviderKind,
  provider?: ProviderConfig,
): AgentRunner | undefined {
  const selected =
    orgRuntime ??
    autoRuntimeFromProvider(providerKind) ??
    (process.env.MONOMIND_RUNTIME as RuntimeKind | undefined);
  if (selected === 'opencode') return new OpencodeAgentRunner();
  if (selected === 'kimicode') return new KimiCodeAgentRunner();
  if (selected === 'vercel') return new VercelAgentRunner();
  if (selected === 'codex') return new CodexAgentRunner();
  if (selected === 'antigravity') return new AntigravityAgentRunner();
  if (selected === 'grok') return new GrokAgentRunner();
  if (selected === 'qwen') return new QwenAgentRunner();
  if (selected === 'crush') {
    // Issue #177: usage-proxy accounting is opt-in via provider.usageProxy +
    // provider.baseUrl (the upstream the crush CLI's own provider config
    // points at). Absent either, CrushAgentRunner falls back to its
    // documented 0-token behavior — this never blocks a turn either way.
    if (provider?.usageProxy && provider.baseUrl) {
      return new CrushAgentRunner({
        usageProxy: { upstreamBaseUrl: provider.baseUrl, baseUrlEnvVar: provider.usageProxyEnvVar },
      });
    }
    return new CrushAgentRunner();
  }
  if (selected === 'copilot') return new CopilotAgentRunner();
  if (selected === 'pi') return new PiAgentRunner();
  if (selected === 'pi-rpc') return new PiRpcAgentRunner();
  if (selected === 'qwen-rpc') return new QwenRpcAgentRunner();
  if (selected === 'hermes') return new HermesAgentRunner();
  return undefined;
}

/** Per-session variant: a role's own `runtime` field wins over the org-level
 *  one (and the env var) — including `role.runtime === 'claude'`, which forces
 *  the default Claude path even when the org/env select another runtime.
 *  Roles without a `runtime` inherit the org-level resolution unchanged.
 *  If no explicit runtime is set, auto-resolve from the provider kind. */
export function resolveRoleRunner(
  roleRuntime?: RuntimeKind,
  orgRuntime?: RuntimeKind,
  roleProviderKind?: ProviderKind,
  orgProviderKind?: ProviderKind,
  roleProvider?: ProviderConfig,
): AgentRunner | undefined {
  const explicit = roleRuntime ?? orgRuntime;
  if (explicit) return resolveRunner(explicit, undefined, roleProvider);
  return resolveRunner(undefined, roleProviderKind ?? orgProviderKind, roleProvider);
}

export { resolveAutoAssignee } from './task-match.js';

/** Per-role token budget: a role's own `budget_tokens` wins; otherwise the
 *  even split of run_config.budget_tokens across all roles. */
export function roleTokenBudget(role: OrgRole, def: OrgDef): number {
  return (
    role.budget_tokens ??
    Math.floor(
      (def.run_config.budget_tokens ?? 1_000_000) / Math.max(1, agentRoles(def.roles).length),
    )
  );
}

/** Idle watchdog's per-tick recovery check: given the previous nudge timestamp,
 *  the cumulative nudge count, and the timestamp of the most recent real tool
 *  call, returns the nudge count that should carry forward now that fresh
 *  activity means the org is no longer idle.
 *
 *  `nudgedAt !== 0` means we're recovering from an outstanding nudge. Resetting
 *  the counter here means it only ever tracks UNRESOLVED idle spells in a row,
 *  not a lifetime total — a long-running org that goes idle and recovers any
 *  number of times (e.g. periodic checkpoints on a slow background task) is
 *  never punished for having had several separate, healthy idle spells over
 *  its lifetime. Before this existed, `nudges` only ever incremented, so a run
 *  that answered every single nudge with real work still hit the "org idle
 *  again after 3 nudges" cap and got force-stopped on its 4th idle spell —
 *  observed live killing an in-progress 24h soak test under 90 minutes in.
 *
 *  But "recovering" must mean genuine forward progress, not just any bus
 *  event — a bare, content-free reply to the nudge (a boss that answers with
 *  "✓ Complete" and calls no tools at all) still updates lastActivity, so the
 *  org isn't flagged as silent, but it accomplishes nothing: nobody outside
 *  the boss's own turn ever sees it, since role coordination only happens via
 *  tool calls (org_send, org_task, ...). Requiring `lastToolActivity >=
 *  nudgedAt` — a real tool call happened AFTER this nudge was sent — closes
 *  that gap: observed live, a boss stuck responding to four consecutive
 *  10-minute nudges with one-line acknowledgments and zero tool calls looped
 *  indefinitely making no progress, because every trivial reply reset the cap
 *  that was supposed to catch exactly this. */
export function resolvedIdleNudgeCount(
  nudgedAt: number,
  nudges: number,
  lastToolActivity: number,
): number {
  return nudgedAt !== 0 && lastToolActivity >= nudgedAt ? 0 : nudges;
}

/** Bounded ring buffer for agent terminal scrollback. */
export class ScrollbackBuffer {
  private lines: string[] = [];
  constructor(private maxLines = 500) {}
  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }
  snapshot(): string[] {
    return [...this.lines];
  }
  clear(): void {
    this.lines.length = 0;
  }
}

export interface AgentRuntime {
  mailbox: Mailbox;
  policy: PolicyEngine;
  done: Promise<void>;
  /** 'running' until the session promise settles; 'crashed' if it rejected (see error). */
  status: 'running' | 'ended' | 'crashed';
  error?: string;
  /** Token/cost tracking for this role — persisted to runtime.json */
  metrics: { tokens: number; costUsd: number };
  /** Track last message ID for threading responses */
  lastMessageId?: string;
  /** SDK session ID — set by the session layer on first response (P2-13). Enables checkpoint resume. */
  sessionId?: string;
  /** Per-role worktree path (workspace: 'worktree-per-role'). */
  worktreePath?: string;
  /** Terminal scrollback — capped ring buffer of agent output lines. */
  scrollback: ScrollbackBuffer;
  /** ADR-O001 D7: the loadout this incarnation's session was built with,
   *  frozen at spawn and persisted in the checkpoint. Never changed while the
   *  incarnation lives — a task asking for another one is recorded as a
   *  `loadout-mismatch` instead (decisions.ts). Absent = no loadout. */
  loadout?: string;
  /** The task this incarnation's task-scoped process works on, so
   *  org_task_cancel can end it (task-cancel.ts). */
  taskProcesses?: TaskProcesses;
}

export interface RunningOrg {
  def: OrgDef;
  run: string;
  /** ADR-O001 D3: this run's model-session records (`<run>/sessions.json`),
   *  shared by every incarnation of every role so a replacement resumes too. */
  sessionLedger?: SessionLedger;
  /** Decision gates held in memory for the run (decisions.ts's gatesFor). */
  gates?: { gates: DecisionGate[] };
  bus: OrgBus;
  agents: Map<string, AgentRuntime>;
  busEvents: () => BusEvent[];
  /** Roles not yet spawned — spawned lazily on first message. */
  pendingRoles?: Map<string, OrgRole>;
  /** Spawn a pending role on demand — or, with a checkpoint, resume one
   *  (budget-closure.ts reopens a budget-closed role this way). */
  spawnRole?: (role: OrgRole, roleCheckpoint?: RoleCheckpoint) => void;
  /** Git worktree path if workspace: 'worktree' — cleaned up on stop. */
  worktreePath?: string;
  /** Task DAG for structured work ordering. */
  taskDag?: TaskDag;
  /** Directory role sessions run in — oversized mail digests are written here. */
  workdir?: string;
  /** MonoFence guardrail instances keyed by role ID. */
  fences?: Map<string, RoleFence>;
  /** This org's AGENT credential: unlocks delivery/status routes on the org
   *  server and is published in the broker registry as its sender identity.
   *  Per-org (not daemon-wide) so one org can't present itself as a sibling. */
  credential?: string;
  /** Authoritative role lifecycle state for mid-run replacement — see
   *  role-slot.ts. `agents` remains a compatibility view kept in sync (every
   *  write to a slot's `runtime` is mirrored into `agents`); NEW lifecycle
   *  logic (crash-retry generation guard, budget accounting, respawn) reads
   *  and writes roleSlots, not agents, directly. */
  roleSlots: Map<string, RoleSlot>;
  /** The role id startup's single boss-selection rule picked (daemon.ts's
   *  bossRole). Stored so respawnRole() (called long after startOrg returns)
   *  doesn't need to re-derive it. */
  bossRoleId: string;
  /** Canonical entity names from this org's KG, computed once at startup —
   *  reused by respawnRole() when it spawns a replacement incarnation. */
  glossary: string[];
  /** Role ids currently undergoing replacement — rejects a concurrent
   *  respawnRole() call for the same role id. */
  respawning: Set<string>;
  /** M1: per-role chain trace — set from the latest delivered message carrying
   *  a `[trace chn_… hop=N]` line, else a fresh chain minted on first use. */
  traces?: Map<string, ChainTrace>;
  /** #327: turns each role has finished this run (role-trace.ts), checkpointed. */
  turns?: Map<string, number>;
  /** M2: reply waits for endpoint deliveries — hold the idle watchdog. */
  endpointWaits?: EndpointWait[];
  /** #275: auto-dispatched tasks held for one coalescing window, keyed by
   *  assignee, so a message the coordinator sent in the same turn is delivered
   *  together with the task instead of a turn behind it. Owned by
   *  decisions.ts's queueDispatch; cross-org.ts's pushMessage folds a
   *  same-turn message into an open entry. */
  pendingDispatch?: Map<
    string,
    {
      lines: (string | Promise<string>)[];
      timer: ReturnType<typeof setTimeout>;
      /** Held line → the task it is about (dispatch-hold.ts). */
      tasks?: Map<string | Promise<string>, string>;
    }
  >;
  /** Task ids their assignee has already been nudged about at a turn end — the
   *  bound on decisions.ts's nudgeOpenTasksAtTurnEnd. Cleared for a task when
   *  it is dispatched again, so each dispatch is worth one nudge at most. */
  nudgedOpenTasks?: Set<string>;
  /** #343: roles whose session closed on their own budget_usd/budget_tokens
   *  this run, reopened by a reload that raises it (budget-closure.ts). */
  budgetClosed?: Set<string>;
  /** #343: roles the coordinator was warned about nearing budget_usd — once
   *  per role per run. */
  budgetWarned?: Set<string>;
  /** #304: why this run is stopping, set by stopOrg before the org is removed from
   *  `this.orgs`. Read by the role loop so a planned stop is logged with one stable
   *  wording instead of whichever abort string the SDK produced. */
  closedBy?: string;
}

/** Bug 4: number of roles for this org that are actually spawned and running
 *  right now — the live count run_config.max_concurrent_agents caps. A role
 *  that crashed or ended no longer counts, so a slot frees up automatically
 *  the moment that happens; nothing needs to explicitly decrement a counter. */
export function activeRoleCount(org: RunningOrg): number {
  let n = 0;
  for (const rt of org.agents.values()) if (rt.status === 'running') n++;
  return n;
}

/** #302: the `org_complete` consent gate's emit-and-return logic, extracted
 *  (matching `resolvedIdleNudgeCount`'s and `runOutcomeResult`'s precedent)
 *  so it is unit-testable without a live daemon, a running org, or the SDK's
 *  own tool-calling loop — none of which a test can drive directly, since
 *  `queryFn` replaces the whole SDK `query()`, tool orchestration included.
 *  `onComplete` gathers the facts (needs `this`/`running`) and calls this;
 *  this does the one decision (`checkCompletion`) and its two possible
 *  side effects. Returns the refusal string, or `null` to allow — exactly
 *  what the org_complete tool handler (session.ts) relays as the result. */
export function resolveOrgComplete(
  bus: OrgBus,
  role: string,
  outcome: 'achieved' | 'partial' | 'failed',
  summary: string,
  blocker: 'budget' | 'human' | 'external' | 'time' | undefined,
  blockerDetail: string | undefined,
  runFacts: Pick<
    CompletionFacts,
    'mode' | 'maxBudgetFraction' | 'pendingHumanWaits' | 'hasActiveBlock' | 'hasPendingWork'
  >,
): string | null {
  const refusal = checkCompletion({ outcome, blocker, blockerDetail, ...runFacts });
  if (refusal) {
    // Visible in `org logs` — a silent refusal reads to an operator as a
    // hung boss, not a boss that was told no.
    bus.emit({
      type: 'audit',
      from: role,
      reason: 'org-complete-refused',
      msg: refusal,
      data: { outcome, blocker, blockerDetail },
    });
    return refusal;
  }
  // #302 AC6: the blocker must show up in RENDERED output, not just `data`
  // — `org logs`'s formatter prints an event's `msg` verbatim and never
  // looks at `data`, so a blocker recorded only there would satisfy a unit
  // assertion and never reach a human reading the actual log.
  const blockerSuffix = blocker
    ? ` (blocker: ${blocker}${blockerDetail ? ` — ${blockerDetail}` : ''})`
    : '';
  bus.emit({
    type: 'status',
    from: role,
    reason: 'org-complete',
    msg: `run outcome: ${outcome}${blockerSuffix}`,
    data: { outcome, summary, blocker, blockerDetail },
  });
  return null;
}

export interface DaemonOpts {
  queryFn?: typeof query;
  /** Explicit agent runner (takes precedence over everything). When unset,
   *  session.ts builds a ClaudeAgentRunner from queryFn/the default — so the
   *  Claude path is unchanged unless MONOMIND_RUNTIME=opencode is set. */
  runner?: AgentRunner;
  forward?: boolean; // POST events to control server (default true)
  controlJson?: string;
  /** Enables cross-process inter-org routing: on a local delivery miss, ask the
   *  machine-local broker whether another `monomind org` process (e.g. a
   *  different project directory) hosts the target org, and deliver over HTTP
   *  if so. Off by default — tests and single-process runs don't need it. */
  crossProcess?: boolean;
  /** Base URL at which OTHER processes can reach this daemon's inbox (see
   *  server.ts POST /api/xdeliver). Set this to make orgs hosted here
   *  discoverable; omit for outbound-only cross-process delivery. */
  inboxUrl?: string;
  /** Override the broker's file registry directory (tests only). */
  brokerDir?: string;
  /** Override how long stopOrg() waits for agent sessions before proceeding anyway (tests only; default 15000ms). */
  stopWaitMs?: number;
  /** Override the per-role crash-retry backoff schedule (tests only; default [1000,5000,15000]ms).
   *  After this many retries a crash is terminal and triggers worker→boss notification /
   *  boss auto-restart. */
  crashBackoffsMs?: number[];
  /** Override the whole-org restart backoff after the boss terminally crashes (tests only;
   *  default [10000,30000]ms). */
  bossRestartBackoffMs?: number[];
  /** Override the silent-session abort timeout passed to every role session (tests only;
   *  default 4 minutes, see session.ts). */
  silentSessionMs?: number;
  /** The org server's OPERATOR credential — authorizes human-decision routes
   *  (approvals, gates, answers). Published to the operator directory for the
   *  `org` CLI, never to the broker registry (see broker.ts). */
  operatorCredential?: string;
  /** Override the operator credential directory (tests only). */
  operatorDir?: string;
  /** Filter tool audit events by tool name or decision (allow|deny) before forwarding */
  auditFilter?: { tool?: string; decision?: 'allow' | 'deny' };
  /** M2 (tests only): endpoint retry schedule (default [1000, 5000, 15000] ms). */
  endpointRetryMs?: number[];
  /** M2 (tests only): periodic endpoint re-attempt interval (default 60000 ms). */
  endpointPeriodicRetryMs?: number;
  /** M2 (tests only): endpoint POST timeout (default 15000 ms). */
  endpointPostTimeoutMs?: number;
}

export class OrgDaemon {
  /** @internal */ orgs = new Map<string, RunningOrg>();
  /** @internal */ waking = new Set<string>();
  /** @internal */ globalSubscribers = new Set<(e: BusEvent) => void>();
  /** @internal */ private leases = new Map<string, BrokerLease>();
  /** @internal */ private forwarders = new Map<string, ReturnType<typeof attachForwarder>>();
  /** @internal */ private watchdogs = new Map<string, ReturnType<typeof setInterval>>();
  /** @internal */ stopping = new Map<string, Promise<void>>();
  /** @internal Bug 2 (TOCTOU race): names currently reserved by an in-flight
   *  startOrg() call, from the synchronous existence check through
   *  registration in `orgs`. Closes the window where two concurrent
   *  startOrg(name) calls could both pass the `orgs.has(name)` check before
   *  either registered and spawn duplicate runs. */
  /** @internal */ startingOrgs = new Set<string>();
  /** @internal */ approvals = new Map<
    string,
    Array<{
      roleId: string;
      action: string;
      /** Fingerprint of the tool call's actual arguments (e.g. the Bash command,
       *  the WebFetch url) — see approvals.ts's checkApproval. Distinguishes a
       *  materially different call from one already approved/pending under the
       *  same (roleId, action), so one human approval can't silently authorize
       *  every future call to that tool. Optional only so pre-fix entries
       *  loaded from an old approvals.json don't fail to parse. */
      fingerprint?: string;
      question: string;
      ts: number;
      approved: boolean | null;
      /** M5: `apr-<ms>-<8 hex>` — addresses exactly this request. */
      requestId?: string;
      /** M5: the redacted argument summary `policy.decide` logged. */
      input?: Record<string, unknown>;
      /** M5: who resolved it (`human` by default). */
      resolvedBy?: string;
      resolvedAt?: number;
    }>
  >();
  /** @internal */ approvalLocks = new Map<string, Promise<unknown>>();
  /** @internal */ gatesLocks = new Map<string, Promise<unknown>>();
  /** @internal */ questionsLocks = new Map<string, Promise<unknown>>();
  /** @internal */ spawning = new Map<string, Set<string>>();
  static readonly MAX_BOSS_RESTARTS = 2;
  static readonly BOSS_RESTART_BACKOFF_MS = [10_000, 30_000];
  /** @internal */ bossRestartCounts = new Map<string, number>();
  /** @internal */ restarting = new Set<string>();
  // #3: recognizes provider context-window-overflow errors so the boss can be told
  // to chunk the work instead of re-dispatching the same oversized task verbatim.
  private static readonly CONTEXT_LIMIT_RE =
    /context[- ]?(window|length|size|limit)|maximum context|exceeds?.{0,12}(context|token)|too many tokens|prompt is too long/i;

  /** @internal */ recallUsage = new Map<string, Set<string>>();
  /** @internal */ orgLearnedRuns = new Set<string>();
  /** @internal */ abandoned = new Map<string, Set<string>>();
  /** #293: per-org reason the last run's cross-run memory was NOT stored.
   *  persistState() writes it into runtime.json so `org status` can still
   *  explain an empty org_recall long after the run. */
  /** @internal */ memoryErrors = new Map<string, string>();
  /** M1: role tool-provider tool-list cache and live provider processes. */
  /** @internal */ toolProviders = new ToolProviderHub();

  constructor(
    /** @internal */ public root: string,
    /** @internal */ public opts: DaemonOpts = {},
  ) {}

  /** Publish this daemon's inbox so orgs started AFTER this call register with the broker. */
  setInboxUrl(url: string, operatorCredential?: string): void {
    this.opts.inboxUrl = url;
    if (operatorCredential !== undefined) this.opts.operatorCredential = operatorCredential;
  }

  /** subscribe to events from ALL running orgs (dashboard server uses this) */
  subscribe(fn: (e: BusEvent) => void): () => void {
    this.globalSubscribers.add(fn);
    return () => this.globalSubscribers.delete(fn);
  }

  listOrgs(): RunningOrg[] {
    return [...this.orgs.values()];
  }
  getOrg(name: string): RunningOrg | undefined {
    return this.orgs.get(name);
  }

  /** Hot-reload an org definition from disk without stopping running sessions.
   *  Applies: goal, run_config, schedule. New roles are added as pending (lazy-spawnable).
   *  Removed roles are NOT killed — they finish their current work and won't be re-spawned.
   *  Returns a summary of what changed. */
  reloadOrgDef(name: string): { changed: string[]; newRoles: string[]; removedRoles: string[] } {
    const running = this.orgs.get(name);
    if (!running) throw new Error(`org ${name} is not running`);
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    const parsedDef = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
    const bp = resolveOrgDefBlueprints(parsedDef, this.root);
    if (bp.errors.length) throw new Error(`org ${name}: ${bp.errors.join('; ')}`);
    const newDef = expandOrgPolicyPathVars(bp.def, promptVarsFor(this.root));
    const changed: string[] = [];
    const newRoles: string[] = [];
    const removedRoles: string[] = [];

    if (newDef.goal !== running.def.goal) {
      running.def.goal = newDef.goal;
      changed.push('goal');
    }

    const oldRc = running.def.run_config as Record<string, unknown>;
    const newRc = newDef.run_config as Record<string, unknown>;
    for (const key of new Set([...Object.keys(oldRc), ...Object.keys(newRc)])) {
      if (JSON.stringify(oldRc[key]) !== JSON.stringify(newRc[key])) {
        oldRc[key] = newRc[key];
        changed.push(`run_config.${key}`);
      }
    }

    // M1 (C-37): apply changes to EXISTING roles' tool_providers, endpoint,
    // kind and policy. Fields are replaced on the live role object (sessions
    // read tool_providers at their next start, checkApproval reads policy
    // live) and a running role's PolicyEngine gets the new policy now.
    // #343: budget_usd / budget_tokens too — the live PolicyEngine gets the
    // new caps with its spend kept, and a role closed for budget reopens
    // below once it is no longer over them.
    const RELOADABLE_ROLE_FIELDS = [
      'tool_providers',
      'endpoint',
      'kind',
      'policy',
      'budget_usd',
      'budget_tokens',
    ] as const;
    for (const next of newDef.roles) {
      const live = running.def.roles.find((r) => r.id === next.id);
      if (!live) continue;
      const liveRec = live as Record<string, unknown>;
      const nextRec = next as Record<string, unknown>;
      for (const field of RELOADABLE_ROLE_FIELDS) {
        if (JSON.stringify(liveRec[field]) === JSON.stringify(nextRec[field])) continue;
        const targets = new Set<Record<string, unknown>>([liveRec]);
        const slotRole = running.roleSlots.get(next.id)?.effectiveRole as
          | Record<string, unknown>
          | undefined;
        if (slotRole) targets.add(slotRole);
        const pending = running.pendingRoles?.get(next.id) as Record<string, unknown> | undefined;
        if (pending) targets.add(pending);
        for (const t of targets) {
          if (nextRec[field] === undefined) delete t[field];
          else t[field] = nextRec[field];
        }
        if (field === 'policy') running.agents.get(next.id)?.policy.updatePolicy(next.policy ?? {});
        if (field === 'budget_usd' || field === 'budget_tokens')
          running.agents.get(next.id)?.policy.setBudgetCaps({
            maxTokens: live.policy?.maxTokens ?? computeReplacementBudget(running.def, next.id),
            maxUsd: live.policy?.maxUsd ?? live.budget_usd,
          });
        changed.push(`role:${next.id}:${field}`);
      }
    }
    const reopened = reopenBudgetClosedRoles(this, name, running);

    const existingRoleIds = new Set(running.def.roles.map((r) => r.id));
    const newRoleIds = new Set(newDef.roles.map((r) => r.id));
    for (const role of newDef.roles) {
      if (!existingRoleIds.has(role.id)) {
        running.def.roles.push(role);
        // M2: an endpoint role never gets a session — nothing to lazy-spawn.
        if (!isEndpointRole(role)) {
          if (!running.pendingRoles) running.pendingRoles = new Map();
          running.pendingRoles.set(role.id, role);
        }
        newRoles.push(role.id);
      }
    }
    for (const id of existingRoleIds) {
      if (!newRoleIds.has(id)) removedRoles.push(id);
    }

    running.bus.emit({
      type: 'audit',
      reason: 'hot-reload',
      msg: `org def reloaded: ${changed.length} fields changed, ${newRoles.length} new roles, ${removedRoles.length} removed roles${reopened.length ? `, reopened ${reopened.join(', ')}` : ''}`,
      data: { changed, newRoles, removedRoles },
    });

    return { changed, newRoles, removedRoles };
  }
  /** Names of the orgs this daemon currently has running. Snapshot — safe to
   *  iterate while stopOrg() mutates the underlying map. */
  listRunning(): string[] {
    return [...this.orgs.keys()];
  }

  /** M1: the chain trace a role's tool calls carry — from the most recent
   *  message delivered to it with a `[trace chn_… hop=N]` line, otherwise a
   *  fresh chain (hop 0) minted once and kept for the role — plus the role's
   *  turn (#327, role-trace.ts). */
  roleTrace(org: string, role: string): RoleTrace {
    return currentRoleTrace(this.orgs.get(org), role);
  }

  /** Hook for the SSE server — registers a listener for all bus events across all orgs. */
  onBusEvent?: (fn: (e: BusEvent) => void) => void = (fn) => {
    this.subscribe(fn);
  };

  /** Snapshot of all running orgs for dashboard initial load. */
  getStatusSnapshot?: () => Record<string, unknown> = () => {
    const orgs: Record<string, unknown>[] = [];
    for (const [name, running] of this.orgs) {
      const roles: Record<string, unknown>[] = [];
      for (const [roleId, agent] of running.agents) {
        roles.push({
          id: roleId,
          status: agent.status,
          worktree: agent.worktreePath ?? null,
          metrics: agent.metrics,
        });
      }
      orgs.push({
        name,
        run: running.run,
        roles,
        pendingRoles: running.pendingRoles ? [...running.pendingRoles.keys()] : [],
        tasks: running.taskDag?.all() ?? [],
      });
    }
    return { orgs };
  };

  /** Resolve run_config.workspace to 'repo' | 'isolated' | an absolute path.
   *  A relative path is resolved against the project root rather than the
   *  daemon's cwd, which is not the same directory when `org serve` is started
   *  from a subdirectory. */
  private workspaceSetting(def: OrgDef): string {
    const ws = (def.run_config as { workspace?: string }).workspace ?? 'repo';
    if (ws === 'repo' || ws === 'isolated' || ws === 'worktree' || ws === 'worktree-per-role')
      return ws;
    return isAbsolute(ws) ? ws : join(this.root, ws);
  }

  async startOrg(
    name: string,
    taskOverride?: string,
    options?: { resume?: boolean },
  ): Promise<RunningOrg> {
    // A restart-driven start (scheduleBossRestart) keeps its crash counter so the
    // cap holds; any other (explicit) start resets it so a manual re-run gets a
    // fresh budget.
    if (!this.restarting.has(name)) this.bossRestartCounts.delete(name);
    // Join any in-flight stop for this org before checking `this.orgs` — otherwise a
    // start racing a stop's drain window (up to stopWaitMs) can share the stopping
    // run's worktree path while it's still being force-removed.
    const inflightStop = this.stopping.get(name);
    if (inflightStop) await inflightStop;
    // Bug 2 (TOCTOU race): this existence check is synchronous, but the real
    // registration into `this.orgs` doesn't happen until deep inside
    // startOrgInner, after several genuine `await` points (the provider
    // validation dynamic import, `git worktree add` for workspace:
    // 'worktree'). Two concurrent startOrg(name) calls — e.g. the
    // scheduler's tick, the runfile poll loop, and autoWake firing close
    // together — could each pass this check before either registered,
    // spawning two duplicate runs with separate budget/policy counters that
    // both write the same shared per-org files. Reserve the name in
    // `startingOrgs` synchronously, in the same tick as the check, so a
    // second concurrent call sees the reservation and is rejected instead of
    // racing ahead to spawn a duplicate.
    if (this.orgs.has(name)) throw new Error(`org ${name} already running`);
    if (this.startingOrgs.has(name)) throw new Error(`org ${name} already starting`);
    this.startingOrgs.add(name);
    try {
      return await this.startOrgInner(name, taskOverride, options);
    } catch (err) {
      // startOrgInner registers the org in `this.orgs` (and spawns the boss,
      // installs the exit listener, starts the broker lease) well before it
      // returns; persistState (ENOSPC/EACCES) and BrokerLease.start() can
      // still throw after that. Left alone, that was a live, unreachable org:
      // sessions running, `this.orgs` still holding it, every later startOrg
      // rejected with "already running", and nothing ever calling stopOrg.
      // Only this call can have registered the name (the reservation above
      // holds until `finally`), so anything in the map is ours to tear down.
      if (this.orgs.has(name)) {
        // #302: tag the real cause so a run's history/report can never read
        // this as a boss-attributed outcome — nothing here asked the boss.
        await this.stopOrg(name, { closedBy: 'failed-start' }).catch((stopErr) =>
          console.error(
            `org ${name}: teardown after failed start failed:`,
            stopErr instanceof Error ? stopErr.message : stopErr,
          ),
        );
      }
      throw err;
    } finally {
      this.startingOrgs.delete(name);
    }
  }

  /** The actual startOrg implementation. Split out of startOrg() so the
   *  reservation guard above runs synchronously, before any `await` in here —
   *  see the bug 2 comment in startOrg(). */
  private async startOrgInner(
    name: string,
    taskOverride?: string,
    options?: { resume?: boolean },
  ): Promise<RunningOrg> {
    // #301: the PRIMARY fix — the stop-side backstops below (finishStop,
    // process 'exit') can only run for a run that ends through code we
    // control; a SIGKILL leaves .git/worktrees/<name> metadata behind with
    // nothing left to clean it up, and so did every run that leaked before
    // this fix existed. Pruning here turns "did the last run clean up,
    // however it died?" into "a run always begins clean" — the only thing
    // that recovers both the SIGKILL case and worktrees already orphaned
    // before this daemon process started. Unconditional and best-effort for
    // the same reasons as the stop-side prune (see finishStop): it only
    // drops metadata whose worktree directory is already gone, so it cannot
    // touch a live worktree, including the owner's.
    try {
      execFileSync('git', ['worktree', 'prune'], {
        cwd: this.root,
        stdio: 'ignore',
        timeout: 30_000,
      });
    } catch {
      /* best-effort: not a git repo, git missing, or a wedged hook */
    }
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    const parsedDef = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
    const bp = resolveOrgDefBlueprints(parsedDef, this.root);
    // {{home}} / {{org_root}} in policy paths, before any root or sandbox sees them.
    const def = expandOrgPolicyPathVars(bp.def, promptVarsFor(this.root));

    let run: string;
    let checkpoint: OrgCheckpoint | undefined;
    if (options?.resume) {
      const rtPath = join(this.root, ORG_DIR, name, 'runtime.json');
      if (!existsSync(rtPath))
        throw new Error(`cannot resume org "${name}": runtime.json not found`);
      const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
      if (!rt?.run || !rt?.checkpoint)
        throw new Error(`cannot resume org "${name}": no valid checkpoint found`);
      if (isCheckpointExpired(rt.checkpoint))
        throw new Error(`cannot resume org "${name}": checkpoint expired`);
      // Migrate an older-schema checkpoint (verifying ITS OWN stored checksum
      // first) before validating it against CHECKPOINT_VERSION — see
      // migrateCheckpoint's doc comment in checkpoint.ts.
      const migrated = migrateCheckpoint(rt.checkpoint);
      if (!migrated || !validateCheckpoint(migrated))
        throw new Error(`cannot resume org "${name}": checkpoint validation failed`);
      rt.checkpoint = migrated;
      run = rt.run;
      checkpoint = rt.checkpoint;
      if (rt.abandonedRoles) {
        this.abandoned.set(name, new Set(rt.abandonedRoles));
      }
    } else {
      this.abandoned.delete(name); // a previous run's missing roles say nothing about this one
      this.memoryErrors.delete(name); // nor does its memory-store failure (#293)
      approvalOps.clearApprovalsForFreshStart(this, name); // a previous run's approvals are moot for this one
      questionOps.clearQuestionsForFreshStart(this, name); // nor do its unanswered questions (#248)
      // random suffix: second-precision stamps collide across processes (two CLI
      // invocations in the same second would share a run dir and its bus.jsonl)
      run = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const dir = join(this.root, ORG_DIR, name, run);
    mkdirSync(dir, { recursive: true });
    // Role sessions run at the project root by default. They used to run in an
    // empty scratch dir under .monomind/orgs/<name>/workspace, which the policy
    // engine's workdir check ("path escapes org workdir") then confined every
    // path to — so a development org could not Read or Edit a single file of
    // the project it was created to work on. Roles fell back to Bash, which is
    // not path-scoped, meaning the sandbox blocked the safe tools and let the
    // unrestricted one through. Opt back in with run_config.workspace:
    // 'isolated', or pin an absolute path.
    const ws = this.workspaceSetting(def);
    let cwd: string;
    let worktreePath: string | undefined;
    if (ws === 'worktree') {
      worktreePath = join(this.root, ORG_DIR, name, 'worktree');
      const { execFileSync } = await import('node:child_process');
      try {
        // Remove stale worktree from a previous run
        if (existsSync(worktreePath)) {
          // R4: bound the call — a wedged git hook (git-lfs, gc lock, gpg sign
          // prompt) would otherwise hang the whole daemon indefinitely.
          // SEC-5: execFileSync + argv — no shell interpolation of worktreePath.
          execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
            cwd: this.root,
            stdio: 'ignore',
            timeout: 30_000,
          });
        }
      } catch {
        /* best-effort cleanup */
      }
      execFileSync('git', ['worktree', 'add', worktreePath, 'HEAD', '--detach'], {
        cwd: this.root,
        stdio: 'ignore',
        timeout: 30_000,
      });
      cwd = worktreePath;
    } else {
      cwd =
        ws === 'repo'
          ? this.root
          : ws === 'isolated'
            ? join(this.root, ORG_DIR, name, 'workspace')
            : ws;
    }
    mkdirSync(cwd, { recursive: true });

    // An org must be able to seat its whole roster. maxSdkProcesses is sized for
    // the machine (cpus - 2), so any org with more roles than that had its tail
    // roles deferred forever — a 7-role org on an 8-core box permanently lost
    // its 7th, and the work that role owned simply never happened. Raise the
    // ceiling to the role count. An explicit MONOMIND_MAX_SDK_PROCS still wins:
    // if the operator named a number, that number is the answer.
    //
    // Runner process model (relevant for sizing): ClaudeAgentRunner and
    // VercelAgentRunner are in-process (no subprocess per role). KimiCodeAgentRunner,
    // OpencodeAgentRunner, and CodexAgentRunner each spawn one subprocess per role.
    // The current sizing (def.roles.length) is therefore safe — it over-provisions
    // for in-process runners but never under-provisions for subprocess runners.
    const sessionRoleCount = agentRoles(def.roles).length;
    if (
      !process.env.MONOMIND_MAX_SDK_PROCS &&
      getResourceLimits().maxSdkProcesses < sessionRoleCount
    ) {
      configureResourceLimits({ maxSdkProcesses: sessionRoleCount });
    }

    // ADR-O001 D8: a cost tier that can't resolve a model for a role's
    // provider must stop the run here. The alternative — resolving it at
    // session start — would either crash one role ten minutes in or, worse,
    // quietly leave that role on a different model than the tier claimed.
    const { validateCostTiers } = await import('./cost-tier.js');
    const tierErrors = validateCostTiers(def);
    if (tierErrors.length) {
      throw new Error(`org ${name}: ${tierErrors.join('; ')}`);
    }
    // ADR-O001 D7: an oversized or unresolvable loadout catalog stops the run
    // here, for the same reason — not ten minutes in, at some role's spawn.
    const { validateLoadouts } = await import('./loadouts.js');
    const loadoutErrors = validateLoadouts(def, this.root).errors;
    if (loadoutErrors.length) {
      throw new Error(`org ${name}: ${loadoutErrors.join('; ')}`);
    }
    const { validateRoleSkills } = await import('./skill-library.js');
    const skillErrors = [
      ...bp.errors,
      ...def.roles.flatMap((r) => validateRoleSkills(r, this.root)),
    ];
    if (skillErrors.length) {
      throw new Error(`org ${name}: ${skillErrors.join('; ')}`);
    }

    // Validate per-role providers before spawning anything (fail-fast: a
    // missing env var discovered 10 minutes into a run wastes the entire run).
    const { resolveProviderEnv: validateProvider, resolveRoleProvider } = await import(
      './provider.js'
    );
    for (const role of def.roles) {
      try {
        if (role.provider) {
          validateProvider(role.provider);
        } else if (role.adapter_config?.provider) {
          // Named provider (`monomind providers configure`): resolve now so a
          // missing/misconfigured entry fails the run at start, not mid-flight.
          resolveRoleProvider(role, this.root);
        }
      } catch (err) {
        throw new Error(
          `org ${name}: role "${role.id}" provider validation failed — ${err instanceof Error ? err.message : err}`,
        );
      }
      // provider.kind 'gemini'/'openai' only sets env vars (GEMINI_API_KEY /
      // OPENAI_API_KEY — see provider.ts) for a CLI that never reads them:
      // autoRuntimeFromProvider has no case for either kind, so
      // resolveRoleRunner falls through to `undefined` and session.ts spawns
      // the default ClaudeAgentRunner. The role silently runs on Claude while
      // its config claims gemini/openai — surface that loudly at start time
      // instead of leaving it to be discovered mid-run.
      const kind = role.provider?.kind;
      if (
        (kind === 'gemini' || kind === 'openai') &&
        !resolveRoleRunner(role.runtime, def.runtime, kind, undefined, role.provider)
      ) {
        console.error(
          `org ${name}: role "${role.id}" sets provider.kind="${kind}" but no runtime honors it — ` +
            `this role will actually run on the Claude Agent SDK, not ${kind}. ` +
            `Set role.runtime (or the org's runtime) explicitly, or use provider.kind="vercel-api-key" ` +
            `with vendor="${kind === 'gemini' ? 'google' : 'openai'}" to route through a real ${kind} model.`,
        );
      }
    }

    const bus = new OrgBus(name, run, dir);
    // Lightweight in-memory tail for busEvents() (test-loop, /api/history).
    // Full events (including Write content snapshots) live on disk in bus.jsonl;
    // the in-memory copy strips bulky data.content to keep RAM flat.
    const MAX_COLLECTED = 1000;
    const collected: BusEvent[] = [];
    let lastActivity = Date.now();
    // Separate from lastActivity: only real tool calls (org_send, org_task,
    // Bash, ...) count here, not status pings or chat-only turns. The idle
    // watchdog's nudge-recovery check (resolvedIdleNudgeCount) uses this to
    // tell genuine forward progress apart from a boss that "answers" a nudge
    // with a bare acknowledgment ("✓ Complete") and does nothing — a
    // content-free reply still updates lastActivity (so the org isn't
    // flagged as silent), but must not reset the cumulative nudge cap, or a
    // boss that's genuinely out of ideas can loop forever making zero
    // progress without ever tripping the watchdog.
    let lastToolActivity = 0;
    // ADR-O001 D4 (no-progress detector): the idle clock above is org-wide and
    // says nothing at all while a hold is in force — the 8.3-hour stall looked
    // perfectly healthy from it. Per-role last-activity is what tells a role
    // that is nominally working but producing nothing from one that is simply
    // waiting its turn.
    const roleActivity = new Map<string, number>();
    const noProgressAlarmed = new Set<string>();
    // Org-wide budget ceiling (bug 1): tracks whether run_config.budget_tokens
    // has already been enforced this run, so the close-all-mailboxes sweep
    // below only fires once instead of on every subsequent usage event.
    let orgBudgetClosed = false;
    bus.subscribe((e) => {
      const slim: BusEvent =
        e.data?.content != null ? { ...e, data: { ...e.data, content: undefined } } : e;
      collected.push(slim);
      if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
      // The watchdog's own events must not count as org activity, or a hung
      // boss would never trip the "nudge produced no activity" stop and a
      // silent role would clear its own no-progress alarm.
      const selfEmitted =
        e.reason === 'idle-nudge' || e.reason === 'no-progress' || e.reason === 'hold-expired';
      if (!selfEmitted) lastActivity = Date.now();
      if (e.type === 'tool') lastToolActivity = Date.now();
      if (e.from && !selfEmitted) {
        roleActivity.set(e.from, Date.now());
        noProgressAlarmed.delete(e.from);
      }
      // org_complete IS the end of the run — self-stop instead of sitting
      // "running" forever after a recorded outcome. Deferred (unref'd) so the
      // tool call's receipt reaches the boss and its final turn text still
      // lands on the bus before mailboxes close; stopOrg is reentrant-safe
      // against a concurrent manual stop.
      if (e.type === 'status' && e.reason === 'org-complete') {
        const t = setTimeout(() => {
          // #206: closedBy: 'org-complete' is the ONLY signal `org run`
          // trusts to mean "the run ended cleanly, exit 0" — every other
          // stop path (idle watchdog, boss-restart-exhausted, manual stop)
          // leaves it unset.
          this.stopOrg(name, { drainMs: COMPLETE_DRAIN_MS, closedBy: 'org-complete' }).catch(
            (err) =>
              console.error(
                `org ${name}: auto-stop after org_complete failed:`,
                err instanceof Error ? err.message : err,
              ),
          );
        }, 1000);
        (t as { unref?: () => void }).unref?.();
      }
      // Accumulate cost from usage events into per-role metrics
      if (e.type === 'usage' && e.from && e.data) {
        const runtime = running.agents.get(e.from);
        if (runtime) {
          const cost = Number((e.data as { cost_usd?: number }).cost_usd ?? 0);
          if (Number.isFinite(cost)) {
            runtime.metrics.costUsd += cost;
          }
        }
      }
      // Bug 1: run_config.budget_tokens is an org-wide ceiling, not just a
      // per-role one — a role's explicit budget_tokens override lets IT spend
      // more without raising what every other role can spend, so nothing
      // upstream of this ever summed real usage across the whole roster and
      // stopped the org when the declared total was reached. Mirror the
      // per-role budget-exhausted handling (session.ts's mailbox.close('token-budget'))
      // at the org level: once the sum of every role's PolicyEngine.usage
      // reaches the ceiling, close every mailbox and stop lazy-spawning new
      // ones so the org can't keep spending past its declared cap.
      if (e.type === 'usage' && !orgBudgetClosed) {
        const orgBudget = def.run_config.budget_tokens;
        if (orgBudget != null) {
          let orgUsage = 0;
          // ADR-O001 D1: budgetedUsage, not usage — the org-wide ceiling is
          // the same declared number as the per-role one and must be compared
          // on the same basis.
          for (const rt of running.agents.values()) orgUsage += rt.policy.budgetedUsage;
          // Mid-run role replacement retires a policy engine's usage into the
          // slot instead of discarding it (see role-slot.ts / respawnRole) -
          // include it here or a replacement could silently reset spend and
          // let the org exceed its declared ceiling.
          for (const slot of running.roleSlots.values()) orgUsage += slot.retiredUsage.tokens;
          if (orgUsage >= orgBudget) {
            orgBudgetClosed = true;
            running.pendingRoles?.clear(); // prevent lazy spawns after the org budget is exhausted
            for (const rt of running.agents.values()) {
              if (!rt.mailbox.isClosed) rt.mailbox.close('token-budget');
            }
            bus.emit({
              type: 'status',
              reason: 'org-budget-exhausted',
              msg: `org-wide token budget exhausted (${orgUsage}/${orgBudget}) — closing all roles`,
            });
          }
        }
      }
      // #343: hold a budget-closed role's tasks, warn near budget_usd.
      onBudgetBusEvent(running, e);
      // Track last message ID for threading responses
      if ((e.type === 'message' || e.type === 'xorg') && e.from) {
        const runtime = running.agents.get(e.from);
        if (runtime) {
          runtime.lastMessageId = e.id;
        }
      }
      // Apply audit filter if configured (skip filtered tool events before forwarding)
      if (this.opts.auditFilter && e.type === 'tool') {
        const { tool, decision } = this.opts.auditFilter;
        if (tool && e.tool !== tool) return; // Skip: tool name doesn't match
        if (decision && e.decision !== decision) return; // Skip: decision doesn't match
      }
      for (const fn of this.globalSubscribers) fn(e);
    });
    if (this.opts.forward !== false)
      this.forwarders.set(
        name,
        attachForwarder(bus, this.opts.controlJson ?? join(this.root, '.monomind/control.json')),
      );

    const running: RunningOrg = {
      def,
      run,
      sessionLedger: new SessionLedger(join(dir, 'sessions.json')),
      gates: decisionOps.readGates(this.root, name),
      bus,
      agents: new Map(),
      roleSlots: new Map(),
      bossRoleId: '', // set below, once bossRole is computed
      glossary: [],
      respawning: new Set(),
      busEvents: () => [...collected],
      workdir: cwd,
      credential: randomUUID(),
    };
    this.orgs.set(name, running);

    // ── MonoFence guardrail: pre-create per-role instances ────────────────
    const globalFence = loadGlobalFenceConfig(this.root);
    const orgFence = (def as Record<string, unknown>).fence as Record<string, unknown> | undefined;
    const roleFences = new Map<string, RoleFence>();
    for (const role of def.roles) {
      const roleFenceCfg = (role.policy as Record<string, unknown> | undefined)?.fence as
        | Record<string, unknown>
        | undefined;
      const merged = mergeFenceConfigs(
        globalFence ?? undefined,
        orgFence as any,
        roleFenceCfg as any,
      );
      if (merged.enabled === false) continue;
      if (!globalFence && !orgFence && !roleFenceCfg) continue;
      try {
        const instance = await createFenceForRole(merged);
        if (instance) {
          roleFences.set(role.id, {
            instance,
            abortThreshold: typeof merged.abortThreshold === 'number' ? merged.abortThreshold : 0.8,
            scanMessages: merged.scanMessages !== false,
          });
        }
      } catch {
        /* monofence-ai not installed — skip silently */
      }
    }
    if (roleFences.size > 0) running.fences = roleFences;

    // Even-split budget; a role's own budget_tokens overrides it (roleTokenBudget).
    // Bug 1: roles WITH an explicit override spend on top of the even split
    // rather than out of it, so the roster's ceilings could sum to well over
    // the declared org-wide budget (e.g. 4 roles @ 250k + one role overridden
    // to 2M = 2.75M achievable against a declared 1M cap). Subtract the sum of
    // every role's explicit override from the org-wide budget first, then
    // split only the remainder among the roles WITHOUT an override, so the
    // static split is honest about what's left. (Live usage is still tracked
    // and enforced as a real ceiling above, independent of this static split.)
    const orgBudgetTokens = def.run_config.budget_tokens ?? 1_000_000;
    const overriddenTokenSum = def.roles.reduce((sum, r) => sum + (r.budget_tokens ?? 0), 0);
    const unoverriddenRoleCount = agentRoles(def.roles).filter(
      (r) => r.budget_tokens == null,
    ).length;
    const _perRoleBudget =
      unoverriddenRoleCount > 0
        ? Math.max(0, Math.floor((orgBudgetTokens - overriddenTokenSum) / unoverriddenRoleCount))
        : 0;
    // Single boss-selection rule for kickoff AND org_complete gating — the
    // session layer previously keyed the tool on reports_to===null while the
    // kickoff went to (type==='boss' || reports_to===null || roles[0]), so a
    // fallback-selected boss could be told to call org_complete without having
    // the tool.
    // M2: endpoint roles are never the boss.
    const sessionRoles = agentRoles(def.roles);
    if (sessionRoles.length === 0)
      throw new Error(`org ${name}: no agent roles — endpoint roles cannot run an org`);
    const bossRole =
      sessionRoles.find((r) => r.type === 'boss' || r.reports_to === null) ?? sessionRoles[0];
    running.bossRoleId = bossRole.id;
    // Canonical entity names from THIS org's KG — injected into the coordinator
    // prompt so org_learn extractions reuse them instead of minting duplicates.
    // Scoped: an unscoped glossary handed every org's entity names to every
    // coordinator, which is how one org's claims got merged into another's.
    const glossary = await (async () => {
      try {
        if (!(await this.orgMemoryUsable())) return [];
        const kg = await import('../memory/memory-kg.js');
        return await kg.kgGlossary({
          dbPath: this.orgMemoryDbPath(),
          scope: orgMemory.orgKgScope(name),
        });
      } catch {
        return [];
      }
    })();
    running.glossary = glossary;
    // Resource-gated staggered spawn: check memory/process limits before each
    // NON-BOSS agent, wait if under pressure. The boss always spawns immediately
    // and ungated — the org has no coordinator at all without it, so gating it
    // behind host memory pressure would make the whole org fail to start over a
    // condition workers are specifically designed to ride out.

    // Extracted so a role that fails its gate check can be spawned later by
    // scheduleDeferredSpawn() once resources free up, without re-running the
    // gate logic or duplicating the session-wiring below.
    const spawnRole = (role: OrgRole, roleCheckpoint?: RoleCheckpoint): void => {
      if (running.agents.has(role.id)) return;
      if (isEndpointRole(role)) return; // M2: no session, mailbox or slot
      const { runtime, abort } = this.spawnRoleIncarnation(
        name,
        running,
        role,
        roleCheckpoint?.generation ?? 0,
        { roleCheckpoint },
      );
      running.agents.set(role.id, runtime);
      running.roleSlots.set(role.id, {
        generation: roleCheckpoint?.generation ?? 0,
        phase: 'running',
        runtime,
        abort,
        effectiveRole:
          roleCheckpoint?.effectiveRoleOverrides &&
          Object.keys(roleCheckpoint.effectiveRoleOverrides).length > 0
            ? mergeEffectiveRoleConfig(role, roleCheckpoint.effectiveRoleOverrides as RoleOverrides)
            : role,
        respawnCount: roleCheckpoint?.respawnCount ?? 0,
        queuedDuringSwap: roleCheckpoint?.queuedDuringSwap ?? [],
        retiredUsage: roleCheckpoint?.retiredUsage ?? { tokens: 0, costUsd: 0 },
      });
    };

    if (options?.resume && checkpoint) {
      const restoredRoles = new Set(Object.keys(checkpoint.roleState));
      for (const [roleId, roleState] of Object.entries(checkpoint.roleState)) {
        const role = def.roles.find((r) => r.id === roleId);
        if (role) spawnRole(role, roleState);
      }
      const pendingRoles = new Map<string, OrgRole>();
      for (const role of def.roles) {
        if (!restoredRoles.has(role.id) && !isEndpointRole(role)) {
          pendingRoles.set(role.id, role);
        }
      }
      running.pendingRoles = pendingRoles;
      running.spawnRole = spawnRole;
      running.taskDag =
        checkpoint.tasks && checkpoint.tasks.length > 0
          ? TaskDag.fromJSON(checkpoint.tasks)
          : new TaskDag();
      // A 'running' task's "[task:…]" message was consumed by the session that
      // was working it. If that role's SDK session is resumed (checkpointed
      // sessionId) the task is still in its context; otherwise — role not
      // restored at all, or restored into a fresh session — nothing knows
      // about the task, so put it back to 'ready' and re-dispatch.
      for (const task of running.taskDag.all()) {
        if (task.status !== 'running') continue;
        if (checkpoint.roleState[task.assignee]?.sessionId) continue;
        running.taskDag.requeue(task.id);
      }
      decisionOps.dispatchReadyTasks(this, name, running);
      if (worktreePath) running.worktreePath = worktreePath;
    } else {
      spawnRole(bossRole); // always, ungated — see comment above

      // Lazy spawn: register non-boss roles as pending. They spawn on first
      // message (see deliver()), avoiding the memory gate stampede at startup.
      const pendingRoles = new Map<string, OrgRole>();
      for (const role of def.roles) {
        if (role.id === bossRole.id || isEndpointRole(role)) continue;
        pendingRoles.set(role.id, role);
      }
      running.pendingRoles = pendingRoles;
      running.spawnRole = spawnRole;
      running.taskDag = new TaskDag();
      if (worktreePath) running.worktreePath = worktreePath;
    }

    // Crash cleanup: reap SDK children if this process exits abnormally.
    // monolean: process-scoped listener — upgrade path = per-org tracking
    const crashCleanup = (): void => {
      try {
        // Statically imported: a process 'exit' handler must be synchronous,
        // so `await import()` is unavailable — and a bare require() throws
        // "require is not defined" in this ESM package. Guarded by
        // no-cjs-require-in-esm.test.ts.
        reapOrphanedSdkProcesses(new Set(), process.pid);
      } catch {
        /* best-effort */
      }
      // #301: `process.on('exit')` is the SECOND termination path — it fires
      // for a normal stop too (finishStop's own prune above already covers
      // that case, so this is a harmless idempotent repeat there) but also
      // for every path that reaches it via an explicit `process.exit()`
      // (org.ts's SIGTERM/SIGINT/SIGHUP handlers, uncaughtException,
      // unhandledRejection) — none of which run finishStop's cleanup at all.
      // execFileSync is already a static top-level import (see the comment
      // above), so this stays synchronous-safe like the rest of this
      // handler. SIGKILL cannot reach here — no in-process code runs for
      // it — which is why prune-at-start exists as the complement.
      try {
        execFileSync('git', ['worktree', 'prune'], {
          cwd: this.root,
          stdio: 'ignore',
          timeout: 30_000,
        });
      } catch {
        /* best-effort: not a git repo, git missing, or a wedged hook */
      }
    };
    process.on('exit', crashCleanup);
    (running as RunningOrg & { _crashCleanup?: () => void })._crashCleanup = crashCleanup;

    // Stale-base drift detection: if the working tree is too many commits behind
    // its tracking branch, warn or refuse to start. Best-effort — git may not be
    // available, or the repo may have no tracking branch.
    const staleThreshold = (def.run_config as Record<string, unknown>).stale_base_threshold as
      | number
      | undefined;
    if (staleThreshold && staleThreshold > 0 && cwd === this.root) {
      try {
        const { execSync } = await import('node:child_process');
        const behind = execSync('git rev-list --count HEAD..@{upstream} 2>/dev/null', {
          cwd,
          encoding: 'utf8',
          timeout: 10_000,
        }).trim();
        const count = parseInt(behind, 10);
        if (!Number.isNaN(count) && count > staleThreshold) {
          bus.emit({
            type: 'audit',
            reason: 'stale-base',
            msg: `working tree is ${count} commits behind upstream (threshold: ${staleThreshold}) — consider pulling before running`,
            data: { behind: count, threshold: staleThreshold },
          });
        }
      } catch {
        /* no upstream tracking or git unavailable — skip silently */
      }
    }

    const boss = bossRole;
    if (options?.resume) {
      if (running.agents.get(boss.id)?.mailbox.serialize().queue.length === 0) {
        running.agents
          .get(boss.id)
          ?.mailbox.push(
            `Org "${name}" resumed from checkpoint (run ${run}).\nGoal: ${taskOverride ?? def.goal}\n` +
              `Outstanding tasks and role states have been restored. Continue coordinating your team.`,
          );
      }
      bus.emit({
        type: 'status',
        msg: `org resumed from checkpoint (${run})`,
        data: { goal: taskOverride ?? def.goal },
      });
    } else {
      // Cross-run memory: brief the coordinator on the previous run so scheduled
      // orgs accumulate instead of starting cold every interval.
      const prev = readHistory(this.root, name).at(-1);
      const prevBrief = prev
        ? `\n\nPrevious run (${prev.run}${prev.endedAt ? `, ${new Date(prev.endedAt).toISOString()}` : ''}): ` +
          (prev.outcome
            ? `outcome "${prev.outcome.status}" — ${prev.outcome.summary}`
            : `no recorded outcome (${prev.messages} messages, ${prev.assets.length} assets${prev.crashes.length ? `, ${prev.crashes.length} crashed agent(s)` : ''})`) +
          `\nBuild on that work — do not redo what is already done.`
        : '';
      running.agents
        .get(boss.id)
        ?.mailbox.push(
          `Org "${name}" started (run ${run}).\nGoal: ${taskOverride ?? def.goal}\n` +
            `Coordinate your team via org_send. Only when the FULL goal above is achieved (or clearly can't be) — not merely "this batch of dispatched tasks finished" — record it with org_complete, then end your turn. ` +
            `If a batch finishes but the goal has more scope left, dispatch the next batch instead of ending the run.${prevBrief}`,
        );
      bus.emit({
        type: 'status',
        msg: `org started (${sessionRoles.length} agents)`,
        data: { goal: taskOverride ?? def.goal },
      });
    }
    this.persistState(name, 'running', run);

    // Idle watchdog: a hung tool call (or a run that quietly finished without
    // org_complete) produces no bus events, and every agent just waits. After
    // idle_minutes of silence, nudge the boss to complete or reassign; if the
    // nudge itself produces no activity (boss hung/crashed), or the org keeps
    // going idle after MAX_IDLE_NUDGES nudges in a row without ever recovering
    // (see resolvedIdleNudgeCount), stop the run instead of letting it freeze
    // forever. idle_minutes: 0 disables.
    const idleMs = (def.run_config.idle_minutes ?? 10) * 60_000;
    if (idleMs > 0) {
      const MAX_IDLE_NUDGES = 3;
      let nudgedAt = 0;
      let nudges = 0;
      let stopping = false;
      const idleStop = (msg: string): void => {
        stopping = true;
        bus.emit({ type: 'audit', reason: 'idle-stop', msg });
        // #302: closedBy: 'idle-stop' — the truth gate at finishStop's
        // history write reads this to record what actually happened
        // (including any runnable work left in org_tasks) instead of
        // letting a null outcome default to a plain "completed".
        this.stopOrg(name, { closedBy: 'idle-stop' }).catch((err) =>
          console.error(`org ${name}: idle-stop failed:`, err instanceof Error ? err.message : err),
        );
      };
      // #296: publish the projected stop time for `org status --json`. Only
      // written when it changes; a failed write must not throw out of the
      // interval (that would reach the process crash handlers).
      let published = '';
      const publishDeadline = (hold: IdleHoldState | null): void => {
        if (stopping) return;
        const bossRt = running.agents.get(bossRole.id);
        const at = hold
          ? null
          : new Date(
              projectIdleStop({
                lastActivity,
                nudgedAt,
                nudges,
                maxNudges: MAX_IDLE_NUDGES,
                idleMs,
                bossReachable: bossRt?.status === 'running' && !bossRt.mailbox.isClosed,
              }),
            ).toISOString();
        const key = `${at}|${hold?.reason ?? null}|${hold?.until ?? null}`;
        if (key === published) return;
        try {
          writeIdleRecord(this.root, name, {
            run,
            idle_minutes: idleMs / 60_000,
            idle_stop_at: at,
            hold,
          });
          published = key;
        } catch (err) {
          console.error(
            `org ${name}: could not write the idle deadline:`,
            err instanceof Error ? err.message : err,
          );
        }
      };
      // ADR-O001 D4 — Gas Town's "30 minutes hooked without progress" alarm.
      // The org-wide idle clock is silent while a hold is in force, so a role
      // that is nominally running and producing nothing gets its own, loud
      // audit event. Once per spell: the bus subscriber clears the flag as
      // soon as the role emits anything.
      const alarmNoProgress = (now: number): void => {
        // Only a role with work can be stalled on it: one with no task and no
        // mail, parked on its mailbox (or with its process down after
        // session_idle_exit_ms), is waiting, not hooked.
        const withTask = new Set(
          (running.taskDag?.all() ?? [])
            .filter((t) => t.status === 'running')
            .map((t) => t.assignee),
        );
        const stalled = noProgressRoles(
          [...running.agents].map(([id, rt]) => ({
            id,
            working:
              rt.status === 'running' &&
              !rt.mailbox.isClosed &&
              hookedOnWork({
                runningTask: withTask.has(id),
                queuedMail: rt.mailbox.peek() !== undefined,
                awaitingMail: rt.mailbox.awaitingMail,
              }),
            lastActivity: roleActivity.get(id) ?? lastActivity,
            alarmed: noProgressAlarmed.has(id),
          })),
          now,
        );
        for (const role of stalled) {
          noProgressAlarmed.add(role.id);
          bus.emit({
            type: 'audit',
            from: role.id,
            reason: 'no-progress',
            msg:
              `role "${role.id}" has been running for ${Math.round(role.silentMs / 60_000)}m ` +
              `without a single bus event — it is hooked but producing nothing`,
            data: { role: role.id, silentMinutes: Math.round(role.silentMs / 60_000) },
          });
        }
      };
      // The legitimate waits the watchdog holds through — every one of them
      // with a deadline attached by advanceHold (ADR-O001 D4).
      const holdReason = (): WaitHold | { reason: WaitHold; until: number } | null => {
        if (this.restarting.has(name)) return 'restarting'; // boss auto-restart in flight
        // A pending gate means the org is legitimately waiting for human input
        const pendingGates = this.readGates(name).gates.filter((g) => g.status === 'pending');
        if (pendingGates.length > 0) return 'pending-gate';
        // Bug 3: a pending ask_human question is the same kind of legitimate
        // wait as a pending gate — askHuman()'s receipt tells the role to end
        // its turn and wait for the resolution, so a role that follows that
        // instruction and goes quiet looks identical to a genuinely stalled
        // agent. Without this check the watchdog nudges (and, after enough
        // nudges, idle-stops) an org that's simply waiting on a human answer
        // that's already on its way.
        //
        // ADR-O001 D4: only a question the asker declared BLOCKING counts. The
        // 8.3-hour stall was held open by a question whose own text opened
        // with "no answer needed for the run to continue; I am not blocking on
        // this" — it suppressed the watchdog exactly like a real blocker.
        if (questionOps.pendingBlockingQuestions(this.root, name).length > 0)
          return 'pending-question';
        // M1 (C-41): a pending tool approval is the same kind of legitimate
        // wait — the role was told to wait for `org approve/deny`.
        if ((this.approvals.get(name) ?? []).some((a) => a.approved === null))
          return 'pending-approval';
        // M2 (C-41): a delivered endpoint message whose reply is still due.
        if (hasActiveEndpointWait(running)) return 'endpoint-reply-due';
        // A task blocked on a real-world time still in the future is
        // legitimate waiting, same as a pending gate — don't nudge about it.
        // Its deadline is the time the asker actually named, not the default
        // hold TTL, so a block set hours out is honoured exactly.
        const blockedUntil = running.taskDag?.activeBlockUntil(Date.now()) ?? null;
        if (blockedUntil !== null) return { reason: 'task-blocked', until: blockedUntil };
        return null;
      };
      // Auto-resume any task whose org_task_block time has passed: flip it
      // back to 'running' and re-push it into the assignee's mailbox, same as
      // a fresh dispatch. This IS real activity, so it feeds the normal
      // idleFor check rather than short-circuiting it — an unblocked task
      // should reset the idle clock, not just silently update state nobody
      // notices until the next nudge. Runs on every tick, a hold in force
      // included: a block that expires mid-wait is real work again.
      const resumeExpiredBlocks = (): void => {
        wakeDueBlockRechecks(running, Date.now()); // #329: every block is re-checked
        const unblocked = running.taskDag?.unblockExpired(Date.now()) ?? [];
        for (const task of unblocked) {
          const agent = running.agents.get(task.assignee);
          if (agent && !agent.mailbox.isClosed) {
            agent.mailbox.push(`${taskTag(task)} Block expired — resuming: ${task.title}`);
          }
          bus.emit({
            type: 'status',
            from: 'dag',
            reason: 'task-unblocked',
            msg: `task ${task.id} block expired — resumed and re-dispatched to ${task.assignee}`,
            data: { taskId: task.id, assignee: task.assignee },
          });
        }
      };
      // The normal idle path: nudge the boss, then stop if the nudge produced
      // nothing. Runs only when nothing (still) holds the watchdog.
      const check = (): void => {
        const idleFor = Date.now() - lastActivity;
        if (idleFor < idleMs) {
          nudges = resolvedIdleNudgeCount(nudgedAt, nudges, lastToolActivity);
          nudgedAt = 0;
          return;
        }
        if (nudgedAt === 0) {
          if (nudges >= MAX_IDLE_NUDGES) {
            idleStop(`org idle again after ${nudges} nudges — stopping run`);
            return;
          }
          const bossRt = running.agents.get(bossRole.id);
          // #205: a budget-exhausted boss closed its own mailbox on
          // purpose (session.ts) — that's a recoverable pause, not the
          // same "unreachable" condition as a crash. Name it distinctly so
          // the operator's remedy (raise the budget, resume) is obvious
          // instead of reading like the run died.
          const budgetReason = bossRt?.mailbox.closeReason;
          if (budgetReason === 'token-budget' || budgetReason === 'usd-budget') {
            idleStop(
              `org idle for ${Math.round(idleFor / 60_000)}m and boss "${bossRole.id}" is over its ` +
                `${budgetReason === 'token-budget' ? 'token' : 'USD'} budget — raise the role's ` +
                `${budgetReason === 'token-budget' ? 'budget_tokens' : 'budget_usd'} (or run_config's) and resume from checkpoint — stopping run`,
            );
            return;
          }
          if (bossRt?.status !== 'running' || bossRt.mailbox.isClosed) {
            idleStop(
              `org idle for ${Math.round(idleFor / 60_000)}m and boss "${bossRole.id}" is unreachable — stopping run`,
            );
            return;
          }
          nudges++;
          nudgedAt = Date.now();
          bus.emit({
            type: 'audit',
            from: bossRole.id,
            reason: 'idle-nudge',
            msg: `no org activity for ${Math.round(idleFor / 60_000)}m — nudging boss (${nudges}/${MAX_IDLE_NUDGES})`,
          });
          bossRt.mailbox.push(
            `[watchdog] No activity in org "${name}" for ${Math.round(idleFor / 60_000)} minute(s). ` +
              `Check org_tasks first, then pick ONE: (1) the org's full stated goal is achieved or clearly cannot be — call org_complete now (this ends the run for good, not just this batch); ` +
              `(2) someone has stalled or unstarted work — check on your team via org_send and reassign it; ` +
              `(3) the current task batch is done but the goal has more scope left — do NOT call org_complete for this case, instead dispatch the next batch of work with org_task/createTask so the org keeps making progress; ` +
              `(4) a task is stuck 'running' only because it's genuinely waiting on a real-world time (a scheduled process, a deadline) and there is nothing else to dispatch right now — do NOT just leave it and re-confirm this every time you get nudged, call org_task_block(taskId, untilIso, reason) instead so this watchdog stops nudging you about it and auto-resumes the task when the time arrives.`,
          );
        } else if (Date.now() - nudgedAt >= idleMs) {
          idleStop(
            `nudge produced no activity for another ${Math.round(idleMs / 60_000)}m — boss appears hung, stopping run`,
          );
        }
      };
      // One watchdog tick. The hold is resolved FIRST and with a deadline, so
      // a wait that outlives its deadline hands the run back to the idle path
      // instead of suppressing it forever (ADR-O001 D4).
      let holdTrack: HoldTrack | null = null;
      const tick = (): IdleHoldState | null => {
        const now = Date.now();
        alarmNoProgress(now);
        resumeExpiredBlocks();
        const step = advanceHold(holdTrack, holdReason(), now);
        holdTrack = step.track;
        if (step.expired) {
          bus.emit({
            type: 'audit',
            reason: 'hold-expired',
            msg:
              `the "${step.expired}" hold on org "${name}" outlived its deadline — the idle ` +
              `watchdog is running again and will nudge, then stop the run if nothing happens`,
            data: { hold: step.expired },
          });
        }
        if (step.hold) return step.hold;
        check();
        return null;
      };
      const initialHold = advanceHold(null, holdReason(), Date.now());
      holdTrack = initialHold.track;
      publishDeadline(initialHold.hold);
      const wd = setInterval(
        () => publishDeadline(tick()),
        Math.max(200, Math.min(idleMs / 2, 30_000)),
      );
      (wd as { unref?: () => void }).unref?.();
      this.watchdogs.set(name, wd);
    } else {
      try {
        writeIdleRecord(this.root, name, {
          run,
          idle_minutes: 0,
          idle_stop_at: null,
          hold: { reason: 'disabled', until: null },
        });
      } catch (err) {
        console.error(
          `org ${name}: could not write the idle deadline:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (this.opts.crossProcess && this.opts.inboxUrl) {
      const operatorCred = normalizeCredential(this.opts.operatorCredential);
      const lease = new BrokerLease(
        name,
        this.opts.inboxUrl,
        this.opts.brokerDir,
        undefined,
        running.credential,
        operatorCred ? { credential: operatorCred, dir: this.opts.operatorDir } : undefined,
        this.root,
      );
      lease.start();
      this.leases.set(name, lease);
    }

    // Drain any messages that arrived while the org was offline
    const queued = drainInbox(this.root, name);
    // M2: messages for endpoint roles are delivered by POST, not into a mailbox —
    // put them back (flagged) and let the endpoint retry path send them.
    const endpointQueued = new Set<string>();
    for (const msg of queued) {
      if (!isEndpointRole(def.roles.find((r) => r.id === msg.toRole))) continue;
      const messageId = msg.messageId ?? newMessageId();
      endpointQueued.add(messageId);
      queueMessage(this.root, name, { ...msg, messageId, endpoint: true });
    }
    startEndpointRetryLoop(this, name);
    if (endpointQueued.size > 0)
      void retryQueuedEndpoints(this, name, (m) => endpointQueued.has(m.messageId ?? '')).catch(
        () => {
          /* stays queued — the periodic sweep retries */
        },
      );
    for (const msg of queued) {
      if (isEndpointRole(def.roles.find((r) => r.id === msg.toRole))) continue;
      // Spawn a lazy target before delivering. These messages were queued while
      // the org was offline — a human's answer, or another org's request — and
      // the whole point of draining is that they arrive. Skipping a role merely
      // because it has not spawned yet discarded them permanently, after
      // queueMessage had already reported them accepted.
      if (!running.agents.has(msg.toRole) && running.pendingRoles?.has(msg.toRole)) {
        const pending = running.pendingRoles.get(msg.toRole)!;
        // Bug 4: don't spawn past run_config.max_concurrent_agents. Requeue
        // this message (queueMessage, not a silent drop) and defer the spawn
        // the same way a concurrency-gated lazy spawn defers elsewhere.
        const concurrencyLimit = def.run_config.max_concurrent_agents;
        if (concurrencyLimit != null && activeRoleCount(running) >= concurrencyLimit) {
          running.pendingRoles.delete(msg.toRole);
          queueMessage(this.root, name, msg);
          this.scheduleConcurrencyDeferredSpawn(name, running, pending, running.spawnRole!);
        } else {
          running.pendingRoles.delete(msg.toRole);
          running.spawnRole?.(pending);
        }
      }
      const agent = running.agents.get(msg.toRole);
      if (agent && !agent.mailbox.isClosed) {
        bus.emit({
          type: 'xorg',
          from: msg.fromQualified,
          to: `${name}:${msg.toRole}`,
          subject: msg.subject,
          msg: msg.body,
          data: { messageId: msg.messageId ?? newMessageId() },
        });
        await crossOrg.pushMessage(
          this,
          name,
          running,
          msg.toRole,
          msg.fromQualified,
          msg.subject,
          msg.body,
          `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`,
        );
      }
    }
    if (queued.length)
      bus.emit({ type: 'status', msg: `drained ${queued.length} queued message(s) from inbox` });

    return running;
  }

  /** Build one role incarnation: mailbox, policy, AgentRuntime, sessionOpts,
   *  and the supervised crash-retry loop. Used by BOTH the startup lazy-spawn
   *  path (generation 0, via the `spawnRole` closure inside startOrgInner)
   *  and respawnRole() (generation N+1). Does not touch running.agents or
   *  running.roleSlots — callers publish the result themselves. */
  spawnRoleIncarnation(
    name: string,
    running: RunningOrg,
    role: OrgRole,
    generation: number,
    opts: {
      roleCheckpoint?: RoleCheckpoint;
      abort?: AbortController;
      budgetTokensOverride?: number;
    } = {},
  ): { runtime: AgentRuntime; abort: AbortController } {
    const { roleCheckpoint } = opts;
    const abort = opts.abort ?? new AbortController();
    const { def, bus, run } = running;
    const cwd = running.workdir!;
    const ws = this.workspaceSetting(def);
    const perRoleBudget = opts.budgetTokensOverride ?? computeReplacementBudget(def, role.id);
    let roleCwd = cwd;
    const existingSlot = running.roleSlots.get(role.id);
    if (ws === 'worktree-per-role' && role.id !== running.bossRoleId) {
      const wtPath = join(this.root, ORG_DIR, name, `worktree-${role.id}`);
      if (existingSlot?.runtime?.worktreePath === wtPath && existsSync(wtPath)) {
        // A replacement (generation > 0) reuses the SAME worktree path —
        // recreating it here would delete any uncommitted work the old
        // incarnation left behind (design constraint #5).
        roleCwd = wtPath;
      } else {
        try {
          // Q7: top-level `import { execFileSync }` replaces the inlined
          // `require('node:child_process')` that broke ESM at runtime —
          // vitest's CJS shim masked it in tests but the built package
          // threw "require is not defined" in real Node ESM execution.
          // SEC-5: argv-array form, no shell.
          if (existsSync(wtPath)) {
            try {
              execFileSync('git', ['worktree', 'remove', '--force', wtPath], {
                cwd: this.root,
                stdio: 'ignore',
                timeout: 30_000,
              });
            } catch {
              /* best-effort */
            }
          }
          execFileSync('git', ['worktree', 'add', wtPath, 'HEAD', '--detach'], {
            cwd: this.root,
            stdio: 'ignore',
            timeout: 30_000,
          });
          roleCwd = wtPath;
        } catch {
          /* fallback to shared cwd if git worktree fails */
        }
      }
    }
    const mailbox = new Mailbox();
    if (roleCheckpoint?.mailboxQueue?.length) {
      restoreMailboxQueue({ mailbox } as any, roleCheckpoint.mailboxQueue);
    }
    // A recoverable close (budget exhaustion) is left open on resume — see
    // isRecoverableCloseReason's doc comment. Re-closing it here would
    // make the idle watchdog's "raise the budget and resume" remedy a
    // no-op, since nothing in this codebase ever reopens a closed mailbox.
    if (
      roleCheckpoint?.mailboxClosed &&
      !isRecoverableCloseReason(roleCheckpoint.mailboxCloseReason)
    ) {
      mailbox.close(roleCheckpoint.mailboxCloseReason);
    }
    const policy = new PolicyEngine(
      role.id,
      {
        maxTokens: role.budget_tokens ?? perRoleBudget,
        // ADR-O001 D1: which basis that ceiling is enforced on. Defaults to
        // the historical uncached basis so the honest (cache-aware) meter
        // introduced alongside it cannot exhaust an existing budget_tokens —
        // including the schema's 1M default — roughly 100x early.
        maxTokensBasis: def.run_config.budget_tokens_basis ?? 'uncached',
        maxUsd: role.budget_usd,
        ...(role.policy ?? {}),
      },
      bus,
      roleCwd,
      // #303: the file tools (Read/Write/Edit/Glob/Grep) get the same extra
      // roots the Bash sandbox already treats as writable (role-sandbox.ts) —
      // $TMPDIR, the org root, and any policy.sandbox.allowWrite entries.
      // $HOME is deliberately excluded; see file-roots.ts.
      fileToolRoots({ cwd: roleCwd, orgRoot: this.root }, role.policy?.sandbox),
    );
    policy.setToolContext({
      providerPrefixes: () =>
        roleProviderPrefixes({ tool_providers: effectiveToolProviders(role, this.root) }),
      trace: () => this.roleTrace(name, role.id),
    });
    // ADR-O001 D1: prefer the persisted four-quantity breakdown; a checkpoint
    // written before it existed still resumes via the scalar, on the uncached
    // basis it was recorded on.
    if (roleCheckpoint?.tokenUsage) {
      policy.setTokenUsage(roleCheckpoint.tokenUsage);
    } else if (roleCheckpoint?.tokensUsed) {
      policy.setUsage(roleCheckpoint.tokensUsed);
    }
    // ORG-7: restore accumulated USD spend across resume so a stop/resume
    // cycle can't reset a role's USD budget back to zero.
    if (roleCheckpoint?.costUsd) {
      policy.setUsageUsd(roleCheckpoint.costUsd);
    }
    // ADR-O001 D7: the loadout this incarnation's session is built with, fixed
    // for its life. A checkpointed role keeps what it had (its SDK session was
    // built with it); a replacement keeps its predecessor's; a new role takes
    // the loadout of the first ready task it is being spawned for.
    const loadoutName = roleCheckpoint
      ? roleCheckpoint.loadout
      : (existingSlot?.runtime?.loadout ?? sessionLoadoutFor(running.taskDag, role.id));
    let loadout: ReturnType<typeof resolveLoadout> | undefined;
    if (loadoutName) {
      try {
        loadout = resolveLoadout(def, loadoutName, this.root);
      } catch (err) {
        // Validated at start, so only a config hot-reload or a deleted
        // instructions_file lands here. Spawn without it, loudly: a role that
        // fails to spawn would strand its task, which is worse.
        bus.emit({
          type: 'audit',
          from: role.id,
          reason: 'loadout-unresolvable',
          msg: `role "${role.id}" spawned without loadout "${loadoutName}": ${err instanceof Error ? err.message : err}`,
          data: { loadout: loadoutName },
        });
      }
    }
    const runtime: AgentRuntime = {
      mailbox,
      policy,
      status: restoredRoleStatus(roleCheckpoint),
      done: Promise.resolve(),
      metrics: { tokens: roleCheckpoint?.tokensUsed ?? 0, costUsd: roleCheckpoint?.costUsd ?? 0 },
      lastMessageId: roleCheckpoint?.lastMessageId,
      error: roleCheckpoint?.error,
      sessionId: roleCheckpoint?.sessionId,
      worktreePath: roleCwd !== cwd ? roleCwd : undefined,
      scrollback: new ScrollbackBuffer(),
      ...(loadout ? { loadout: loadout.name } : {}),
      taskProcesses: new TaskProcesses(),
    };
    if (roleCheckpoint?.scrollback?.length) {
      for (const line of roleCheckpoint.scrollback) runtime.scrollback.push(line);
    }
    if (roleCheckpoint?.turns && !running.turns?.has(role.id)) {
      (running.turns ??= new Map()).set(role.id, roleCheckpoint.turns);
    }
    const sessionOpts = {
      org: name,
      role,
      bus,
      policy,
      mailbox,
      taskProcesses: runtime.taskProcesses,
      cwd: roleCwd,
      def,
      // Pass the org state directory so runners that persist per-role state
      // (VercelAgentRunner session files) write under .monomind/orgs/<name>
      // instead of polluting the workspace cwd.
      orgDir: join(this.root, ORG_DIR, name),
      // Project root for named-provider (`adapter_config.provider`) config
      // lookup — role cwd may be an isolated workspace with no config file.
      orgRoot: this.root,
      run,
      // M1: role tool providers — listed at session start, processes spawned
      // lazily on first call and killed when the session ends.
      buildProviderTools: async () => {
        const providers = effectiveToolProviders(role, this.root);
        if (providers.length === 0) return undefined;
        return this.toolProviders.buildRoleTools({
          ctx: { org: name, run, role: role.id, root: this.root },
          providers,
          trace: () => this.roleTrace(name, role.id),
          bus,
          cwd: roleCwd,
        });
      },
      maxTurns: role.max_turns_per_message ?? def.run_config.max_turns_per_message,
      resumeSessionId: roleCheckpoint?.sessionId,
      sessionLedger: running.sessionLedger,
      // ADR-O001 D3 x D7: a task-scoped session is built with its task's own
      // recorded loadout. Unresolvable → no loadout, loudly (as at spawn).
      loadoutFor: (taskId: string) => {
        const name = running.taskDag?.get(taskId)?.loadout;
        if (!name) return undefined;
        try {
          return resolveLoadout(def, name, this.root);
        } catch (err) {
          bus.emit({
            type: 'audit',
            from: role.id,
            reason: 'loadout-unresolvable',
            msg: `task ${taskId} session built without loadout "${name}": ${err instanceof Error ? err.message : err}`,
            data: { loadout: name, taskId },
          });
          return undefined;
        }
      },
      lastMessageId: () => runtime.lastMessageId,
      onOutput: (line: string) => runtime.scrollback.push(line),
      onSessionId: (id: string) => {
        runtime.sessionId = id;
      },
      onTurnEnd: () => {
        endTurn(running, role.id);
        decisionOps.nudgeOpenTasksAtTurnEnd(running, role.id);
      },
      // #327: the role's org_send mail carries its chain at the next hop.
      deliver: (from: string, to: string, subject: string, body: string) =>
        this.deliver(name, from, to, subject, withTrace(body, this.roleTrace(name, role.id))),
      askHuman: (r: string, question: string, blocking?: boolean) =>
        this.askHuman(name, r, question, blocking),
      onGate: (r: string, gateName: string, gateDesc: string) =>
        this.createGate(name, r, gateName, gateDesc),
      circuitBreaker: (() => {
        const cb = (def.run_config as Record<string, unknown>).circuit_breaker as
          | { failure_threshold?: number; cooldown_ms?: number }
          | undefined;
        if (!cb) return undefined;
        return { threshold: cb.failure_threshold ?? 5, state: { failures: 0, tripped: false } };
      })(),
      beforeTool: (r: string, toolName: string, input: Record<string, unknown>) =>
        this.checkApproval(name, r, toolName, input),
      fence: running.fences?.get(role.id),
      // ORG-1: gatedCanUseTool denials are a natural decision point — record them so
      // `org decisions` shows real traces instead of always reporting none.
      onDecision: (r: string, toolName: string, message: string, kind: DecisionKind) => {
        this.recordDecision(name, r, {
          type: 'tool',
          kind,
          context: `tool call: ${toolName}`,
          reasoning: message,
          outcome: 'denied',
        });
      },
      // ORG-9: decision gates are documented as "hard-blocking" — make that
      // true by actually denying tool use while this role has a pending gate,
      // the same way pending approvals already do.
      hasPendingGate: () => this.listGates(name, 'pending').some((g) => g.roleId === role.id),
      // #302: refuse an unsatisfiable org_complete BEFORE the 'org-complete'
      // status event ever exists — the bus subscriber at the top of this
      // function auto-stops the run on that event alone, so a refusal that
      // still emitted it would be undone by the very next tick regardless of
      // what this function returns to the tool handler.
      onComplete:
        role.id === running.bossRoleId
          ? (
              r: string,
              outcome: 'achieved' | 'partial' | 'failed',
              summary: string,
              blocker?: 'budget' | 'human' | 'external' | 'time',
              blockerDetail?: string,
            ) => {
              let maxBudgetFraction = 0;
              for (const rt of running.agents.values()) {
                const p = rt.policy;
                if (p.policy.maxTokens)
                  maxBudgetFraction = Math.max(maxBudgetFraction, p.usage / p.policy.maxTokens);
                if (p.policy.maxUsd)
                  maxBudgetFraction = Math.max(maxBudgetFraction, p.usageUsd / p.policy.maxUsd);
              }
              // Same predicates the idle watchdog uses for its own
              // legitimate-wait check (:1316-1328) — a pending gate or an
              // unanswered question is the same "genuinely waiting on a
              // human" fact either way.
              const pendingHumanWaits =
                this.listGates(name, 'pending').length +
                questionOps.pendingBlockingQuestions(this.root, name).length;
              return resolveOrgComplete(bus, r, outcome, summary, blocker, blockerDetail, {
                mode: def.run_config.completion ?? 'boss',
                maxBudgetFraction,
                pendingHumanWaits,
                hasActiveBlock: running.taskDag?.hasActiveBlock(Date.now()) ?? false,
                hasPendingWork: running.taskDag?.hasPendingWork() ?? false,
              });
            }
          : undefined,
      // #11: a boss that overflows its context window isn't a crash (it keeps
      // returning +0-token errors forever), so without this the idle watchdog
      // just nudges it for ~30 min before idle-stopping. Restart the whole org
      // with fresh sessions instead — bounded by MAX_BOSS_RESTARTS.
      onContextLimit:
        role.id === running.bossRoleId ? () => this.scheduleBossRestart(name) : undefined,
      onListRuntimeOptions:
        role.id === running.bossRoleId && (def.run_config.max_role_respawns ?? 0) > 0
          ? () => this.listRuntimeOptions()
          : undefined,
      onRespawnRole:
        role.id === running.bossRoleId && (def.run_config.max_role_respawns ?? 0) > 0
          ? (callerId: string, args: any) => this.respawnRole(name, callerId, args)
          : undefined,
      recall: async (r: string, q: string) => {
        const answer = await this.recallOrgMemory(name, def, q, r);
        bus.emit({
          type: 'status',
          from: r,
          reason: 'org-recall',
          msg: `recall: ${q.slice(0, 80)}`,
          data: { hits: answer.hits },
        });
        return answer.text;
      },
      searchKnowledge: async (r: string, q: string) => {
        const answer = await this.searchProjectKnowledge(q);
        bus.emit({
          type: 'status',
          from: r,
          reason: 'knowledge-search',
          msg: `knowledge: ${q.slice(0, 80)}`,
          data: { hits: answer.hits },
        });
        return answer.text;
      },
      glossary: running.glossary,
      remember: async (r: string, content: string, scope: 'org' | 'agent') => {
        const text = await this.rememberOrgMemory(name, def, r, content, scope, run);
        bus.emit({
          type: 'status',
          from: r,
          reason: 'org-remember',
          msg: `remember (${scope}): ${content.slice(0, 80)}`,
          data: { scope },
        });
        return text;
      },
      learn: async (
        r: string,
        payload: { nodes?: unknown[]; edges?: unknown[]; rules?: unknown[] },
      ) => {
        const text = await this.learnOrgKnowledge(name, run, payload);
        bus.emit({
          type: 'status',
          from: r,
          reason: 'org-learn',
          msg: `learn: ${text.slice(0, 120)}`,
          data: {
            nodes: payload.nodes?.length ?? 0,
            edges: payload.edges?.length ?? 0,
            rules: payload.rules?.length ?? 0,
          },
        });
        return text;
      },
      createTask: (
        r: string,
        title: string,
        assignee: string,
        deps: string[],
        loadout?: string,
        brief?: string,
        pick?: TaskPick,
      ) => {
        return this.dagCreateTask(name, r, title, assignee, deps, loadout, brief, pick);
      },
      pickAssignee: resolveAutoAssignee(
        def,
        (id) => openTaskCount(this.orgs.get(name), id),
        () => this.orgs.get(name)?.taskDag?.all() ?? [],
      ),
      onSkillLoad: (r: string, skill: string) =>
        decisionOps.recordSkillLoad(this.orgs.get(name), r, skill),
      // ADR-O001 D7: only an org with a catalog gets the `loadout` argument;
      // the session itself is built with the loadout frozen above.
      loadoutCatalog: loadoutCatalog(def),
      loadout,
      completeTask: (r: string, taskId: string, result?: string, evidence?: TaskEvidence) => {
        return this.dagCompleteTask(name, r, taskId, result, evidence);
      },
      // ADR-O001 D5: only an org that opted in advertises the evidence
      // argument, so every other org's tool list stays byte-identical.
      requireTaskEvidence:
        def.run_config.completion_evidence === true && role.deliberative !== true,
      // ADR-O001 D6: only an org with an artifact-only reviewer gets org_review,
      // so every other org's tool list stays byte-identical.
      requestReview: def.roles.some((r) => r.review_input === 'artifact-only')
        ? (r: string, taskId: string, reviewer: string, base?: string) =>
            this.dagRequestReview(name, r, taskId, reviewer, base)
        : undefined,
      listTasks: (taskId?: string) => decisionOps.dagListTasks(this, name, taskId),
      splitTask: (r: string, parentId: string, children: { title: string; assignee: string }[]) => {
        return this.dagSplitTask(name, r, parentId, children);
      },
      mergeTask: (r: string, sourceId: string, targetId: string) => {
        return this.dagMergeTask(name, r, sourceId, targetId);
      },
      cancelTask: (r: string, taskId: string, reason?: string) => {
        return this.dagCancelTask(name, r, taskId, reason);
      },
      blockTask: (r: string, taskId: string, untilIso: string, reason?: string, every?: number) => {
        return this.dagBlockTask(name, r, taskId, untilIso, reason, every);
      },
      planGraph: (r: string, specs: decisionOps.PlanTaskSpec[]) => {
        return this.dagPlanGraph(name, r, specs);
      },
      queryFn: this.opts.queryFn,
      // Runner resolution: explicit opts.runner > role `runtime` field >
      // org def `runtime` field > MONOMIND_RUNTIME env (opencode/kimicode) >
      // undefined (session.ts falls back to ClaudeAgentRunner via queryFn).
      // Leaving it undefined for the default path is what keeps
      // Claude/Antigravity orgs byte-for-byte unchanged. Session opts are
      // built per role here, so each role gets its own runner.
      runner:
        this.opts.runner ??
        resolveRoleRunner(role.runtime, def.runtime, role.provider?.kind, undefined, role.provider),
      // Lets respawnRole force-stop THIS specific incarnation (mid-run role
      // replacement's forced-stop step) without reaching into runAgentSession's
      // internals.
      externalAbort: abort,
      silentSessionMs: this.opts.silentSessionMs,
    };
    // Supervised session: transient crashes (provider blips, network) restart
    // with backoff; a crash with the mailbox already closed, or one that
    // exhausts the retry budget, is terminal. runAgentSession already emits a
    // 'status' event for the raw error; the terminal 'audit' event is for
    // dashboards/alerts that filter on actionable failures (not routine
    // status chatter) so a dead agent surfaces instead of a run that
    // silently never progresses.
    const BACKOFFS_MS = this.opts.crashBackoffsMs ?? [1000, 5000, 15000];
    const myGeneration = generation;
    const isStaleGeneration = (): boolean =>
      (running.roleSlots.get(role.id)?.generation ?? 0) !== myGeneration;
    if (!mailbox.isClosed && runtime.status !== 'crashed') {
      runtime.done = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            await runAgentSession(sessionOpts);
            runtime.status = 'ended';
            return;
          } catch (err) {
            // A deliberate respawn (see respawnRole) bumps the slot's
            // generation and force-stops this incarnation via its
            // externalAbort - that abort makes runAgentSession reject here
            // exactly like a real crash would. Recognize supersession
            // FIRST: this generation's retry loop must never restart,
            // never run terminal crash handling, and never notify the
            // boss - the replacement (a new generation, spawned
            // separately) already owns this role id.
            if (isStaleGeneration()) return;
            // Drop the crashed session's stale waker immediately: a push()
            // during the backoff window must queue for the NEXT session, not
            // wake the dead generator to swallow it.
            mailbox.detach();
            // #203: if the crashed session's mailbox generator was abandoned
            // mid-yield (message already shift()ed for it, turn never
            // finished), put that message back on the queue — otherwise the
            // replacement session's stream() finds an empty queue and parks
            // forever, since the "delivered" message is gone for good.
            mailbox.reclaimInFlight();
            const message = err instanceof Error ? err.message : String(err);
            const isTurnLimit = /Reached maximum number of turns|error_max_turns/i.test(message);
            // Bounded like every other recovery: attempt counts every pass
            // through this loop, so a role that keeps surfacing max-turns
            // errors here (session.ts already swallows the normal ones)
            // falls through to crash handling instead of looping forever.
            if (isTurnLimit && !mailbox.isClosed && attempt < BACKOFFS_MS.length) {
              sessionOpts.resumeSessionId = undefined;
              mailbox.push(
                `${Mailbox.CONTINUE_PREFIX} You reached the turn limit on your task. Continue your in-progress work from where you left off; if finished, end your turn.`,
              );
              bus.emit({
                type: 'status',
                from: role.id,
                reason: 'turn-limit-recover',
                msg: `agent "${role.id}" hit turn limit error — continuing with fresh session`,
              });
              continue;
            }
            // Exit 143 = SIGTERM. If the mailbox is already closed, we
            // sent the signal ourselves during stop — not a crash.
            const killedByStop = mailbox.isClosed && /exit(?:ed)? with code 143/.test(message);
            // #251: the org's own stop/complete (finishStop) removes this run
            // from this.orgs, closes every mailbox and aborts every session —
            // an idle one then rejects with the abort ("Operation aborted",
            // "Claude Code process aborted by user"). That is a shutdown, not a
            // crash. A non-abort error surfacing during the stop, or a crash
            // already backing off when the stop landed, stays a crash.
            const abortedByStop =
              mailbox.isClosed &&
              this.orgs.get(name) !== running &&
              ((err as { name?: string } | null)?.name === 'AbortError' ||
                /\baborted\b/i.test(message));
            const crash = (): void => {
              if (killedByStop) {
                runtime.status = 'ended';
                bus.emit({
                  type: 'status',
                  from: role.id,
                  msg: `agent "${role.id}" terminated by stop (was still working when drain window expired)`,
                  reason: 'terminated-by-stop',
                });
                return;
              }
              if (abortedByStop) {
                runtime.status = 'ended';
                // #304: `message` here is always an abort string (see abortedByStop
                // above) — either "Operation aborted" or the SDK's "Claude Code
                // process aborted by user". Echoing it made a planned stop read as
                // a human interruption, and made roles of the same run read
                // differently. Report WHY the org stopped instead; the raw string
                // stays in `data` for debugging.
                const why = running.closedBy === 'org-complete' ? 'org_complete' : 'stop requested';
                bus.emit({
                  type: 'status',
                  from: role.id,
                  msg: `agent "${role.id}" stopped with the org (${why})`,
                  reason: 'agent-stopped',
                  data: { agentId: role.id, error: message },
                });
                return;
              }
              runtime.status = 'crashed';
              runtime.error = message;
              // Close the mailbox so deliver()/receiveRemote() report a real
              // error instead of pushing into a queue no session will read
              // (and returning a false "delivered" receipt to the sender).
              mailbox.close();
              const isContextLimit = OrgDaemon.CONTEXT_LIMIT_RE.test(message);
              bus.emit({
                type: 'audit',
                from: role.id,
                msg: `agent "${role.id}" crashed: ${message}`,
                reason: isContextLimit ? 'agent-context-limit' : 'agent-session-crash',
                data: {
                  agentId: role.id,
                  error: message,
                  restarts: attempt,
                  contextLimit: isContextLimit,
                },
              });
              if (role.id !== running.bossRoleId) {
                // #2/#3: a worker is gone for the rest of this run. Without this
                // notice the coordinator keeps messaging a corpse (observed: four
                // unanswered org_send calls to a developer that had crashed on a
                // context-window limit). Tell the boss to reassign — and if the
                // crash was a context overflow, tell it to chunk smaller, since
                // re-dispatching the same task verbatim fails the same way.
                const bossRt = running.agents.get(running.bossRoleId);
                if (bossRt && !bossRt.mailbox.isClosed) {
                  const guidance = isContextLimit
                    ? ' This was a context-window overflow — re-dispatching the same task verbatim will fail identically. Break the work into smaller pieces (one file or section at a time) and do not paste large file contents in a single message.'
                    : '';
                  bossRt.mailbox.push(
                    `[system] Worker "${role.id}" crashed and will not recover this run (${message}). It can no longer receive messages — stop messaging it. Reassign its outstanding work to another agent or take it on yourself.${guidance}`,
                  );
                  bus.emit({
                    type: 'audit',
                    from: running.bossRoleId,
                    reason: 'worker-crashed',
                    msg: `worker "${role.id}" crashed (contextLimit=${isContextLimit}); coordinator notified to reassign`,
                  });
                }
              } else {
                // #4: the coordinator itself died. Don't go silent and wait for a
                // human — attempt a bounded whole-org restart with fresh sessions
                // (which also sheds whatever bloated context caused the crash).
                this.scheduleBossRestart(name);
              }
            };
            // Fatal errors (provider auth/quota/billing — tagged with
            // err.fatal by the runner) can NEVER be fixed by a restart: the
            // same call fails identically or hangs. Skip the backoff loop
            // and go straight to terminal crash handling instead of burning
            // the retry budget and wall-clock on a guaranteed failure.
            const fatal = (err as { fatal?: boolean } | null)?.fatal === true;
            if (fatal) {
              bus.emit({
                type: 'status',
                from: role.id,
                reason: 'agent-fatal',
                msg: `agent "${role.id}" hit a fatal (non-retryable) error — not restarting`,
              });
              crash();
              return;
            }
            if (mailbox.isClosed || attempt >= BACKOFFS_MS.length) {
              crash();
              return;
            }
            bus.emit({
              type: 'status',
              from: role.id,
              reason: 'agent-restart',
              msg: `agent "${role.id}" crashed (${message}) — restarting in ${BACKOFFS_MS[attempt]}ms (attempt ${attempt + 1}/${BACKOFFS_MS.length})`,
            });
            await new Promise<void>((r) => {
              const t = setTimeout(r, BACKOFFS_MS[attempt]);
              (t as { unref?: () => void }).unref?.();
              // Org stop (finishStop) aborts every active slot's controller —
              // without racing it here, this wait wouldn't notice for up to
              // BACKOFFS_MS[attempt] (default up to 15s), well past finishStop's
              // own bounded drain window. That let this loop's crash() —
              // and the bus.emit() it triggers — fire AFTER finishStop had
              // already declared the org stopped and returned, capable of
              // recreating files in a run directory a caller was already
              // deleting.
              if (abort.signal.aborted) {
                clearTimeout(t);
                r();
                return;
              }
              abort.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(t);
                  r();
                },
                { once: true },
              );
            });
            if (isStaleGeneration()) return; // superseded during the backoff wait
            if (mailbox.isClosed) {
              crash();
              return;
            } // org stopped during backoff — never recovered
            // #247: continue the crashed conversation (briefing, task context,
            // finished work) instead of starting cold. runAgentSession falls
            // back to one fresh session if this id can't be resumed.
            sessionOpts.resumeSessionId = runtime.sessionId;
          }
        }
      })();
    }
    return { runtime, abort };
  }

  /** org_respawn_role's daemon-owned implementation. See the design doc's
   *  "Replacement algorithm" (13 steps) — this method's body follows those
   *  steps in order, numbered in comments. */
  async respawnRole(name: string, callerId: string, rawInput: unknown): Promise<RespawnReceipt> {
    const running = this.orgs.get(name);
    if (!running) {
      return {
        success: false,
        roleId: '',
        generation: 0,
        respawnCount: 0,
        respawnsRemaining: 0,
        error: `org "${name}" is not running`,
      };
    }
    // Step 1: authorize (defense in depth — buildOrgTools only ever wires
    // onRespawnRole for the selected coordinator, but re-check here too).
    if (callerId !== running.bossRoleId) {
      return {
        success: false,
        roleId: '',
        generation: 0,
        respawnCount: 0,
        respawnsRemaining: 0,
        error: 'only the selected coordinator may call org_respawn_role',
      };
    }
    if (this.stopping.has(name)) {
      return {
        success: false,
        roleId: '',
        generation: 0,
        respawnCount: 0,
        respawnsRemaining: 0,
        error: `org "${name}" is stopping`,
      };
    }
    const validated = validateRespawnInput(rawInput);
    if (!validated.ok) {
      return {
        success: false,
        roleId: '',
        generation: 0,
        respawnCount: 0,
        respawnsRemaining: 0,
        error: validated.error,
      };
    }
    const input = validated.value;
    if (input.roleId === running.bossRoleId) {
      return {
        success: false,
        roleId: input.roleId,
        generation: 0,
        respawnCount: 0,
        respawnsRemaining: 0,
        error: 'cannot replace the selected coordinator',
      };
    }
    const slot = running.roleSlots.get(input.roleId);
    if (!slot) {
      return {
        success: false,
        roleId: input.roleId,
        generation: 0,
        respawnCount: 0,
        respawnsRemaining: 0,
        error: `unknown or not-yet-started role "${input.roleId}"`,
      };
    }
    const maxRespawns = running.def.run_config.max_role_respawns ?? 0;
    if (slot.phase === 'removed') {
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `role "${input.roleId}" was removed from this org`,
      });
    }
    // Step 2: acquire the role slot (reject a concurrent replacement).
    if (running.respawning.has(input.roleId) || slot.respawnPromise) {
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `role "${input.roleId}" is already undergoing replacement`,
      });
    }
    if (slot.respawnCount >= maxRespawns) {
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `role "${input.roleId}" has reached its respawn limit (${slot.respawnCount}/${maxRespawns}) for this run`,
      });
    }
    // Step 3: resolve the candidate configuration.
    if (input.providerName !== undefined && slot.effectiveRole.provider) {
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `role "${input.roleId}" has an inline provider, which always takes precedence over adapter_config.provider — replacing an inline provider is a separate design`,
      });
    }
    const candidateRole = mergeEffectiveRoleConfig(slot.effectiveRole, {
      runtime: input.runtime,
      model: input.model,
      providerName: input.providerName,
    });
    const budgetTokens = input.budgetTokens ?? computeReplacementBudget(running.def, input.roleId);

    // Step 4: preflight — must not mutate the old runtime.
    try {
      resolveRoleProvider(candidateRole, this.root);
    } catch (err) {
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `preflight failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    // resolveRoleRunner's undefined return is the valid Claude default, not
    // an error — nothing further to validate for the runtime dimension here.
    resolveRoleRunner(
      candidateRole.runtime,
      running.def.runtime,
      candidateRole.provider?.kind,
      undefined,
      candidateRole.provider,
    );

    // Step 5: consume one attempt — only after validation/preflight succeed.
    running.respawning.add(input.roleId);
    slot.respawnCount++;
    running.bus.emit({
      type: 'audit',
      from: callerId,
      reason: 'role-respawn-started',
      msg: `replacing role "${input.roleId}": ${input.reason}`,
      data: {
        roleId: input.roleId,
        from: redactRoleConfig(slot.effectiveRole),
        to: redactRoleConfig(candidateRole),
        generation: slot.generation,
        caller: callerId,
      },
    });

    // Step 6: quiesce the old incarnation. Bump the generation NOW, before
    // draining starts — not at the final publish (step 11-13) — so the OLD
    // generation's crash-retry loop (spawnRoleIncarnation's isStaleGeneration
    // check) recognizes supersession immediately. Without this, a backoff
    // timer firing during the drain/force-stop window, or the forced abort's
    // own rejection, would still see itself as the current generation:
    // the abort's rejection doesn't match killedByStop's SIGTERM-only regex,
    // so it would run full terminal crash handling — a duplicate live runner
    // (mid-backoff restart) or a false worker-crashed notification, exactly
    // what the guard exists to prevent.
    const newGeneration = slot.generation + 1;
    slot.generation = newGeneration;
    slot.phase = 'draining';
    // Every await from here on can race a stop/restart of this org — verify
    // ownership before EVERY subsequent step, not just once before the final
    // publish, so a stale operation can never mutate accounting, force-stop
    // a runtime, or spawn into an org that's no longer the live one.
    const stillOwned = (): boolean =>
      this.orgs.get(name) === running && running.roleSlots.get(input.roleId) === slot;
    const abandonedReceipt = (): RespawnReceipt => {
      running.respawning.delete(input.roleId);
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `org "${name}" stopped or restarted during replacement`,
      });
    };
    const oldRuntime = slot.runtime!;
    const sweptQueue = oldRuntime.mailbox.beginDrain();
    slot.queuedDuringSwap.push(...sweptQueue);
    const drainTimeoutMs = running.def.run_config.respawn_drain_timeout_ms ?? 30_000;
    const drained = await Promise.race([
      oldRuntime.done.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), drainTimeoutMs)),
    ]);
    if (!stillOwned()) return abandonedReceipt();
    let drainTimedOut = false;
    if (!drained) {
      drainTimedOut = true;
      // Step 7: force stop.
      slot.abort?.abort();
      const forceStopMs = running.def.run_config.respawn_force_stop_timeout_ms ?? 5_000;
      const stopped = await Promise.race([
        oldRuntime.done.then(() => true).catch(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), forceStopMs)),
      ]);
      if (!stillOwned()) return abandonedReceipt();
      if (!stopped) {
        slot.phase = 'stuck';
        running.respawning.delete(input.roleId);
        running.bus.emit({
          type: 'audit',
          from: callerId,
          reason: 'role-respawn-failed',
          msg: `role "${input.roleId}" forced stop did not confirm termination — refusing to spawn a replacement`,
        });
        return buildRespawnReceipt(slot, maxRespawns, false, {
          roleId: input.roleId,
          error: `role "${input.roleId}" could not be confirmed stopped; not replaced`,
        });
      }
    }
    // Step 8: preserve durable role state (worktree path, task ownership, and
    // the DAG survive untouched — they live outside AgentRuntime/Mailbox
    // entirely, keyed by role.id, which never changes). Reclaim any message
    // abandoned mid-yield by a forced stop for at-least-once redelivery.
    oldRuntime.mailbox.reclaimInFlight();
    const reclaimedQueue = oldRuntime.mailbox.serialize().queue;
    slot.queuedDuringSwap.push(...reclaimedQueue);
    // Step 9: retire accounting BEFORE replacing the runtime.
    slot.retiredUsage = {
      // Budgeted basis: this total is summed with live policy.budgetedUsage
      // against the org-wide budget_tokens ceiling (ADR-O001 D1), so the two
      // terms must share a basis.
      tokens: slot.retiredUsage.tokens + oldRuntime.policy.budgetedUsage,
      costUsd: slot.retiredUsage.costUsd + oldRuntime.metrics.costUsd,
    };

    // Step 10: spawn generation N+1 (generation already bumped in step 6).
    const { runtime: newRuntime, abort: newAbort } = this.spawnRoleIncarnation(
      name,
      running,
      candidateRole,
      newGeneration,
      { budgetTokensOverride: budgetTokens },
    );
    // Seed the new mailbox with everything swapped/reclaimed, delivered
    // FIFO, plus a delimited coordinator briefing appended last so it reads
    // as the newest context once the replacement starts its first turn.
    for (const queued of slot.queuedDuringSwap) newRuntime.mailbox.push(queued);
    newRuntime.mailbox.push(
      `[system: role replacement briefing — not a system prompt] You are a fresh session replacing the previous incarnation of role "${input.roleId}". Reason: ${input.reason}\n\n${input.briefing}`,
    );
    // Seed USD accounting from retained totals so a respawn cannot reset
    // role.budget_usd.
    if (running.def.roles.find((r) => r.id === input.roleId)?.budget_usd !== undefined) {
      newRuntime.policy.setUsageUsd(slot.retiredUsage.costUsd);
    }
    // "Ready" here means "did not crash within the startup window" — a
    // silent-but-healthy runner (one that never emits a chat/tool/usage
    // event, e.g. because it hasn't finished its first turn yet) must not be
    // misreported as a startup failure, so this does NOT wait for a positive
    // signal. It races the new incarnation's own crash-retry loop (which
    // shares this generation, so it is NOT superseded and behaves normally)
    // against the timeout: a config that fails immediately (bad model,
    // missing runtime binary, auth failure) crashes fast and newRuntime.done
    // resolves with status 'crashed' well before startTimeoutMs, correctly
    // failing readiness and triggering rollback.
    const startTimeoutMs = running.def.run_config.respawn_start_timeout_ms ?? 60_000;
    const ready = await Promise.race([
      newRuntime.done.then(() => newRuntime.status !== 'crashed'),
      new Promise<boolean>((r) => setTimeout(() => r(true), startTimeoutMs)),
    ]);

    // Step 11: publish atomically — verify ownership is still current.
    if (!stillOwned()) {
      newAbort.abort();
      return abandonedReceipt();
    }
    if (!ready) {
      // Step 12: rollback — one attempt with the prior effective config.
      newAbort.abort();
      running.bus.emit({
        type: 'audit',
        from: callerId,
        reason: 'role-respawn-failed',
        msg: `role "${input.roleId}" replacement did not become ready within ${startTimeoutMs}ms — attempting rollback`,
      });
      try {
        const { runtime: rolledBack, abort: rolledBackAbort } = this.spawnRoleIncarnation(
          name,
          running,
          slot.effectiveRole,
          newGeneration + 1,
          {},
        );
        for (const queued of slot.queuedDuringSwap) rolledBack.mailbox.push(queued);
        running.agents.set(input.roleId, rolledBack);
        slot.runtime = rolledBack;
        slot.abort = rolledBackAbort;
        slot.generation = newGeneration + 1;
        slot.phase = 'running';
        slot.queuedDuringSwap = [];
        running.respawning.delete(input.roleId);
        running.bus.emit({
          type: 'audit',
          from: callerId,
          reason: 'role-respawn-failed',
          msg: `role "${input.roleId}" replacement failed; rolled back to prior config`,
        });
        return buildRespawnReceipt(slot, maxRespawns, false, {
          roleId: input.roleId,
          drainTimedOut,
          error: `replacement failed to start; rolled back to prior configuration`,
        });
      } catch (rollbackErr) {
        slot.phase = 'crashed';
        running.respawning.delete(input.roleId);
        running.bus.emit({
          type: 'audit',
          from: callerId,
          reason: 'role-respawn-rollback-failed',
          msg: `role "${input.roleId}" replacement AND rollback both failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        });
        return buildRespawnReceipt(slot, maxRespawns, false, {
          roleId: input.roleId,
          drainTimedOut,
          error: `replacement and rollback both failed; role "${input.roleId}" is unavailable`,
        });
      }
    }

    running.agents.set(input.roleId, newRuntime);
    slot.runtime = newRuntime;
    slot.abort = newAbort;
    slot.generation = newGeneration;
    slot.effectiveRole = candidateRole;
    slot.phase = 'running';
    slot.queuedDuringSwap = [];
    running.respawning.delete(input.roleId);

    // Step 13: audit and persist.
    running.bus.emit({
      type: 'audit',
      from: callerId,
      reason: 'role-respawned',
      msg: `role "${input.roleId}" replaced (generation ${newGeneration})`,
      data: {
        roleId: input.roleId,
        generation: newGeneration,
        respawnCount: slot.respawnCount,
        drainTimedOut,
      },
    });
    this.persistState(name, 'running', running.run);
    return buildRespawnReceipt(slot, maxRespawns, true, { roleId: input.roleId, drainTimedOut });
  }

  /** @internal */
  hasOrgDef(name: string): boolean {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) return false;
    return existsSync(join(this.root, ORG_DIR, `${name}.json`));
  }

  /** @param opts.drainMs how long to let in-flight agent sessions finish before
   *  reaping. Defaults to the short abort bound; the planned-completion path
   *  passes a far longer window (see COMPLETE_DRAIN_MS).
   *  @param opts.closedBy #206: tags WHY the run ended, persisted into
   *  runtime.json so `org run` can tell a clean, goal-driven end
   *  (closedBy: 'org-complete') from every other kind of stop (idle
   *  watchdog, boss-restart-exhausted, manual `org stop`) and exit non-zero
   *  for the latter. Only the org_complete auto-stop path passes this. */
  async stopOrg(name: string, opts?: { drainMs?: number; closedBy?: string }): Promise<void> {
    // Join an in-flight stop instead of no-oping: the self-stop paths
    // (org_complete, idle watchdog) run detached, and a caller like
    // `org run`'s final stopAll() must not resolve — letting the process
    // exit — while that stop is still flushing the bus and writing
    // history/runtime.json.
    const inflight = this.stopping.get(name);
    if (inflight) return inflight;
    const org = this.orgs.get(name);
    if (!org) return; // already stopped
    org.pendingRoles?.clear(); // prevent lazy spawns after stop
    this.spawning.delete(name); // clean up spawning tracking for this org
    // #304: set before the delete below, since that delete is what makes
    // abortedByStop (role loop) true — the role loop reads it off this same
    // object reference, not a fresh lookup (the org is gone from the map by then).
    org.closedBy = opts?.closedBy;
    // Remove immediately (not at the end) so a concurrent stopOrg(name) call —
    // e.g. stopAll() racing a scheduler-triggered stop on SIGINT — joins this
    // shutdown via `stopping` instead of re-running the whole sequence and
    // double-emitting 'org stopped' (duplicate org:complete/session:complete).
    this.orgs.delete(name);
    const p = this.finishStop(name, org, opts?.drainMs, opts?.closedBy);
    this.stopping.set(name, p);
    try {
      await p;
    } finally {
      this.stopping.delete(name);
    }
  }

  private async finishStop(
    name: string,
    org: RunningOrg,
    drainMs?: number,
    closedBy?: string,
  ): Promise<void> {
    // Process- and daemon-level handles come off FIRST, before anything that
    // can throw. These used to be removed after captureCheckpoint(), so a
    // throw there — which a half-started org can provoke, since it may be
    // missing state a checkpoint expects — aborted the whole stop and left a
    // process 'exit' listener, an interval and a broker lease behind for a run
    // that no longer exists. startOrg()'s teardown-on-failure path swallows a
    // rejecting stopOrg (it has its own error to report), so the leak was
    // silent.
    const cleanup = (org as RunningOrg & { _crashCleanup?: () => void })._crashCleanup;
    if (cleanup) process.removeListener('exit', cleanup);
    const wd = this.watchdogs.get(name);
    if (wd) {
      clearInterval(wd);
      this.watchdogs.delete(name);
    }
    clearIdleRecord(this.root, name);
    // The run's gates are authoritative; put them back over whatever the file
    // holds now (a role may have rewritten it).
    if (org.gates) {
      try {
        decisionOps.writeGates(this.root, name, org.gates);
      } catch {
        /* the next start reads the last write-through */
      }
    }
    this.leases.get(name)?.stop();
    this.leases.delete(name);
    // Capture THIS run's forwarder now: an autoWake-restart of the same org
    // during the long tail below (agent wait, flush, history write) would
    // register a NEW forwarder under the same name — settling/unsubscribing
    // that one would sever the new run's dashboard stream.
    const forwarder = this.forwarders.get(name);
    // Snapshot checkpoint BEFORE closing mailboxes / draining sessions — the
    // queue is emptied during the drain, so capturing afterwards loses all
    // unconsumed messages (the whole point of checkpoint-resume). Best-effort:
    // a run that cannot be checkpointed must still be stopped and cleaned up.
    let stopCheckpoint: ReturnType<typeof captureCheckpoint> | undefined;
    try {
      stopCheckpoint = captureCheckpoint(org, 'stopped');
    } catch (err) {
      console.error(
        `org ${name}: could not capture the stop checkpoint:`,
        err instanceof Error ? err.message : err,
      );
    }
    // #275: drop task dispatches still inside their coalescing window — the
    // mailboxes they target are closed on the next line anyway.
    for (const held of org.pendingDispatch?.values() ?? []) clearTimeout(held.timer);
    org.pendingDispatch?.clear();
    for (const a of org.agents.values()) a.mailbox.close();
    // Closing the mailbox stops new work being handed to a session, but does
    // NOT cancel a turn already in flight (e.g. mid provider call) — that
    // session can keep running, and eventually crash/finish, well past this
    // function's own bounded drain below. Abort each slot's live incarnation
    // too, reusing respawnRole's existing force-stop handle, so in-flight
    // work is told to stop now instead of merely being denied new input.
    for (const slot of org.roleSlots.values()) slot.abort?.abort();
    // M1: kill every tool-provider process of this org's sessions.
    this.toolProviders.closeOrg(name);
    // M2: stop endpoint retry timers (queued entries stay queued).
    stopEndpointRetries(this, name);
    // Bounded: a genuinely hung agent session (stuck mid-tool-call, not just
    // idle) must not make stopOrg() hang forever — callers like the scheduler
    // already race their own timeout around a run, and this wait re-blocking
    // unboundedly on the same never-resolving promises defeated that bound.
    // A planned completion is not an abort. The boss declaring the cycle done
    // says nothing about its siblings: they are routinely mid-build or mid-edit
    // when it fires, and a 15s window SIGTERM'd them (exit 143, reported as
    // "crashed") and threw the work away. allSettled resolves as soon as every
    // session ends, so a long drain is a ceiling, not a delay.
    const stopWaitMs = drainMs ?? this.opts.stopWaitMs ?? 15_000;
    const allDone = Promise.allSettled([...org.agents.values()].map((a) => a.done)).then(
      () => false,
    );
    // Clear the ceiling timer once the sessions win the race: left pending, a
    // COMPLETE_DRAIN_MS stop kept `org run` (which returns without
    // process.exit on a clean completion) alive for up to five minutes after
    // every session had already ended. Deliberately NOT unref'd — on the
    // timed-out path this timer may be the only thing keeping the loop alive
    // long enough to write 'stopped' to runtime.json and flush the bus.
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      allDone,
      new Promise<boolean>((r) => {
        drainTimer = setTimeout(() => r(true), stopWaitMs);
      }),
    ]);
    clearTimeout(drainTimer);
    if (timedOut) {
      // #152: "proceeding anyway" alone didn't say WHO got cut off — a run
      // reviewer had no way to tell whether real, in-progress work (a
      // mid-build, a mid-write) was force-stopped, or the drain window
      // simply outlived a handful of already-idle sessions. status is only
      // 'ended'/'crashed' once a role's session promise has actually
      // settled; still 'running' here means it was mid-turn when the
      // ceiling hit, not merely idle-but-not-yet-reaped.
      const stillActive = [...org.agents.entries()]
        .filter(([, a]) => a.status === 'running')
        .map(([roleId]) => roleId);
      const rosterSuffix = stillActive.length ? ` — still active: ${stillActive.join(', ')}` : '';
      org.bus.emit({
        type: 'audit',
        msg: `org stop timed out after ${stopWaitMs}ms waiting for agent sessions to finish — proceeding anyway${rosterSuffix}`,
        reason: 'stop-timeout',
        data: { stillActive },
      });
      // Reap only SDK processes spawned by THIS node process — ownerPid filter
      // ensures other `monomind org run` daemons' agents are untouched.
      try {
        const reaped = reapOrphanedSdkProcesses(new Set(), process.pid);
        if (reaped > 0)
          org.bus.emit({
            type: 'audit',
            reason: 'orphan-reap',
            msg: `reaped ${reaped} orphaned SDK process(es) after stop timeout`,
          });
      } catch {
        /* best-effort */
      }
    }
    // #302 truth gate: every stop path funnels through here, so this is the
    // one place that can record how the run ACTUALLY ended, regardless of
    // which of the five paths triggered it. `closedBy` is undefined only for
    // a bare manual `stopOrg(name)` (CLI `org stop`, shutdown) — every
    // automated path above now tags its own real cause. reporting.ts reads
    // this event (reason: 'org-stopped') to decide whether the run's outcome
    // may be rendered as a boss-attributed 'partial'/'achieved' at all: only
    // closedBy === 'org-complete' may be.
    const runnableTasks = org.taskDag?.pendingTaskCount() ?? 0;
    // Rendered, not just recorded (#302 AC6, same reasoning as the
    // blockerSuffix above): `org logs` prints `msg` verbatim.
    const stopSuffix =
      closedBy && closedBy !== 'org-complete'
        ? ` (${closedBy}${runnableTasks > 0 ? `, ${runnableTasks} task(s) left` : ''})`
        : '';
    org.bus.emit({
      type: 'status',
      reason: 'org-stopped',
      msg: `org stopped${stopSuffix}`,
      data: { closedBy, runnableTasks },
    });
    await org.bus.flush();
    // Append this run's summary to <org>/history.jsonl — read back from the
    // flushed bus.jsonl (the full durable record) rather than the bounded
    // in-memory buffer, so long runs summarize completely.
    //
    // This block runs BEFORE the seal below (#293): storeRunMemory emits an
    // audit event when the run's memory could not be stored, and a sealed bus
    // fans out to in-memory listeners without ever reaching bus.jsonl — an
    // event the live view shows and the durable record does not, which is both
    // the divergence test-loop's `persisted` check exists to catch and useless
    // to whoever reads the run back later. Sealing after it keeps every emitted
    // event durable. The seal still closes before this function returns, which
    // is what its own contract (below) is about.
    try {
      const events = readRunEvents(this.root, name, org.run);
      if (events.length) {
        const summary = summarizeRun(events);
        const { appendFileSync } = await import('node:fs');
        appendFileSync(historyFile(this.root, name), `${JSON.stringify(summary)}\n`, 'utf8');
        // Cross-run memory: make this run's outcome recallable by meaning.
        // #293: the result is CHECKED — a store that silently did nothing used
        // to be indistinguishable from one that worked, and the symptom
        // (org_recall always empty) showed up runs later with no trail. The
        // reason is stashed for persistState() below so runtime.json — and
        // therefore `org status` — carries it after the bus event and the
        // stderr warning have scrolled away.
        const memory = await this.storeRunMemory(name, org.def, org.run, summary, org.bus);
        if (memory.stored) this.memoryErrors.delete(name);
        else this.memoryErrors.set(name, memory.reason ?? 'unknown');
      }
    } catch (err) {
      console.error(
        `org ${name}: could not write run history:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.recallUsage.delete(name);
      this.orgLearnedRuns.delete(`${name}:${org.run}`);
    }
    // flush() only awaits a snapshot of writes queued at call time (see its
    // own doc comment) — it has no visibility into a session that crashes
    // after the abort signal above but before this function returns. Seal
    // the bus now so any such late bus.emit() still reaches in-memory
    // listeners but can never schedule a new disk write into a run
    // directory a caller (e.g. a test's afterEach) may already be deleting.
    // seal() awaits the pending writes first, so the audit event the block
    // above may have emitted is on disk before the bus closes.
    await org.bus.seal();
    // the "org stopped" event above triggers the forwarder's final org:complete /
    // session:complete POST — without waiting for it here, the CLI process can exit
    // (and kill the in-flight fetch) before that last event reaches the dashboard,
    // leaving the run stuck showing "running" forever. Bounded: a stalled
    // dashboard must not hang org shutdown indefinitely.
    if (forwarder) {
      await Promise.race([
        forwarder.settle(),
        new Promise<void>((r) => {
          const t = setTimeout(r, 5_000);
          (t as { unref?: () => void }).unref?.();
        }),
      ]);
      forwarder.unsubscribe();
      // Only remove from the map if it's still OURS — an autoWake-restart may
      // have registered the new run's forwarder under this name meanwhile.
      if (this.forwarders.get(name) === forwarder) this.forwarders.delete(name);
    }
    // Same guard for runtime.json: if a new run started during shutdown, its
    // 'running' record must not be overwritten with this old run's 'stopped'.
    // Pass the org directly since we already removed it from the map.
    if (!this.orgs.has(name))
      this.persistState(name, 'stopped', org.run, org, stopCheckpoint, closedBy);
    // Clean up git worktrees — shared (workspace: 'worktree') and per-role.
    try {
      const { execFileSync } = await import('node:child_process');
      if (org.worktreePath) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', org.worktreePath], {
            cwd: this.root,
            stdio: 'ignore',
            timeout: 30_000,
          });
        } catch {
          /* best-effort */
        }
      }
      for (const agent of org.agents.values()) {
        if (agent.worktreePath) {
          try {
            execFileSync('git', ['worktree', 'remove', '--force', agent.worktreePath], {
              cwd: this.root,
              stdio: 'ignore',
              timeout: 30_000,
            });
          } catch {
            /* best-effort */
          }
        }
      }
      // #301: roles create their own linked worktrees with Bash (paths the
      // daemon never recorded — org.worktreePath/agent.worktreePath above are
      // only ever set for workspace: 'worktree'/'worktree-per-role', empty
      // for the common workspace: 'repo' shape), and deleting the working
      // directory from inside a role sandbox leaves .git/worktrees/<name>
      // behind — `git worktree list` then hides it, and it never gets
      // cleaned up. Unconditional on purpose: gating this on
      // org/agent.worktreePath would skip exactly the runs that hit the bug.
      // prune only drops metadata whose worktree directory is already gone,
      // so a live worktree — including the owner's — is never touched; it is
      // idempotent; and the two removals just above already run `git
      // worktree remove --force` against this same repo from this same cwd,
      // so this is strictly less invasive than what already ships. Run after
      // both removal loops so a worktree just removed is also pruned.
      //
      // Bounded race, measured rather than assumed (same treatment as the
      // SIGKILL case above): an entry whose `gitdir` file is absent is
      // pruned unconditionally, and `--expire` cannot protect it — measured
      // across every window from `--expire=now` to `--expire=3.months.ago`,
      // a fresh no-gitdir entry is removed regardless, while `--expire` also
      // makes an already-deleted worktree SURVIVE, breaking the "a run
      // always begins clean" guarantee this fix exists to provide. So a
      // concurrent `git worktree add` by another process in this repo is
      // vulnerable for the microseconds between its `mkdir` and its
      // `gitdir` write. A mid-creation state cannot persist longer than
      // that, so an entry found in that state is dead metadata, not a live
      // worktree in progress.
      try {
        execFileSync('git', ['worktree', 'prune'], {
          cwd: this.root,
          stdio: 'ignore',
          timeout: 30_000,
        });
      } catch {
        /* best-effort: not a git repo, git missing, or a wedged hook */
      }
    } catch {
      /* node:child_process unavailable — skip */
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([
      ...[...this.orgs.keys()].map((n) => this.stopOrg(n)),
      ...this.stopping.values(), // detached self-stops still flushing
    ]);
  }

  /** @internal
   *  @param closedBy #206: why the run ended — 'org-complete' for a clean,
   *  goal-driven end (the only value any caller currently passes); absent for
   *  every other stop (idle watchdog, boss-restart-exhausted, manual `org
   *  stop`). Mirrors persistCrashStateAll()'s existing closedBy: 'crash-handler'
   *  for the process-crash path, which org.ts already reads. */
  persistState(
    name: string,
    status: string,
    run: string,
    org?: RunningOrg,
    checkpointOverride?: OrgCheckpoint | null,
    closedBy?: string,
  ): void {
    const p = join(this.root, ORG_DIR, name, 'runtime.json');
    const missing = [...(this.abandoned.get(name) ?? [])];
    const memoryError = this.memoryErrors.get(name);
    const running = org ?? this.orgs.get(name);
    const validStatus = status === 'stopped' || status === 'crashed' ? status : 'running';
    // Pattern 3: Capture full checkpoint state for resume. On stop, finishStop
    // passes a snapshot captured BEFORE mailboxes close and sessions drain —
    // otherwise the queue is always empty by persist time.
    let checkpoint: OrgCheckpoint | null = checkpointOverride ?? null;
    if (!checkpoint && running) {
      // Best-effort, like the snapshot in finishStop: persisting the run's
      // state matters more than the resume checkpoint inside it, and a stop
      // must not fail because a checkpoint could not be built.
      try {
        checkpoint = captureCheckpoint(running, validStatus as 'running' | 'stopped' | 'crashed');
      } catch (err) {
        console.error(
          `org ${name}: could not capture the ${validStatus} checkpoint:`,
          err instanceof Error ? err.message : err,
        );
        checkpoint = null;
      }
    } else if (checkpoint && checkpoint.status !== validStatus) {
      const { checksum: _, ...state } = checkpoint;
      checkpoint = {
        ...state,
        status: validStatus as 'running' | 'stopped' | 'crashed',
        checksum: generateChecksum({
          ...state,
          status: validStatus as 'running' | 'stopped' | 'crashed',
        }),
      };
    }
    // C4: writeJsonFileAtomic (tmp + rename) — a direct writeFileSync here
    // could leave runtime.json truncated on Ctrl-C during `org stop`, which
    // would brick every subsequent `org status` / isOrgRunning / scheduler
    // call. The state files in 6 other daemon paths already use this helper.
    writeJsonFileAtomic(p, {
      status,
      run,
      pid: process.pid,
      updated: new Date().toISOString(),
      ...(missing.length ? { abandonedRoles: missing } : {}),
      ...(memoryError ? { memoryError } : {}),
      ...(checkpoint ? { checkpoint } : {}),
      ...(closedBy ? { closedBy } : {}),
    });
  }

  /** Mark every currently-running org as crashed in runtime.json.
   *  Called from process-level crash handlers — must be synchronous and best-effort.
   *  @param error the uncaught error/rejection reason, if known — without
   *  this, `runOutcomeResult` (org.ts)'s "crashed: <error>" message always
   *  read "crashed: unknown error" regardless of what actually happened. */
  persistCrashStateAll(error?: string): void {
    for (const [name, org] of this.orgs) {
      try {
        const p = join(this.root, ORG_DIR, name, 'runtime.json');
        // Capture separately from the write below: a throw here (e.g. a
        // cyclic structure in roleState reaching generateChecksum) must not
        // suppress the base crash record, which is the actually-important
        // best-effort write this method exists for.
        let checkpoint: ReturnType<typeof captureCheckpoint> | undefined;
        try {
          checkpoint = captureCheckpoint(org, 'crashed');
        } catch {
          /* best effort — proceed without a checkpoint */
        }
        // C4: atomic write — crash handler is the most likely place to hit
        // a partial write since the process is mid-teardown.
        writeJsonFileAtomic(p, {
          status: 'crashed',
          run: org.run,
          pid: process.pid,
          updated: new Date().toISOString(),
          closedBy: 'crash-handler',
          ...(checkpoint ? { checkpoint } : {}),
          ...(error ? { error } : {}),
        });
      } catch {
        /* best effort — filesystem may be unavailable */
      }
    }
  }

  private heartbeatPath(): string {
    return join(this.root, '.monomind', 'serve-heartbeat.json');
  }

  /** Write a heartbeat file so `org status` can distinguish "daemon alive" from
   *  "daemon gone" even when runtime.json still says running. */
  writeHeartbeat(): void {
    try {
      const p = this.heartbeatPath();
      mkdirSync(join(this.root, '.monomind'), { recursive: true });
      // C4: atomic write — heartbeat corruption is how `org status` reports
      // a phantom daemon after a crash.
      writeJsonFileAtomic(p, {
        pid: process.pid,
        updatedAt: new Date().toISOString(),
        running: this.listRunning(),
      });
    } catch {
      /* best effort */
    }
  }

  clearHeartbeat(): void {
    try {
      unlinkSync(this.heartbeatPath());
    } catch {
      /* already gone or never written */
    }
  }

  // ── Delegated methods — extracted to focused modules ──────────────────

  // approvals.ts
  private checkApproval(
    org: string,
    role: string,
    action: string,
    input: Record<string, unknown>,
  ): Promise<boolean | null> {
    return approvalOps.checkApproval(this, org, role, action, input);
  }
  async setApproval(
    org: string,
    role: string,
    action: string,
    approved: boolean,
    opts?: approvalOps.ApprovalResolveOpts,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return approvalOps.setApproval(this, org, role, action, approved, opts);
  }

  // questions.ts
  async askHuman(org: string, role: string, question: string, blocking?: boolean): Promise<string> {
    return questionOps.askHuman(this, org, role, question, blocking);
  }
  async answerQuestion(
    org: string,
    role: string,
    questionId: string,
    answer: string,
    resolvedBy?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return questionOps.answerQuestion(this, org, role, questionId, answer, resolvedBy);
  }

  // decisions.ts
  private readGates(org: string): { gates: DecisionGate[] } {
    return decisionOps.gatesFor(this, org);
  }
  async createGate(org: string, role: string, name: string, description: string): Promise<string> {
    return decisionOps.createGate(this, org, role, name, description);
  }
  async resolveGate(
    org: string,
    gateId: string,
    approved: boolean,
    resolution?: string,
    resolvedBy?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return decisionOps.resolveGate(this, org, gateId, approved, resolution, resolvedBy);
  }
  listGates(org: string, status?: 'pending' | 'approved' | 'rejected'): DecisionGate[] {
    return decisionOps.listGates(this, org, status);
  }
  private dagCreateTask(
    org: string,
    role: string,
    title: string,
    assignee: string,
    deps: string[],
    loadout?: string,
    brief?: string,
    pick?: TaskPick,
  ): string {
    return decisionOps.dagCreateTask(this, org, role, title, assignee, deps, loadout, brief, pick);
  }
  private dagCompleteTask(
    org: string,
    role: string,
    taskId: string,
    result?: string,
    evidence?: TaskEvidence,
  ): string {
    return decisionOps.dagCompleteTask(this, org, role, taskId, result, evidence);
  }
  /** ADR-O001 D6 — see decisions.ts's dagRequestReview. */
  dagRequestReview(
    org: string,
    role: string,
    taskId: string,
    reviewer: string,
    base?: string,
  ): string {
    return decisionOps.dagRequestReview(this, org, role, taskId, reviewer, base);
  }
  private dagSplitTask(
    org: string,
    role: string,
    parentId: string,
    children: { title: string; assignee: string }[],
  ): string {
    return decisionOps.dagSplitTask(this, org, role, parentId, children);
  }
  private dagMergeTask(org: string, role: string, sourceId: string, targetId: string): string {
    return decisionOps.dagMergeTask(this, org, role, sourceId, targetId);
  }
  private dagCancelTask(org: string, role: string, taskId: string, reason?: string): string {
    return decisionOps.dagCancelTask(this, org, role, taskId, reason);
  }
  private dagBlockTask(
    org: string,
    role: string,
    taskId: string,
    untilIso: string,
    reason?: string,
    recheckAfterMinutes?: number,
  ): string {
    return decisionOps.dagBlockTask(this, org, role, taskId, untilIso, reason, recheckAfterMinutes);
  }
  private dagPlanGraph(org: string, role: string, specs: decisionOps.PlanTaskSpec[]): string {
    return decisionOps.dagPlanGraph(this, org, role, specs);
  }
  recordDecision(
    org: string,
    role: string,
    decision: {
      type: 'tool' | 'handoff' | 'approval' | 'routing';
      kind: DecisionKind;
      context: string;
      reasoning: string;
      alternatives?: Array<{ choice: string; score: number; reason: string }>;
      outcome: string;
    },
  ): void {
    decisionOps.recordDecision(this, org, role, decision);
  }

  // cross-org.ts
  async deliver(
    fromOrg: string,
    fromRole: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<string> {
    return crossOrg.deliver(this, fromOrg, fromRole, to, subject, body);
  }
  receiveRemote(
    toOrg: string,
    toRole: string,
    fromQualified: string,
    subject: string,
    body: string,
    fromCredential?: string,
    opts?: crossOrg.ReceiveRemoteOpts,
  ): Promise<{ ok: true; receipt: string } | { ok: false; error: string }> {
    return crossOrg.receiveRemote(
      this,
      toOrg,
      toRole,
      fromQualified,
      subject,
      body,
      fromCredential,
      opts,
    );
  }

  // runtime-options.ts
  listRuntimeOptions(): Promise<RuntimeOptionsReceipt> {
    return buildRuntimeOptions(this.root);
  }

  // scheduler-integration.ts
  /** @internal */
  autoWake(name: string): void {
    scheduler.autoWake(this, name);
  }
  private scheduleBossRestart(name: string): void {
    scheduler.scheduleBossRestart(this, name);
  }
  /** @internal */
  scheduleDeferredSpawn(
    name: string,
    running: RunningOrg,
    role: OrgRole,
    spawnRole: (role: OrgRole) => void,
  ): void {
    scheduler.scheduleDeferredSpawn(this, name, running, role, spawnRole);
  }
  /** Bug 4: mirrors scheduleDeferredSpawn, but for a role deferred because the
   *  org is already at run_config.max_concurrent_agents rather than under host
   *  resource pressure — see scheduleConcurrencyDeferredSpawn's doc comment. */
  /** @internal */
  scheduleConcurrencyDeferredSpawn(
    name: string,
    running: RunningOrg,
    role: OrgRole,
    spawnRole: (role: OrgRole) => void,
  ): void {
    scheduler.scheduleConcurrencyDeferredSpawn(this, name, running, role, spawnRole);
  }

  // org-memory.ts
  private orgMemoryNamespace(name: string, def: OrgDef): string {
    return orgMemory.orgMemoryNamespace(name, def);
  }
  private orgMemoryDbPath(): string {
    return orgMemory.orgMemoryDbPath(this.root);
  }
  private orgMemoryUsable(): Promise<boolean> {
    return orgMemory.orgMemoryUsable(this.root);
  }
  private async rememberOrgMemory(
    name: string,
    def: OrgDef,
    role: string,
    content: string,
    scope: 'org' | 'agent',
    run: string,
  ): Promise<string> {
    return orgMemory.rememberOrgMemory(this.root, name, def, role, content, scope, run);
  }
  private async recallOrgMemory(
    name: string,
    def: OrgDef,
    query: string,
    role?: string,
  ): Promise<{ text: string; hits: number }> {
    return orgMemory.recallOrgMemory(this, name, def, query, role);
  }
  async searchProjectKnowledge(query: string): Promise<{ text: string; hits: number }> {
    return orgMemory.searchProjectKnowledge(this.root, query);
  }
  private async learnOrgKnowledge(
    name: string,
    run: string,
    payload: { nodes?: unknown[]; edges?: unknown[]; rules?: unknown[] },
  ): Promise<string> {
    return orgMemory.learnOrgKnowledge(this, name, run, payload);
  }
  private async storeRunMemory(
    name: string,
    def: OrgDef,
    run: string,
    summary: RunSummary,
    bus?: OrgBus,
  ): Promise<orgMemory.RunMemoryResult> {
    return orgMemory.storeRunMemory(this, name, def, run, summary, bus);
  }

  // checkpoint-ops.ts
  async replayFrom(name: string, run: string): Promise<RunningOrg | null> {
    return checkpointOps.replayFrom(this, name, run);
  }
  async resumeOrg(name: string): Promise<RunningOrg | null> {
    return checkpointOps.resumeOrg(this, name);
  }
}
