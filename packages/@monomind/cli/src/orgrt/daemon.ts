// packages/@monomind/cli/src/orgrt/daemon.ts
// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real
import { readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { reapOrphanedSdkProcesses } from '../utils/resource-governor.js';
import { OrgBus } from './bus.js';
import { PolicyEngine } from './policy.js';
import { Mailbox } from './mailbox.js';
import { runAgentSession } from './session.js';
import { attachForwarder } from './forwarder.js';
import { BrokerLease, normalizeCredential } from './broker.js';
import { drainInbox } from './inbox.js';
import {
  OrgDefSchema,
  type OrgDef,
  type OrgRole,
  type BusEvent,
  type DecisionGate,
  type ProviderConfig,
  ORG_DIR,
} from './types.js';
import { TaskDag } from './task-dag.js';
import {
  summarizeRun,
  readRunEvents,
  readHistory,
  historyFile,
  type RunSummary,
} from './reporting.js';
import { getResourceLimits, configureResourceLimits } from '../utils/resource-governor.js';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './agent-runner.js';
import { OpencodeAgentRunner } from './opencode-runner.js';
import { KimiCodeAgentRunner } from './kimicode-runner.js';
import { VercelAgentRunner } from './vercel-runner.js';
import { CodexAgentRunner } from './codex-runner.js';
import { AntigravityAgentRunner } from './antigravity-runner.js';
import { GrokAgentRunner } from './grok-runner.js';
import { QwenAgentRunner } from './qwen-runner.js';
import { CrushAgentRunner } from './crush-runner.js';
import { CopilotAgentRunner } from './copilot-runner.js';
import { PiAgentRunner } from './pi-runner.js';
import { PiRpcAgentRunner } from './pi-rpc-runner.js';
import { QwenRpcAgentRunner } from './qwen-rpc-runner.js';
import {
  captureCheckpoint,
  generateChecksum,
  validateCheckpoint,
  isCheckpointExpired,
  restoreMailboxQueue,
  type OrgCheckpoint,
  type RoleCheckpoint,
} from './checkpoint.js';
import {
  loadGlobalFenceConfig,
  mergeFenceConfigs,
  createFenceForRole,
  type RoleFence,
} from './fence.js';

// ── Extracted module imports ────────────────────────────────────────────
import * as approvalOps from './approvals.js';
import * as questionOps from './questions.js';
import * as decisionOps from './decisions.js';
import * as crossOrg from './cross-org.js';
import * as scheduler from './scheduler-integration.js';
import * as orgMemory from './org-memory.js';
import * as checkpointOps from './checkpoint-ops.js';

/** OpenTelemetry tracing helper - creates spans for major operations */
class OtelTracer {
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
      const duration = Date.now() - span.start;
      // Emit span as a bus event for export
      this.spans.delete(name);
    }
  }

  recordEvent(name: string, attributes: Record<string, unknown>): void {
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
  | 'claude' | 'kimicode' | 'opencode' | 'vercel' | 'codex' | 'antigravity'
  | 'grok' | 'qwen' | 'crush' | 'copilot' | 'pi'
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
  | 'qwen-rpc';
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

/** Per-role token budget: a role's own `budget_tokens` wins; otherwise the
 *  even split of run_config.budget_tokens across all roles. */
export function roleTokenBudget(role: OrgRole, def: OrgDef): number {
  return (
    role.budget_tokens ?? Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length)
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
export function resolvedIdleNudgeCount(nudgedAt: number, nudges: number, lastToolActivity: number): number {
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
}

export interface RunningOrg {
  def: OrgDef;
  run: string;
  bus: OrgBus;
  agents: Map<string, AgentRuntime>;
  busEvents: () => BusEvent[];
  /** Roles not yet spawned — spawned lazily on first message. */
  pendingRoles?: Map<string, OrgRole>;
  /** Spawn a pending role on demand. */
  spawnRole?: (role: OrgRole) => void;
  /** Git worktree path if workspace: 'worktree' — cleaned up on stop. */
  worktreePath?: string;
  /** Task DAG for structured work ordering. */
  taskDag?: TaskDag;
  /** Directory role sessions run in — oversized mail digests are written here. */
  workdir?: string;
  /** MonoFence guardrail instances keyed by role ID. */
  fences?: Map<string, RoleFence>;
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
  /** Auth credential for the org server (passed to broker so cross-process senders can authenticate). */
  inboxCredential?: string;
  /** Filter tool audit events by tool name or decision (allow|deny) before forwarding */
  auditFilter?: { tool?: string; decision?: 'allow' | 'deny' };
}

export class OrgDaemon {
  /** @internal */ orgs = new Map<string, RunningOrg>();
  /** @internal */ waking = new Set<string>();
  /** @internal */ globalSubscribers = new Set<(e: BusEvent) => void>();
  /** @internal */ private leases = new Map<string, BrokerLease>();
  /** @internal */ private forwarders = new Map<string, ReturnType<typeof attachForwarder>>();
  /** @internal */ private watchdogs = new Map<string, ReturnType<typeof setInterval>>();
  /** @internal */ stopping = new Map<string, Promise<void>>();
  /** @internal */ private otel = new OtelTracer();
  /** @internal */ approvals = new Map<
    string,
    Array<{
      roleId: string;
      action: string;
      question: string;
      ts: number;
      approved: boolean | null;
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

  constructor(
    /** @internal */ public root: string,
    /** @internal */ public opts: DaemonOpts = {},
  ) {}

  /** Publish this daemon's inbox so orgs started AFTER this call register with the broker. */
  setInboxUrl(url: string, credential?: string): void {
    this.opts.inboxUrl = url;
    if (credential !== undefined) this.opts.inboxCredential = credential;
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
    const newDef = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
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

    const existingRoleIds = new Set(running.def.roles.map((r) => r.id));
    const newRoleIds = new Set(newDef.roles.map((r) => r.id));
    for (const role of newDef.roles) {
      if (!existingRoleIds.has(role.id)) {
        running.def.roles.push(role);
        if (!running.pendingRoles) running.pendingRoles = new Map();
        running.pendingRoles.set(role.id, role);
        newRoles.push(role.id);
      }
    }
    for (const id of existingRoleIds) {
      if (!newRoleIds.has(id)) removedRoles.push(id);
    }

    running.bus.emit({
      type: 'audit',
      reason: 'hot-reload',
      msg: `org def reloaded: ${changed.length} fields changed, ${newRoles.length} new roles, ${removedRoles.length} removed roles`,
      data: { changed, newRoles, removedRoles },
    });

    return { changed, newRoles, removedRoles };
  }
  /** Names of the orgs this daemon currently has running. Snapshot — safe to
   *  iterate while stopOrg() mutates the underlying map. */
  listRunning(): string[] {
    return [...this.orgs.keys()];
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

  async startOrg(name: string, taskOverride?: string, options?: { resume?: boolean }): Promise<RunningOrg> {
    // A restart-driven start (scheduleBossRestart) keeps its crash counter so the
    // cap holds; any other (explicit) start resets it so a manual re-run gets a
    // fresh budget.
    if (!this.restarting.has(name)) this.bossRestartCounts.delete(name);
    // Join any in-flight stop for this org before checking `this.orgs` — otherwise a
    // start racing a stop's drain window (up to stopWaitMs) can share the stopping
    // run's worktree path while it's still being force-removed.
    const inflightStop = this.stopping.get(name);
    if (inflightStop) await inflightStop;
    if (this.orgs.has(name)) throw new Error(`org ${name} already running`);
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));

    let run: string;
    let checkpoint: OrgCheckpoint | undefined;
    if (options?.resume) {
      const rtPath = join(this.root, ORG_DIR, name, 'runtime.json');
      if (!existsSync(rtPath)) throw new Error(`cannot resume org "${name}": runtime.json not found`);
      const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
      if (!rt?.run || !rt?.checkpoint) throw new Error(`cannot resume org "${name}": no valid checkpoint found`);
      if (isCheckpointExpired(rt.checkpoint)) throw new Error(`cannot resume org "${name}": checkpoint expired`);
      if (!validateCheckpoint(rt.checkpoint)) throw new Error(`cannot resume org "${name}": checkpoint validation failed`);
      run = rt.run;
      checkpoint = rt.checkpoint;
      if (rt.abandonedRoles) {
        this.abandoned.set(name, new Set(rt.abandonedRoles));
      }
    } else {
      this.abandoned.delete(name); // a previous run's missing roles say nothing about this one
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
    if (
      !process.env.MONOMIND_MAX_SDK_PROCS &&
      getResourceLimits().maxSdkProcesses < def.roles.length
    ) {
      configureResourceLimits({ maxSdkProcesses: def.roles.length });
    }

    // Validate per-role providers before spawning anything (fail-fast: a
    // missing env var discovered 10 minutes into a run wastes the entire run).
    const { resolveProviderEnv: validateProvider, resolveRoleProvider } = await import('./provider.js');
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
    bus.subscribe((e) => {
      const slim: BusEvent =
        e.data?.content != null ? { ...e, data: { ...e.data, content: undefined } } : e;
      collected.push(slim);
      if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
      // The watchdog's own nudge event must not count as org activity, or a
      // hung boss would never trip the "nudge produced no activity" stop.
      if (e.reason !== 'idle-nudge') lastActivity = Date.now();
      if (e.type === 'tool') lastToolActivity = Date.now();
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
          this.stopOrg(name, { drainMs: COMPLETE_DRAIN_MS, closedBy: 'org-complete' }).catch((err) =>
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
      bus,
      agents: new Map(),
      busEvents: () => [...collected],
      workdir: cwd,
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
    const perRoleBudget = Math.floor(
      (def.run_config.budget_tokens ?? 1_000_000) / def.roles.length,
    );
    // Single boss-selection rule for kickoff AND org_complete gating — the
    // session layer previously keyed the tool on reports_to===null while the
    // kickoff went to (type==='boss' || reports_to===null || roles[0]), so a
    // fallback-selected boss could be told to call org_complete without having
    // the tool.
    const bossRole =
      def.roles.find((r) => r.type === 'boss' || r.reports_to === null) ?? def.roles[0];
    // Canonical entity names from the org KG — injected into the coordinator
    // prompt so org_learn extractions reuse them instead of minting duplicates.
    const glossary = await (async () => {
      try {
        if (!(await this.orgMemoryUsable())) return [];
        const kg = await import('../memory/memory-kg.js');
        return await kg.kgGlossary({ dbPath: this.orgMemoryDbPath() });
      } catch {
        return [];
      }
    })();
    // Resource-gated staggered spawn: check memory/process limits before each
    // NON-BOSS agent, wait if under pressure. The boss always spawns immediately
    // and ungated — the org has no coordinator at all without it, so gating it
    // behind host memory pressure would make the whole org fail to start over a
    // condition workers are specifically designed to ride out.
    const limits = getResourceLimits();

    // Extracted so a role that fails its gate check can be spawned later by
    // scheduleDeferredSpawn() once resources free up, without re-running the
    // gate logic or duplicating the session-wiring below.
    const spawnRole = (role: OrgRole, roleCheckpoint?: RoleCheckpoint): void => {
      if (running.agents.has(role.id)) return;
      let roleCwd = cwd;
      if (ws === 'worktree-per-role' && role.id !== bossRole.id) {
        const wtPath = join(this.root, ORG_DIR, name, `worktree-${role.id}`);
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
      const mailbox = new Mailbox();
      if (roleCheckpoint?.mailboxQueue?.length) {
        restoreMailboxQueue({ mailbox } as any, roleCheckpoint.mailboxQueue);
      }
      if (roleCheckpoint?.mailboxClosed) {
        mailbox.close();
      }
      const policy = new PolicyEngine(
        role.id,
        { maxTokens: role.budget_tokens ?? perRoleBudget, maxUsd: role.budget_usd, ...(role.policy ?? {}) },
        bus,
        roleCwd,
      );
      if (roleCheckpoint?.tokensUsed) {
        policy.setUsage(roleCheckpoint.tokensUsed);
      }
      // ORG-7: restore accumulated USD spend across resume so a stop/resume
      // cycle can't reset a role's USD budget back to zero.
      if (roleCheckpoint?.costUsd) {
        policy.setUsageUsd(roleCheckpoint.costUsd);
      }
      const runtime: AgentRuntime = {
        mailbox,
        policy,
        status: roleCheckpoint?.status ?? 'running',
        done: Promise.resolve(),
        metrics: { tokens: roleCheckpoint?.tokensUsed ?? 0, costUsd: roleCheckpoint?.costUsd ?? 0 },
        lastMessageId: roleCheckpoint?.lastMessageId,
        error: roleCheckpoint?.error,
        sessionId: roleCheckpoint?.sessionId,
        worktreePath: roleCwd !== cwd ? roleCwd : undefined,
        scrollback: new ScrollbackBuffer(),
      };
      if (roleCheckpoint?.scrollback?.length) {
        for (const line of roleCheckpoint.scrollback) runtime.scrollback.push(line);
      }
      const sessionOpts = {
        org: name,
        role,
        bus,
        policy,
        mailbox,
        cwd: roleCwd,
        def,
        // Pass the org state directory so runners that persist per-role state
        // (VercelAgentRunner session files) write under .monomind/orgs/<name>
        // instead of polluting the workspace cwd.
        orgDir: join(this.root, ORG_DIR, name),
        // Project root for named-provider (`adapter_config.provider`) config
        // lookup — role cwd may be an isolated workspace with no config file.
        orgRoot: this.root,
        maxTurns: role.max_turns_per_message ?? def.run_config.max_turns_per_message,
        resumeSessionId: roleCheckpoint?.sessionId,
        lastMessageId: () => runtime.lastMessageId,
        onOutput: (line: string) => runtime.scrollback.push(line),
        onSessionId: (id: string) => { runtime.sessionId = id; },
        deliver: (from: string, to: string, subject: string, body: string) =>
          this.deliver(name, from, to, subject, body),
        askHuman: (r: string, question: string) => this.askHuman(name, r, question),
        onGate: (r: string, gateName: string, gateDesc: string) =>
          this.createGate(name, r, gateName, gateDesc),
        circuitBreaker: (() => {
          const cb = (def.run_config as Record<string, unknown>).circuit_breaker as
            | { failure_threshold?: number; cooldown_ms?: number }
            | undefined;
          if (!cb) return undefined;
          return { threshold: cb.failure_threshold ?? 5, state: { failures: 0, tripped: false } };
        })(),
        beforeTool: (r: string, toolName: string) => this.checkApproval(name, r, toolName),
        fence: roleFences.get(role.id),
        // ORG-1: gatedCanUseTool denials are a natural decision point — record them so
        // `org decisions` shows real traces instead of always reporting none.
        onDecision: (r: string, toolName: string, message: string) => {
          this.recordDecision(name, r, {
            type: 'tool',
            context: `tool call: ${toolName}`,
            reasoning: message,
            outcome: 'denied',
          });
        },
        // ORG-9: decision gates are documented as "hard-blocking" — make that
        // true by actually denying tool use while this role has a pending gate,
        // the same way pending approvals already do.
        hasPendingGate: () => this.listGates(name, 'pending').some(g => g.roleId === role.id),
        onComplete:
          role.id === bossRole.id
            ? (r: string, outcome: 'achieved' | 'partial' | 'failed', summary: string) => {
                bus.emit({
                  type: 'status',
                  from: r,
                  reason: 'org-complete',
                  msg: `run outcome: ${outcome}`,
                  data: { outcome, summary },
                });
              }
            : undefined,
        // #11: a boss that overflows its context window isn't a crash (it keeps
        // returning +0-token errors forever), so without this the idle watchdog
        // just nudges it for ~30 min before idle-stopping. Restart the whole org
        // with fresh sessions instead — bounded by MAX_BOSS_RESTARTS.
        onContextLimit: role.id === bossRole.id ? () => this.scheduleBossRestart(name) : undefined,
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
        glossary,
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
        createTask: (r: string, title: string, assignee: string, deps: string[]) => {
          return this.dagCreateTask(name, r, title, assignee, deps);
        },
        completeTask: (r: string, taskId: string, result?: string) => {
          return this.dagCompleteTask(name, r, taskId, result);
        },
        listTasks: () => {
          const running = this.orgs.get(name);
          return JSON.stringify(running?.taskDag?.all() ?? [], null, 2);
        },
        splitTask: (r: string, parentId: string, children: { title: string; assignee: string }[]) => {
          return this.dagSplitTask(name, r, parentId, children);
        },
        mergeTask: (r: string, sourceId: string, targetId: string) => {
          return this.dagMergeTask(name, r, sourceId, targetId);
        },
        cancelTask: (r: string, taskId: string, reason?: string) => {
          return this.dagCancelTask(name, r, taskId, reason);
        },
        blockTask: (r: string, taskId: string, untilIso: string, reason?: string) => {
          return this.dagBlockTask(name, r, taskId, untilIso, reason);
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
        // built per role here in spawnRole, so each role gets its own runner.
        runner:
          this.opts.runner ??
          resolveRoleRunner(role.runtime, def.runtime, role.provider?.kind, undefined, role.provider),
      };
      // Supervised session: transient crashes (provider blips, network) restart
      // with backoff; a crash with the mailbox already closed, or one that
      // exhausts the retry budget, is terminal. runAgentSession already emits a
      // 'status' event for the raw error; the terminal 'audit' event is for
      // dashboards/alerts that filter on actionable failures (not routine
      // status chatter) so a dead agent surfaces instead of a run that
      // silently never progresses.
      const BACKOFFS_MS = this.opts.crashBackoffsMs ?? [1000, 5000, 15000];
      if (!mailbox.isClosed && runtime.status !== 'crashed') {
      runtime.done = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            await runAgentSession(sessionOpts);
            runtime.status = 'ended';
            return;
          } catch (err) {
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
              mailbox.push(`${Mailbox.CONTINUE_PREFIX} You reached the turn limit on your task. Continue your in-progress work from where you left off; if finished, end your turn.`);
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
              if (role.id !== bossRole.id) {
                // #2/#3: a worker is gone for the rest of this run. Without this
                // notice the coordinator keeps messaging a corpse (observed: four
                // unanswered org_send calls to a developer that had crashed on a
                // context-window limit). Tell the boss to reassign — and if the
                // crash was a context overflow, tell it to chunk smaller, since
                // re-dispatching the same task verbatim fails the same way.
                const bossRt = running.agents.get(bossRole.id);
                if (bossRt && !bossRt.mailbox.isClosed) {
                  const guidance = isContextLimit
                    ? ' This was a context-window overflow — re-dispatching the same task verbatim will fail identically. Break the work into smaller pieces (one file or section at a time) and do not paste large file contents in a single message.'
                    : '';
                  bossRt.mailbox.push(
                    `[system] Worker "${role.id}" crashed and will not recover this run (${message}). It can no longer receive messages — stop messaging it. Reassign its outstanding work to another agent or take it on yourself.${guidance}`,
                  );
                  bus.emit({
                    type: 'audit',
                    from: bossRole.id,
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
            });
            if (mailbox.isClosed) {
              crash();
              return;
            } // org stopped during backoff — never recovered
          }
        }
      })();
      }
      running.agents.set(role.id, runtime);
    };

    if (options?.resume && checkpoint) {
      const restoredRoles = new Set(Object.keys(checkpoint.roleState));
      for (const [roleId, roleState] of Object.entries(checkpoint.roleState)) {
        const role = def.roles.find((r) => r.id === roleId);
        if (role) spawnRole(role, roleState);
      }
      const pendingRoles = new Map<string, OrgRole>();
      for (const role of def.roles) {
        if (!restoredRoles.has(role.id)) {
          pendingRoles.set(role.id, role);
        }
      }
      running.pendingRoles = pendingRoles;
      running.spawnRole = spawnRole;
      running.taskDag = new TaskDag();
      if (worktreePath) running.worktreePath = worktreePath;
    } else {
      spawnRole(bossRole); // always, ungated — see comment above

      // Lazy spawn: register non-boss roles as pending. They spawn on first
      // message (see deliver()), avoiding the memory gate stampede at startup.
      const pendingRoles = new Map<string, OrgRole>();
      for (const role of def.roles) {
        if (role.id === bossRole.id) continue;
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
        if (!isNaN(count) && count > staleThreshold) {
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
        .get(boss.id)!
        .mailbox.push(
          `Org "${name}" started (run ${run}).\nGoal: ${taskOverride ?? def.goal}\n` +
            `Coordinate your team via org_send. Only when the FULL goal above is achieved (or clearly can't be) — not merely "this batch of dispatched tasks finished" — record it with org_complete, then end your turn. ` +
            `If a batch finishes but the goal has more scope left, dispatch the next batch instead of ending the run.${prevBrief}`,
        );
      bus.emit({
        type: 'status',
        msg: `org started (${def.roles.length} agents)`,
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
      const idleStop = (msg: string): void => {
        bus.emit({ type: 'audit', reason: 'idle-stop', msg });
        this.stopOrg(name).catch((err) =>
          console.error(`org ${name}: idle-stop failed:`, err instanceof Error ? err.message : err),
        );
      };
      const wd = setInterval(
        () => {
          if (this.restarting.has(name)) return; // boss auto-restart in flight — don't nudge or stop
          // A pending gate means the org is legitimately waiting for human input
          const pendingGates = this.readGates(name).gates.filter((g) => g.status === 'pending');
          if (pendingGates.length > 0) return;
          // Auto-resume any task whose org_task_block time has passed: flip it
          // back to 'running' and re-push it into the assignee's mailbox, same
          // as a fresh dispatch. This IS real activity, so fall through to the
          // normal idleFor check below rather than returning early — an
          // unblocked task should reset the idle clock, not just silently
          // update state nobody notices until the next nudge.
          const unblocked = running.taskDag?.unblockExpired(Date.now()) ?? [];
          for (const task of unblocked) {
            const agent = running.agents.get(task.assignee);
            if (agent && !agent.mailbox.isClosed) {
              agent.mailbox.push(`[task:${task.id}] Block expired — resuming: ${task.title}`);
            }
            bus.emit({
              type: 'status', from: 'dag', reason: 'task-unblocked',
              msg: `task ${task.id} block expired — resumed and re-dispatched to ${task.assignee}`,
              data: { taskId: task.id, assignee: task.assignee },
            });
          }
          // A task blocked on a real-world time still in the future is
          // legitimate waiting, same as a pending gate — don't nudge about it.
          if (running.taskDag?.hasActiveBlock(Date.now())) return;
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
            if (!bossRt || bossRt.status !== 'running' || bossRt.mailbox.isClosed) {
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
        },
        Math.max(200, Math.min(idleMs / 2, 30_000)),
      );
      (wd as { unref?: () => void }).unref?.();
      this.watchdogs.set(name, wd);
    }

    if (this.opts.crossProcess && this.opts.inboxUrl) {
      const lease = new BrokerLease(
        name,
        this.opts.inboxUrl,
        this.opts.brokerDir,
        undefined,
        normalizeCredential(this.opts.inboxCredential),
      );
      lease.start();
      this.leases.set(name, lease);
    }

    // Drain any messages that arrived while the org was offline
    const queued = drainInbox(this.root, name);
    for (const msg of queued) {
      // Spawn a lazy target before delivering. These messages were queued while
      // the org was offline — a human's answer, or another org's request — and
      // the whole point of draining is that they arrive. Skipping a role merely
      // because it has not spawned yet discarded them permanently, after
      // queueMessage had already reported them accepted.
      if (!running.agents.has(msg.toRole) && running.pendingRoles?.has(msg.toRole)) {
        const pending = running.pendingRoles.get(msg.toRole)!;
        running.pendingRoles.delete(msg.toRole);
        running.spawnRole?.(pending);
      }
      const agent = running.agents.get(msg.toRole);
      if (agent && !agent.mailbox.isClosed) {
        bus.emit({
          type: 'xorg',
          from: msg.fromQualified,
          to: `${name}:${msg.toRole}`,
          subject: msg.subject,
          msg: msg.body,
        });
        agent.mailbox.push(
          this.mailBody(
            name,
            running,
            `[message from ${msg.fromQualified}] subject: ${msg.subject}`,
            msg.body,
            `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`,
          ),
        );
      }
    }
    if (queued.length)
      bus.emit({ type: 'status', msg: `drained ${queued.length} queued message(s) from inbox` });

    return running;
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

  private async finishStop(name: string, org: RunningOrg, drainMs?: number, closedBy?: string): Promise<void> {
    // Snapshot checkpoint BEFORE closing mailboxes / draining sessions — the
    // queue is emptied during the drain, so capturing afterwards loses all
    // unconsumed messages (the whole point of checkpoint-resume).
    const stopCheckpoint = captureCheckpoint(org, 'stopped');
    // Capture THIS run's forwarder now: an autoWake-restart of the same org
    // during the long tail below (agent wait, flush, history write) would
    // register a NEW forwarder under the same name — settling/unsubscribing
    // that one would sever the new run's dashboard stream.
    const forwarder = this.forwarders.get(name);
    // Remove crash-cleanup handler — normal stop handles reaping itself
    const cleanup = (org as RunningOrg & { _crashCleanup?: () => void })._crashCleanup;
    if (cleanup) process.removeListener('exit', cleanup);
    const wd = this.watchdogs.get(name);
    if (wd) {
      clearInterval(wd);
      this.watchdogs.delete(name);
    }
    this.leases.get(name)?.stop();
    this.leases.delete(name);
    for (const a of org.agents.values()) a.mailbox.close();
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
    const timedOut = await Promise.race([
      allDone,
      new Promise<boolean>((r) => setTimeout(() => r(true), stopWaitMs)),
    ]);
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
      const rosterSuffix = stillActive.length
        ? ` — still active: ${stillActive.join(', ')}`
        : '';
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
    org.bus.emit({ type: 'status', msg: 'org stopped' });
    await org.bus.flush();
    // Append this run's summary to <org>/history.jsonl — read back from the
    // flushed bus.jsonl (the full durable record) rather than the bounded
    // in-memory buffer, so long runs summarize completely.
    try {
      const events = readRunEvents(this.root, name, org.run);
      if (events.length) {
        const summary = summarizeRun(events);
        const { appendFileSync } = await import('node:fs');
        appendFileSync(historyFile(this.root, name), JSON.stringify(summary) + '\n', 'utf8');
        // Cross-run memory: make this run's outcome recallable by meaning
        await this.storeRunMemory(name, org.def, org.run, summary);
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
    if (!this.orgs.has(name)) this.persistState(name, 'stopped', org.run, org, stopCheckpoint, closedBy);
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
    const running = org ?? this.orgs.get(name);
    const validStatus = status === 'stopped' || status === 'crashed' ? status : 'running';
    // Pattern 3: Capture full checkpoint state for resume. On stop, finishStop
    // passes a snapshot captured BEFORE mailboxes close and sessions drain —
    // otherwise the queue is always empty by persist time.
    let checkpoint: OrgCheckpoint | null = checkpointOverride ?? null;
    if (!checkpoint && running) {
      checkpoint = captureCheckpoint(running, validStatus as 'running' | 'stopped' | 'crashed');
    } else if (checkpoint && checkpoint.status !== validStatus) {
      const { checksum: _, ...state } = checkpoint;
      checkpoint = {
        ...state,
        status: validStatus as 'running' | 'stopped' | 'crashed',
        checksum: generateChecksum({ ...state, status: validStatus as 'running' | 'stopped' | 'crashed' }),
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
      ...(checkpoint ? { checkpoint } : {}),
      ...(closedBy ? { closedBy } : {}),
    });
  }

  /** Mark every currently-running org as crashed in runtime.json.
   *  Called from process-level crash handlers — must be synchronous and best-effort. */
  persistCrashStateAll(): void {
    for (const [name, org] of this.orgs) {
      try {
        const p = join(this.root, ORG_DIR, name, 'runtime.json');
        // C4: atomic write — crash handler is the most likely place to hit
        // a partial write since the process is mid-teardown.
        writeJsonFileAtomic(p, {
          status: 'crashed',
          run: org.run,
          pid: process.pid,
          updated: new Date().toISOString(),
          closedBy: 'crash-handler',
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
  private checkApproval(org: string, role: string, action: string): Promise<boolean | null> {
    return approvalOps.checkApproval(this, org, role, action);
  }
  async setApproval(
    org: string,
    role: string,
    action: string,
    approved: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return approvalOps.setApproval(this, org, role, action, approved);
  }

  // questions.ts
  async askHuman(org: string, role: string, question: string): Promise<string> {
    return questionOps.askHuman(this, org, role, question);
  }
  async answerQuestion(
    org: string,
    role: string,
    questionId: string,
    answer: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return questionOps.answerQuestion(this, org, role, questionId, answer);
  }

  // decisions.ts
  private readGates(org: string): { gates: DecisionGate[] } {
    return decisionOps.readGates(this.root, org);
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
  ): string {
    return decisionOps.dagCreateTask(this, org, role, title, assignee, deps);
  }
  private dagCompleteTask(org: string, role: string, taskId: string, result?: string): string {
    return decisionOps.dagCompleteTask(this, org, role, taskId, result);
  }
  private dagSplitTask(org: string, role: string, parentId: string, children: { title: string; assignee: string }[]): string {
    return decisionOps.dagSplitTask(this, org, role, parentId, children);
  }
  private dagMergeTask(org: string, role: string, sourceId: string, targetId: string): string {
    return decisionOps.dagMergeTask(this, org, role, sourceId, targetId);
  }
  private dagCancelTask(org: string, role: string, taskId: string, reason?: string): string {
    return decisionOps.dagCancelTask(this, org, role, taskId, reason);
  }
  private dagBlockTask(org: string, role: string, taskId: string, untilIso: string, reason?: string): string {
    return decisionOps.dagBlockTask(this, org, role, taskId, untilIso, reason);
  }
  private dagPlanGraph(org: string, role: string, specs: decisionOps.PlanTaskSpec[]): string {
    return decisionOps.dagPlanGraph(this, org, role, specs);
  }
  recordDecision(
    org: string,
    role: string,
    decision: {
      type: 'tool' | 'handoff' | 'approval' | 'routing';
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
  ): { ok: true; receipt: string } | { ok: false; error: string } {
    return crossOrg.receiveRemote(this, toOrg, toRole, fromQualified, subject, body);
  }
  private mailBody(
    orgName: string,
    org: RunningOrg | undefined,
    header: string,
    body: string,
    id: string,
  ): string {
    return crossOrg.mailBody(this.root, orgName, org, header, body, id);
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
  ): Promise<void> {
    return orgMemory.storeRunMemory(this, name, def, run, summary);
  }

  // checkpoint-ops.ts
  async replayFrom(name: string, run: string): Promise<RunningOrg | null> {
    return checkpointOps.replayFrom(this, name, run);
  }
  async resumeOrg(name: string): Promise<RunningOrg | null> {
    return checkpointOps.resumeOrg(this, name);
  }
}
