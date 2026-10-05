// packages/@monomind/cli/src/orgrt/daemon-types.ts
// Extracted from daemon.ts — the daemon's runtime state shapes (RunningOrg,
// AgentRuntime, DaemonOpts) and the small helpers that read them.
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './agent-runner.js';
import type { OrgBus } from './bus.js';
import type { RoleCheckpoint } from './checkpoint.js';
import type { DocumentsRuntime } from './documents/runtime.js';
import type { SectionBudgetState } from './documents/section-budget-run.js';
import { agentRoles, type EndpointWait } from './endpoint-roles.js';
import type { RoleFence } from './fence.js';
import type { Mailbox } from './mailbox.js';
import type { PolicyEngine } from './policy.js';
import type { RoleSlot } from './role-slot.js';
import type { SessionLedger } from './session-ledger.js';
import type { TaskProcesses } from './task-cancel.js';
import type { TaskDag } from './task-dag.js';
import type { ChainTrace } from './tool-providers.js';
import type { BusEvent, DecisionGate, OrgDef, OrgRole } from './types.js';
import type { WriteLedger } from './write-ledger.js';

/** The parameters of an extracted `fn(daemon, ...rest)` helper after its
 *  daemon argument — lets OrgDaemon's forwarding methods mirror the helper's
 *  signature (parameter names, optionality, types) without restating it. */
export type DaemonArgs<F> = F extends (daemon: never, ...rest: infer R) => unknown ? R : never;

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
  /** costUsd: null until a usage event reports a cost (unknown, rev 28). */
  metrics: { tokens: number; costUsd: number | null };
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
  /** The task text this run was started with (`org run --task`), when one was given. */
  runTask?: string;
  run: string;
  /** When the run ORIGINALLY started (ms, from its id, so a resume keeps it); with run_config.deadline_seconds it
   *  fixes the deadline. Always set by the start paths; absent only in test fixtures, where no deadline applies. */
  startedAtMs?: number;
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
  /** #551: roles taken out of pendingRoles whose lazy spawn waits — for a
   *  run_config.max_concurrent_agents slot or for host resources
   *  (scheduler-integration.ts, one retry loop per role). Still a known
   *  assignee: its tasks wait here instead of reading as unresolved, and
   *  messages to it are queued. `noted` holds the task ids already audited as
   *  waiting. */
  deferredSpawns?: Map<
    string,
    { role: OrgRole; gate: 'concurrency' | 'resources'; noted: Set<string> }
  >;
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
  /** #343: budgets the coordinator was warned about nearing, once per run:
   *  `<role>:budget_usd`, `<role>:budget_tokens`, `run_config.budget_tokens`. */
  budgetWarned?: Set<string>;
  /** #343: set while the org-wide run_config.budget_tokens ceiling is spent —
   *  the roles it closed. A reload that raises the ceiling past the run's
   *  spend reopens them and clears this, re-arming the ceiling (budget-closure.ts). */
  orgBudgetClosed?: Set<string>;
  /** #343: pendingRoles set aside when the org-wide ceiling closed the org,
   *  put back when a reload reopens it. */
  orgBudgetPendingRoles?: Map<string, OrgRole>;
  /** #304: why this run is stopping, set by stopOrg before the org is removed from
   *  `this.orgs`. Read by the role loop so a planned stop is logged with one stable
   *  wording instead of whichever abort string the SDK produced. */
  closedBy?: string;
  /** Failed Write/Edit calls per role, for completion gating (write-ledger.ts). */
  writeLedger?: WriteLedger;
  /** Org sections (plan P3.6): this run's documents runtime. Absent unless the org is on the sections surface. */
  documents?: DocumentsRuntime;
  /** Org sections (plan P4.6): the section budget notices and the scopes soft-closed at their USD allocation.
   *  Absent unless the run has a documents runtime. */
  sectionBudget?: SectionBudgetState;
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
  /** Override how often a max_concurrent_agents-deferred spawn re-checks for a
   *  free slot, and how many checks before it gives up (tests only; default
   *  5000ms × 180). */
  concurrencyDeferPollMs?: number;
  concurrencyDeferMaxAttempts?: number;
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
