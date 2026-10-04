// packages/@monomind/cli/src/orgrt/daemon.ts
// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
// ── Extracted module imports ────────────────────────────────────────────
import { type ApprovalVerdict, awaitApproval } from './approval-decider.js';
import * as approvalOps from './approvals.js';
import type { BrokerLease } from './broker.js';
import type { OrgBus } from './bus.js';
import * as checkpointOps from './checkpoint-ops.js';
import * as crossOrg from './cross-org.js';
import type { DaemonLockHandle } from './daemon-lock.js';
import type { AgentRuntime, DaemonArgs, DaemonOpts, RunningOrg } from './daemon-types.js';
import * as decisionOps from './decisions.js';
import type { attachForwarder } from './forwarder.js';
import * as orgMemory from './org-memory.js';
import * as orgReload from './org-reload.js';
import * as orgStart from './org-start.js';
import * as orgStateFile from './org-state-file.js';
import * as orgStop from './org-stop.js';
import * as questionOps from './questions.js';
import type { RunSummary } from './reporting.js';
import * as roleIncarnation from './role-incarnation.js';
import * as roleRespawn from './role-respawn.js';
import type { RespawnReceipt } from './role-slot.js';
import { currentRoleTrace, type RoleTrace } from './role-trace.js';
import { buildRuntimeOptions, type RuntimeOptionsReceipt } from './runtime-options.js';
import * as scheduler from './scheduler-integration.js';
import { ToolProviderHub } from './tool-providers.js';
import { type BusEvent, type DecisionGate, ORG_DIR, type OrgDef } from './types.js';

export {
  type AgentRuntime,
  activeRoleCount,
  type DaemonOpts,
  type RunningOrg,
  roleTokenBudget,
  ScrollbackBuffer,
} from './daemon-types.js';
export { resolvedIdleNudgeCount } from './idle-watchdog.js';
export { resolveOrgComplete } from './role-session-opts.js';
export {
  type ProviderKind,
  type RuntimeKind,
  resolveRoleRunner,
  resolveRunner,
} from './runner-resolve.js';
export { resolveAutoAssignee } from './task-match.js';

export class OrgDaemon {
  /** @internal */ orgs = new Map<string, RunningOrg>();
  /** @internal GA row R1: the OS-held owner lock of each running sections org. */
  daemonLocks = new Map<string, DaemonLockHandle>();
  /** @internal */ waking = new Set<string>();
  /** @internal */ globalSubscribers = new Set<(e: BusEvent) => void>();
  /** @internal */ leases = new Map<string, BrokerLease>();
  /** @internal */ forwarders = new Map<string, ReturnType<typeof attachForwarder>>();
  /** @internal */ watchdogs = new Map<string, ReturnType<typeof setInterval>>();
  /** @internal */ leadWatches = new Map<string, () => void>();
  /** @internal */ stopping = new Map<string, Promise<void>>();
  /** @internal Bug 2 (TOCTOU race): names currently reserved by an in-flight
   *  startOrg() call, from the synchronous existence check through
   *  registration in `orgs`. Closes the window where two concurrent
   *  startOrg(name) calls could both pass the `orgs.has(name)` check before
   *  either registered and spawn duplicate runs. */
  /** @internal */ startingOrgs = new Set<string>();
  /** @internal */ approvals = new Map<string, approvalOps.ApprovalEntry[]>();
  /** @internal #345: per org, the actions `org run --auto-approve` pre-approved
   *  for the current run (approvals.ts's checkApproval). Kept across a boss
   *  auto-restart, replaced by every other start. */
  runAutoApprove = new Map<string, string[]>();
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
  /** @internal */
  static readonly CONTEXT_LIMIT_RE =
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
    return orgReload.reloadOrgDef(this, name);
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
  /** @internal */
  workspaceSetting(def: OrgDef): string {
    const ws = (def.run_config as { workspace?: string }).workspace ?? 'repo';
    if (ws === 'repo' || ws === 'isolated' || ws === 'worktree' || ws === 'worktree-per-role')
      return ws;
    return isAbsolute(ws) ? ws : join(this.root, ws);
  }

  /** @internal Frees the sections owner lock of `name`, if this daemon holds one. */
  releaseDaemonLock(name: string): void {
    this.daemonLocks.get(name)?.release();
    this.daemonLocks.delete(name);
  }

  async startOrg(...args: DaemonArgs<typeof orgStart.startOrg>): Promise<RunningOrg> {
    return orgStart.startOrg(this, ...args);
  }

  /** Build one role incarnation: mailbox, policy, AgentRuntime, sessionOpts,
   *  and the supervised crash-retry loop. Used by BOTH the startup lazy-spawn
   *  path (generation 0, via the `spawnRole` closure inside startOrgInner)
   *  and respawnRole() (generation N+1). Does not touch running.agents or
   *  running.roleSlots — callers publish the result themselves. */
  spawnRoleIncarnation(...args: DaemonArgs<typeof roleIncarnation.spawnRoleIncarnation>): {
    runtime: AgentRuntime;
    abort: AbortController;
  } {
    return roleIncarnation.spawnRoleIncarnation(this, ...args);
  }

  /** org_respawn_role's daemon-owned implementation. See the design doc's
   *  "Replacement algorithm" (13 steps) — this method's body follows those
   *  steps in order, numbered in comments. */
  async respawnRole(name: string, callerId: string, rawInput: unknown): Promise<RespawnReceipt> {
    return roleRespawn.respawnRole(this, name, callerId, rawInput);
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
    return orgStop.stopOrg(this, name, opts);
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
  persistState(...args: DaemonArgs<typeof orgStateFile.persistState>): void {
    orgStateFile.persistState(this, ...args);
  }

  /** Mark every currently-running org as crashed in runtime.json.
   *  Called from process-level crash handlers — must be synchronous and best-effort.
   *  @param error the uncaught error/rejection reason, if known — without
   *  this, `runOutcomeResult` (org.ts)'s "crashed: <error>" message always
   *  read "crashed: unknown error" regardless of what actually happened. */
  persistCrashStateAll(error?: string): void {
    orgStateFile.persistCrashStateAll(this, error);
  }

  /** Write a heartbeat file so `org status` can distinguish "daemon alive" from
   *  "daemon gone" even when runtime.json still says running. */
  writeHeartbeat(): void {
    orgStateFile.writeHeartbeat(this);
  }

  clearHeartbeat(): void {
    orgStateFile.clearHeartbeat(this);
  }

  // ── Delegated methods — extracted to focused modules ──────────────────

  // approvals.ts
  /** @internal */
  checkApproval(
    org: string,
    role: string,
    action: string,
    input: Record<string, unknown>,
  ): Promise<boolean | null> {
    return approvalOps.checkApproval(this, org, role, action, input);
  }
  /** @internal #553: checkApproval that waits inline when a decider owns it. */
  awaitApproval(
    org: string,
    role: string,
    action: string,
    input: Record<string, unknown>,
  ): Promise<ApprovalVerdict> {
    return awaitApproval(this, org, role, action, input);
  }
  async setApproval(
    ...args: DaemonArgs<typeof approvalOps.setApproval>
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return approvalOps.setApproval(this, ...args);
  }

  // questions.ts
  async askHuman(org: string, role: string, question: string, blocking?: boolean): Promise<string> {
    return questionOps.askHuman(this, org, role, question, blocking);
  }
  async answerQuestion(
    ...args: DaemonArgs<typeof questionOps.answerQuestion>
  ): ReturnType<typeof questionOps.answerQuestion> {
    return questionOps.answerQuestion(this, ...args);
  }
  async dismissQuestion(
    ...args: DaemonArgs<typeof questionOps.dismissQuestion>
  ): ReturnType<typeof questionOps.dismissQuestion> {
    return questionOps.dismissQuestion(this, ...args);
  }

  // decisions.ts
  /** @internal */
  readGates(org: string): { gates: DecisionGate[] } {
    return decisionOps.gatesFor(this, org);
  }
  async createGate(org: string, role: string, name: string, description: string): Promise<string> {
    return decisionOps.createGate(this, org, role, name, description);
  }
  async resolveGate(
    ...args: DaemonArgs<typeof decisionOps.resolveGate>
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return decisionOps.resolveGate(this, ...args);
  }
  listGates(org: string, status?: 'pending' | 'approved' | 'rejected'): DecisionGate[] {
    return decisionOps.listGates(this, org, status);
  }
  /** @internal */
  dagCreateTask(...args: DaemonArgs<typeof decisionOps.dagCreateTask>): string {
    return decisionOps.dagCreateTask(this, ...args);
  }
  /** @internal */
  dagCompleteTask(...args: DaemonArgs<typeof decisionOps.dagCompleteTask>): string {
    return decisionOps.dagCompleteTask(this, ...args);
  }
  /** ADR-O001 D6 — see decisions.ts's dagRequestReview. */
  dagRequestReview(...args: DaemonArgs<typeof decisionOps.dagRequestReview>): string {
    return decisionOps.dagRequestReview(this, ...args);
  }
  /** @internal */
  dagSplitTask(...args: DaemonArgs<typeof decisionOps.dagSplitTask>): string {
    return decisionOps.dagSplitTask(this, ...args);
  }
  /** @internal */
  dagMergeTask(org: string, role: string, sourceId: string, targetId: string): string {
    return decisionOps.dagMergeTask(this, org, role, sourceId, targetId);
  }
  /** @internal */
  dagCancelTask(org: string, role: string, taskId: string, reason?: string): string {
    return decisionOps.dagCancelTask(this, org, role, taskId, reason);
  }
  /** @internal */
  dagBlockTask(...args: DaemonArgs<typeof decisionOps.dagBlockTask>): string {
    return decisionOps.dagBlockTask(this, ...args);
  }
  /** @internal */
  dagPlanGraph(org: string, role: string, specs: decisionOps.PlanTaskSpec[]): string {
    return decisionOps.dagPlanGraph(this, org, role, specs);
  }
  recordDecision(...args: DaemonArgs<typeof decisionOps.recordDecision>): void {
    decisionOps.recordDecision(this, ...args);
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
    ...args: DaemonArgs<typeof crossOrg.receiveRemote>
  ): Promise<{ ok: true; receipt: string } | { ok: false; error: string }> {
    return crossOrg.receiveRemote(this, ...args);
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
  /** @internal */
  scheduleBossRestart(name: string): void {
    scheduler.scheduleBossRestart(this, name);
  }
  /** @internal */
  scheduleDeferredSpawn(...args: DaemonArgs<typeof scheduler.scheduleDeferredSpawn>): void {
    scheduler.scheduleDeferredSpawn(this, ...args);
  }
  /** Bug 4: mirrors scheduleDeferredSpawn, but for a role deferred because the
   *  org is already at run_config.max_concurrent_agents rather than under host
   *  resource pressure — see scheduleConcurrencyDeferredSpawn's doc comment. */
  /** @internal */
  scheduleConcurrencyDeferredSpawn(
    ...args: DaemonArgs<typeof scheduler.scheduleConcurrencyDeferredSpawn>
  ): void {
    scheduler.scheduleConcurrencyDeferredSpawn(this, ...args);
  }

  // org-memory.ts
  private orgMemoryNamespace(name: string, def: OrgDef): string {
    return orgMemory.orgMemoryNamespace(name, def);
  }
  /** @internal */
  orgMemoryDbPath(): string {
    return orgMemory.orgMemoryDbPath(this.root);
  }
  /** @internal */
  orgMemoryUsable(): Promise<boolean> {
    return orgMemory.orgMemoryUsable(this.root);
  }
  /** @internal */
  async rememberOrgMemory(
    name: string,
    def: OrgDef,
    role: string,
    content: string,
    scope: 'org' | 'agent',
    run: string,
  ): Promise<string> {
    return orgMemory.rememberOrgMemory(this.root, name, def, role, content, scope, run);
  }
  /** @internal */
  async recallOrgMemory(
    ...args: DaemonArgs<typeof orgMemory.recallOrgMemory>
  ): Promise<{ text: string; hits: number }> {
    return orgMemory.recallOrgMemory(this, ...args);
  }
  async searchProjectKnowledge(query: string): Promise<{ text: string; hits: number }> {
    return orgMemory.searchProjectKnowledge(this.root, query);
  }
  /** @internal */
  async learnOrgKnowledge(
    ...args: DaemonArgs<typeof orgMemory.learnOrgKnowledge>
  ): Promise<string> {
    return orgMemory.learnOrgKnowledge(this, ...args);
  }
  /** @internal */
  async storeRunMemory(
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
