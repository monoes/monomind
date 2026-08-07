// packages/@monomind/cli/src/orgrt/daemon.ts
// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { reapOrphanedSdkProcesses } from '../utils/resource-governor.js';
import { OrgBus } from './bus.js';
import { PolicyEngine } from './policy.js';
import { Mailbox } from './mailbox.js';
import { runAgentSession } from './session.js';
import { attachForwarder } from './forwarder.js';
import { BrokerLease, lookupOrg, normalizeCredential } from './broker.js';
import { queueMessage, drainInbox } from './inbox.js';
import { OrgDefSchema, type OrgDef, type OrgRole, type BusEvent, type DecisionGate, ORG_DIR } from './types.js';
import { TaskDag } from './task-dag.js';
import { summarizeRun, readRunEvents, readHistory, historyFile } from './reporting.js';
import { checkResources, waitForCapacity, getResourceLimits, configureResourceLimits } from '../utils/resource-governor.js';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './agent-runner.js';
import { OpencodeAgentRunner } from './opencode-runner.js';
import { KimiCodeAgentRunner } from './kimicode-runner.js';
import { captureCheckpoint, validateCheckpoint, isCheckpointExpired, restoreMailboxQueue, type OrgCheckpoint } from './checkpoint.js';

/** OpenTelemetry tracing helper - creates spans for major operations */
class OtelTracer {
  private enabled = false;
  private spans = new Map<string, { start: number; metadata: Record<string, unknown> }>();

  enable(): void { this.enabled = true; }

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

/** Bounded ring buffer for agent terminal scrollback. */
export class ScrollbackBuffer {
  private lines: string[] = [];
  constructor(private maxLines = 500) {}
  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }
  snapshot(): string[] { return [...this.lines]; }
  clear(): void { this.lines.length = 0; }
}

/** Bodies larger than this are digested to a .mail file (see mailBody). */
const MAIL_BODY_MAX = 4096;
/** How much of an oversized body stays inline in the digest. */
const MAIL_DIGEST_CHARS = 1024;

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
}

export interface DaemonOpts {
  queryFn?: typeof query;
  /** Explicit agent runner (takes precedence over everything). When unset,
   *  session.ts builds a ClaudeAgentRunner from queryFn/the default — so the
   *  Claude path is unchanged unless MONOMIND_RUNTIME=opencode is set. */
  runner?: AgentRunner;
  forward?: boolean;           // POST events to control server (default true)
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
  private orgs = new Map<string, RunningOrg>();
  private waking = new Set<string>();
  private globalSubscribers = new Set<(e: BusEvent) => void>();
  private leases = new Map<string, BrokerLease>();
  private forwarders = new Map<string, ReturnType<typeof attachForwarder>>();
  private watchdogs = new Map<string, ReturnType<typeof setInterval>>();
  private stopping = new Map<string, Promise<void>>();
  private otel = new OtelTracer();
  private approvals = new Map<string, Array<{ roleId: string; action: string; question: string; ts: number; approved: boolean | null }>>();
  // R5: per-org approval mutex. checkApproval and setApproval both read
  // this.approvals, await something (mailbox push, markAnswered), then
  // mutate + writeFileSync. Two concurrent calls in one org race on the
  // in-memory Map and clobber each other on disk. Serialize them.
  private approvalLocks = new Map<string, Promise<unknown>>();
  // Per-org gates and questions mutexes — same TOCTOU pattern as approvalLocks.
  private gatesLocks = new Map<string, Promise<unknown>>();
  private questionsLocks = new Map<string, Promise<unknown>>();
  // Roles currently spawning — prevents duplicate lazy spawns from concurrent messages
  private spawning = new Map<string, Set<string>>();
  // #4: bounded whole-org restarts after the boss terminally crashes. A monotonic
  // per-org counter so a crashing boss can never burn money in an infinite loop;
  // reset only by an explicit (non-restart) startOrg.
  private static readonly MAX_BOSS_RESTARTS = 2;
  private static readonly BOSS_RESTART_BACKOFF_MS = [10_000, 30_000];
  private bossRestartCounts = new Map<string, number>();
  private restarting = new Set<string>();
  // #3: recognizes provider context-window-overflow errors so the boss can be told
  // to chunk the work instead of re-dispatching the same oversized task verbatim.
  private static readonly CONTEXT_LIMIT_RE = /context[- ]?(window|length|size|limit)|maximum context|exceeds?.{0,12}(context|token)|too many tokens|prompt is too long/i;

  constructor(private root: string, private opts: DaemonOpts = {}) {}

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

  listOrgs(): RunningOrg[] { return [...this.orgs.values()]; }
  getOrg(name: string): RunningOrg | undefined { return this.orgs.get(name); }

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

    const existingRoleIds = new Set(running.def.roles.map(r => r.id));
    const newRoleIds = new Set(newDef.roles.map(r => r.id));
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

    running.bus.emit({ type: 'audit', reason: 'hot-reload',
      msg: `org def reloaded: ${changed.length} fields changed, ${newRoles.length} new roles, ${removedRoles.length} removed roles`,
      data: { changed, newRoles, removedRoles } });

    return { changed, newRoles, removedRoles };
  }
  /** Names of the orgs this daemon currently has running. Snapshot — safe to
   *  iterate while stopOrg() mutates the underlying map. */
  listRunning(): string[] { return [...this.orgs.keys()]; }

  /** Hook for the SSE server — registers a listener for all bus events across all orgs. */
  onBusEvent?: (fn: (e: BusEvent) => void) => void = (fn) => { this.subscribe(fn); };

  /** Snapshot of all running orgs for dashboard initial load. */
  getStatusSnapshot?: () => Record<string, unknown> = () => {
    const orgs: Record<string, unknown>[] = [];
    for (const [name, running] of this.orgs) {
      const roles: Record<string, unknown>[] = [];
      for (const [roleId, agent] of running.agents) {
        roles.push({
          id: roleId, status: agent.status,
          worktree: agent.worktreePath ?? null,
          metrics: agent.metrics,
        });
      }
      orgs.push({
        name, run: running.run,
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
    if (ws === 'repo' || ws === 'isolated' || ws === 'worktree' || ws === 'worktree-per-role') return ws;
    return isAbsolute(ws) ? ws : join(this.root, ws);
  }

  async startOrg(name: string, taskOverride?: string): Promise<RunningOrg> {
    // A restart-driven start (scheduleBossRestart) keeps its crash counter so the
    // cap holds; any other (explicit) start resets it so a manual re-run gets a
    // fresh budget.
    if (!this.restarting.has(name)) this.bossRestartCounts.delete(name);
    if (this.orgs.has(name)) throw new Error(`org ${name} already running`);
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
    // random suffix: second-precision stamps collide across processes (two CLI
    // invocations in the same second would share a run dir and its bus.jsonl)
    const run = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
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
    this.abandoned.delete(name); // a previous run's missing roles say nothing about this one
    const ws = this.workspaceSetting(def);
    let cwd: string;
    let worktreePath: string | undefined;
    if (ws === 'worktree') {
      worktreePath = join(this.root, ORG_DIR, name, 'worktree');
      const { execSync } = await import('node:child_process');
      try {
        // Remove stale worktree from a previous run
        if (existsSync(worktreePath)) {
          // R4: bound the call — a wedged git hook (git-lfs, gc lock, gpg sign
          // prompt) would otherwise hang the whole daemon indefinitely.
          execSync(`git worktree remove --force "${worktreePath}"`, { cwd: this.root, stdio: 'ignore', timeout: 30_000 });
        }
      } catch { /* best-effort cleanup */ }
      execSync(`git worktree add "${worktreePath}" HEAD --detach`, { cwd: this.root, stdio: 'ignore', timeout: 30_000 });
      cwd = worktreePath;
    } else {
      cwd = ws === 'repo' ? this.root
        : ws === 'isolated' ? join(this.root, ORG_DIR, name, 'workspace')
          : ws;
    }
    mkdirSync(cwd, { recursive: true });

    // An org must be able to seat its whole roster. maxSdkProcesses is sized for
    // the machine (cpus - 2), so any org with more roles than that had its tail
    // roles deferred forever — a 7-role org on an 8-core box permanently lost
    // its 7th, and the work that role owned simply never happened. Raise the
    // ceiling to the role count. An explicit MONOMIND_MAX_SDK_PROCS still wins:
    // if the operator named a number, that number is the answer.
    if (!process.env.MONOMIND_MAX_SDK_PROCS && getResourceLimits().maxSdkProcesses < def.roles.length) {
      configureResourceLimits({ maxSdkProcesses: def.roles.length });
    }

    // Validate per-role providers before spawning anything (fail-fast: a
    // missing env var discovered 10 minutes into a run wastes the entire run).
    const { resolveProviderEnv: validateProvider } = await import('./provider.js');
    for (const role of def.roles) {
      if (role.provider) {
        try {
          validateProvider(role.provider);
        } catch (err) {
          throw new Error(`org ${name}: role "${role.id}" provider validation failed — ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const bus = new OrgBus(name, run, dir);
    // Lightweight in-memory tail for busEvents() (test-loop, /api/history).
    // Full events (including Write content snapshots) live on disk in bus.jsonl;
    // the in-memory copy strips bulky data.content to keep RAM flat.
    const MAX_COLLECTED = 1000;
    const collected: BusEvent[] = [];
    let lastActivity = Date.now();
    bus.subscribe(e => {
      const slim: BusEvent = e.data?.content != null
        ? { ...e, data: { ...e.data, content: undefined } }
        : e;
      collected.push(slim);
      if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
      // The watchdog's own nudge event must not count as org activity, or a
      // hung boss would never trip the "nudge produced no activity" stop.
      if (e.reason !== 'idle-nudge') lastActivity = Date.now();
      // org_complete IS the end of the run — self-stop instead of sitting
      // "running" forever after a recorded outcome. Deferred (unref'd) so the
      // tool call's receipt reaches the boss and its final turn text still
      // lands on the bus before mailboxes close; stopOrg is reentrant-safe
      // against a concurrent manual stop.
      if (e.type === 'status' && e.reason === 'org-complete') {
        const t = setTimeout(() => {
          this.stopOrg(name, { drainMs: COMPLETE_DRAIN_MS }).catch(err => console.error(`org ${name}: auto-stop after org_complete failed:`, err instanceof Error ? err.message : err));
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
      this.forwarders.set(name, attachForwarder(bus, this.opts.controlJson ?? join(this.root, '.monomind/control.json')));

    const running: RunningOrg = { def, run, bus, agents: new Map(), busEvents: () => [...collected], workdir: cwd };
    this.orgs.set(name, running);

    const perRoleBudget = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
    // Single boss-selection rule for kickoff AND org_complete gating — the
    // session layer previously keyed the tool on reports_to===null while the
    // kickoff went to (type==='boss' || reports_to===null || roles[0]), so a
    // fallback-selected boss could be told to call org_complete without having
    // the tool.
    const bossRole = def.roles.find(r => r.type === 'boss' || r.reports_to === null) ?? def.roles[0];
    // Canonical entity names from the org KG — injected into the coordinator
    // prompt so org_learn extractions reuse them instead of minting duplicates.
    const glossary = await (async () => {
      try {
        if (!(await this.orgMemoryUsable())) return [];
        const kg = await import('../memory/memory-kg.js');
        return await kg.kgGlossary({ dbPath: this.orgMemoryDbPath() });
      } catch { return []; }
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
    const spawnRole = (role: OrgRole): void => {
      let roleCwd = cwd;
      if (ws === 'worktree-per-role' && role.id !== bossRole.id) {
        const wtPath = join(this.root, ORG_DIR, name, `worktree-${role.id}`);
        try {
          // Q7: top-level `import { execSync }` replaces the inlined
          // `require('node:child_process')` that broke ESM at runtime —
          // vitest's CJS shim masked it in tests but the built package
          // threw "require is not defined" in real Node ESM execution.
          if (existsSync(wtPath)) {
            try { execSync(`git worktree remove --force "${wtPath}"`, { cwd: this.root, stdio: 'ignore', timeout: 30_000 }); } catch { /* best-effort */ }
          }
          execSync(`git worktree add "${wtPath}" HEAD --detach`, { cwd: this.root, stdio: 'ignore', timeout: 30_000 });
          roleCwd = wtPath;
        } catch { /* fallback to shared cwd if git worktree fails */ }
      }
      const mailbox = new Mailbox();
      const policy = new PolicyEngine(role.id,
        { maxTokens: perRoleBudget, ...(role.policy ?? {}) }, bus, roleCwd);
      const runtime: AgentRuntime = { mailbox, policy, status: 'running', done: Promise.resolve(), metrics: { tokens: 0, costUsd: 0 }, worktreePath: roleCwd !== cwd ? roleCwd : undefined, scrollback: new ScrollbackBuffer() };
      const sessionOpts = {
        org: name, role, bus, policy, mailbox, cwd: roleCwd, def,
        maxTurns: role.max_turns_per_message ?? def.run_config.max_turns_per_message,
        lastMessageId: () => runtime.lastMessageId,
        onOutput: (line: string) => runtime.scrollback.push(line),
        deliver: (from: string, to: string, subject: string, body: string) => this.deliver(name, from, to, subject, body),
        askHuman: (r: string, question: string) => this.askHuman(name, r, question),
        onGate: (r: string, gateName: string, gateDesc: string) => this.createGate(name, r, gateName, gateDesc),
        circuitBreaker: (() => {
          const cb = (def.run_config as Record<string, unknown>).circuit_breaker as { failure_threshold?: number; cooldown_ms?: number } | undefined;
          if (!cb) return undefined;
          return { threshold: cb.failure_threshold ?? 5, state: { failures: 0, tripped: false } };
        })(),
        beforeTool: (r: string, toolName: string) => this.checkApproval(name, r, toolName),
        onComplete: role.id === bossRole.id
          ? (r: string, outcome: 'achieved' | 'partial' | 'failed', summary: string) => {
              bus.emit({ type: 'status', from: r, reason: 'org-complete', msg: `run outcome: ${outcome}`, data: { outcome, summary } });
            }
          : undefined,
        // #11: a boss that overflows its context window isn't a crash (it keeps
        // returning +0-token errors forever), so without this the idle watchdog
        // just nudges it for ~30 min before idle-stopping. Restart the whole org
        // with fresh sessions instead — bounded by MAX_BOSS_RESTARTS.
        onContextLimit: role.id === bossRole.id ? () => this.scheduleBossRestart(name) : undefined,
        recall: async (r: string, q: string) => {
          const answer = await this.recallOrgMemory(name, def, q, r);
          bus.emit({ type: 'status', from: r, reason: 'org-recall', msg: `recall: ${q.slice(0, 80)}`, data: { hits: answer.hits } });
          return answer.text;
        },
        searchKnowledge: async (r: string, q: string) => {
          const answer = await this.searchProjectKnowledge(q);
          bus.emit({ type: 'status', from: r, reason: 'knowledge-search', msg: `knowledge: ${q.slice(0, 80)}`, data: { hits: answer.hits } });
          return answer.text;
        },
        glossary,
        remember: async (r: string, content: string, scope: 'org' | 'agent') => {
          const text = await this.rememberOrgMemory(name, def, r, content, scope, run);
          bus.emit({ type: 'status', from: r, reason: 'org-remember', msg: `remember (${scope}): ${content.slice(0, 80)}`, data: { scope } });
          return text;
        },
        learn: async (r: string, payload: { nodes?: unknown[]; edges?: unknown[]; rules?: unknown[] }) => {
          const text = await this.learnOrgKnowledge(name, run, payload);
          bus.emit({
            type: 'status', from: r, reason: 'org-learn', msg: `learn: ${text.slice(0, 120)}`,
            data: { nodes: payload.nodes?.length ?? 0, edges: payload.edges?.length ?? 0, rules: payload.rules?.length ?? 0 },
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
        queryFn: this.opts.queryFn,
        // Runner resolution: explicit > opencode/kimicode (when MONOMIND_RUNTIME
        // selects them) > undefined (session.ts falls back to ClaudeAgentRunner
        // via queryFn). Leaving it undefined for the default path is what keeps
        // Claude/Antigravity orgs byte-for-byte unchanged.
        runner: this.opts.runner
          ?? (process.env.MONOMIND_RUNTIME === 'opencode' ? new OpencodeAgentRunner()
            : process.env.MONOMIND_RUNTIME === 'kimicode' ? new KimiCodeAgentRunner()
            : undefined),
      };
      // Supervised session: transient crashes (provider blips, network) restart
      // with backoff; a crash with the mailbox already closed, or one that
      // exhausts the retry budget, is terminal. runAgentSession already emits a
      // 'status' event for the raw error; the terminal 'audit' event is for
      // dashboards/alerts that filter on actionable failures (not routine
      // status chatter) so a dead agent surfaces instead of a run that
      // silently never progresses.
      const BACKOFFS_MS = this.opts.crashBackoffsMs ?? [1000, 5000, 15000];
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
            const message = err instanceof Error ? err.message : String(err);
            // Exit 143 = SIGTERM. If the mailbox is already closed, we
            // sent the signal ourselves during stop — not a crash.
            const killedByStop = mailbox.isClosed && /exit(?:ed)? with code 143/.test(message);
            const crash = (): void => {
              if (killedByStop) {
                runtime.status = 'ended';
                bus.emit({
                  type: 'status', from: role.id,
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
                type: 'audit', from: role.id,
                msg: `agent "${role.id}" crashed: ${message}`,
                reason: isContextLimit ? 'agent-context-limit' : 'agent-session-crash',
                data: { agentId: role.id, error: message, restarts: attempt, contextLimit: isContextLimit },
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
                    `[system] Worker "${role.id}" crashed and will not recover this run (${message}). It can no longer receive messages — stop messaging it. Reassign its outstanding work to another agent or take it on yourself.${guidance}`);
                  bus.emit({ type: 'audit', from: bossRole.id, reason: 'worker-crashed',
                    msg: `worker "${role.id}" crashed (contextLimit=${isContextLimit}); coordinator notified to reassign` });
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
                type: 'status', from: role.id, reason: 'agent-fatal',
                msg: `agent "${role.id}" hit a fatal (non-retryable) error — not restarting`,
              });
              crash();
              return;
            }
            if (mailbox.isClosed || attempt >= BACKOFFS_MS.length) { crash(); return; }
            bus.emit({
              type: 'status', from: role.id, reason: 'agent-restart',
              msg: `agent "${role.id}" crashed (${message}) — restarting in ${BACKOFFS_MS[attempt]}ms (attempt ${attempt + 1}/${BACKOFFS_MS.length})`,
            });
            await new Promise<void>(r => { const t = setTimeout(r, BACKOFFS_MS[attempt]); (t as { unref?: () => void }).unref?.(); });
            if (mailbox.isClosed) { crash(); return; } // org stopped during backoff — never recovered
          }
        }
      })();
      running.agents.set(role.id, runtime);
    };

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

    // Crash cleanup: reap SDK children if this process exits abnormally.
    // monolean: process-scoped listener — upgrade path = per-org tracking
    const crashCleanup = (): void => {
      try {
        // Statically imported: a process 'exit' handler must be synchronous,
        // so `await import()` is unavailable — and a bare require() throws
        // "require is not defined" in this ESM package. Guarded by
        // no-cjs-require-in-esm.test.ts.
        reapOrphanedSdkProcesses(new Set(), process.pid);
      } catch { /* best-effort */ }
    };
    process.on('exit', crashCleanup);
    (running as RunningOrg & { _crashCleanup?: () => void })._crashCleanup = crashCleanup;

    // Stale-base drift detection: if the working tree is too many commits behind
    // its tracking branch, warn or refuse to start. Best-effort — git may not be
    // available, or the repo may have no tracking branch.
    const staleThreshold = (def.run_config as Record<string, unknown>).stale_base_threshold as number | undefined;
    if (staleThreshold && staleThreshold > 0 && cwd === this.root) {
      try {
        const { execSync } = await import('node:child_process');
        const behind = execSync('git rev-list --count HEAD..@{upstream} 2>/dev/null', { cwd, encoding: 'utf8', timeout: 10_000 }).trim();
        const count = parseInt(behind, 10);
        if (!isNaN(count) && count > staleThreshold) {
          bus.emit({
            type: 'audit', reason: 'stale-base',
            msg: `working tree is ${count} commits behind upstream (threshold: ${staleThreshold}) — consider pulling before running`,
            data: { behind: count, threshold: staleThreshold },
          });
        }
      } catch { /* no upstream tracking or git unavailable — skip silently */ }
    }

    const boss = bossRole;
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
    running.agents.get(boss.id)!.mailbox.push(
      `Org "${name}" started (run ${run}).\nGoal: ${taskOverride ?? def.goal}\n` +
      `Coordinate your team via org_send. When the goal is achieved (or clearly can't be), record it with org_complete, then end your turn.${prevBrief}`);
    bus.emit({ type: 'status', msg: `org started (${def.roles.length} agents)`, data: { goal: taskOverride ?? def.goal } });
    this.persistState(name, 'running', run);

    // Idle watchdog: a hung tool call (or a run that quietly finished without
    // org_complete) produces no bus events, and every agent just waits. After
    // idle_minutes of silence, nudge the boss to complete or reassign; if the
    // nudge itself produces no activity (boss hung/crashed), or the org keeps
    // going idle after MAX_IDLE_NUDGES nudges, stop the run instead of letting
    // it freeze forever. idle_minutes: 0 disables.
    const idleMs = (def.run_config.idle_minutes ?? 10) * 60_000;
    if (idleMs > 0) {
      const MAX_IDLE_NUDGES = 3;
      let nudgedAt = 0;
      let nudges = 0;
      const idleStop = (msg: string): void => {
        bus.emit({ type: 'audit', reason: 'idle-stop', msg });
        this.stopOrg(name).catch(err => console.error(`org ${name}: idle-stop failed:`, err instanceof Error ? err.message : err));
      };
      const wd = setInterval(() => {
        if (this.restarting.has(name)) return; // boss auto-restart in flight — don't nudge or stop
        // A pending gate means the org is legitimately waiting for human input
        const pendingGates = this.readGates(name).gates.filter(g => g.status === 'pending');
        if (pendingGates.length > 0) return;
        const idleFor = Date.now() - lastActivity;
        if (idleFor < idleMs) { nudgedAt = 0; return; }
        if (nudgedAt === 0) {
          if (nudges >= MAX_IDLE_NUDGES) {
            idleStop(`org idle again after ${nudges} nudges — stopping run`);
            return;
          }
          const bossRt = running.agents.get(bossRole.id);
          if (!bossRt || bossRt.status !== 'running' || bossRt.mailbox.isClosed) {
            idleStop(`org idle for ${Math.round(idleFor / 60_000)}m and boss "${bossRole.id}" is unreachable — stopping run`);
            return;
          }
          nudges++; nudgedAt = Date.now();
          bus.emit({ type: 'audit', from: bossRole.id, reason: 'idle-nudge', msg: `no org activity for ${Math.round(idleFor / 60_000)}m — nudging boss (${nudges}/${MAX_IDLE_NUDGES})` });
          bossRt.mailbox.push(
            `[watchdog] No activity in org "${name}" for ${Math.round(idleFor / 60_000)} minute(s). ` +
            `If the goal is achieved (or clearly can't be), call org_complete now. Otherwise check on your team via org_send and reassign stalled work.`);
        } else if (Date.now() - nudgedAt >= idleMs) {
          idleStop(`nudge produced no activity for another ${Math.round(idleMs / 60_000)}m — boss appears hung, stopping run`);
        }
      }, Math.max(200, Math.min(idleMs / 2, 30_000)));
      (wd as { unref?: () => void }).unref?.();
      this.watchdogs.set(name, wd);
    }

    if (this.opts.crossProcess && this.opts.inboxUrl) {
      const lease = new BrokerLease(name, this.opts.inboxUrl, this.opts.brokerDir, undefined, normalizeCredential(this.opts.inboxCredential));
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
        bus.emit({ type: 'xorg', from: msg.fromQualified, to: `${name}:${msg.toRole}`, subject: msg.subject, msg: msg.body });
        agent.mailbox.push(this.mailBody(name, running, `[message from ${msg.fromQualified}] subject: ${msg.subject}`, msg.body,
          `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`));
      }
    }
    if (queued.length) bus.emit({ type: 'status', msg: `drained ${queued.length} queued message(s) from inbox` });

    return running;
  }

  /** A role that failed its resource gate at boot isn't abandoned — keep polling
   *  for capacity in the background (bounded) and spawn it the moment resources
   *  free up, instead of silently running the org shorthanded for its whole life.
   *  Bails quietly if the org is stopped (or restarted under the same name)
   *  before capacity returns; `running` is compared by identity, not `name`,
   *  so a stale retry can never spawn into a different run. */
  private scheduleDeferredSpawn(name: string, running: RunningOrg, role: OrgRole, spawnRole: (role: OrgRole) => void): void {
    const MAX_ATTEMPTS = 6; // ~30 min of retrying before giving up loudly
    (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const waited = await waitForCapacity(5 * 60_000);
        if (this.orgs.get(name) !== running) return; // org stopped/restarted — abandon quietly
        if (waited.ok) {
          running.bus.emit({ type: 'audit', from: role.id, reason: 'resource-recovered',
            msg: `resources recovered after ${attempt} retr${attempt === 1 ? 'y' : 'ies'} — spawning deferred role "${role.id}"` });
          // Drain messages queued while the role was deferred BEFORE spawning
          // to prevent race condition where messages arrive during spawn window
          const queued = drainInbox(this.root, name);
          spawnRole(role);
          for (const msg of queued) {
            const agent = running.agents.get(msg.toRole);
            if (agent && !agent.mailbox.isClosed) {
              running.bus.emit({ type: 'xorg', from: msg.fromQualified, to: `${name}:${msg.toRole}`, subject: msg.subject, msg: msg.body });
              agent.mailbox.push(this.mailBody(name, running, `[message from ${msg.fromQualified}] subject: ${msg.subject}`, msg.body,
                `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`));
            }
          }
          return;
        }
        running.bus.emit({ type: 'audit', from: role.id, reason: 'resource-pressure',
          msg: `still under pressure (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying "${role.id}" spawn: ${waited.reason}` });
      }
      const missing = this.abandoned.get(name) ?? new Set<string>();
      missing.add(role.id);
      this.abandoned.set(name, missing);
      this.persistState(name, 'running', running.run);
      running.bus.emit({ type: 'audit', from: role.id, reason: 'resource-abandoned',
        msg: `giving up spawning "${role.id}" after ${MAX_ATTEMPTS} retries — org will run without this role until manually restarted` });
    })().catch(err => console.error(`org ${name}: deferred spawn of "${role.id}" failed:`, err instanceof Error ? err.message : err));
  }

  /**
   * Resolves an org_send `to` address ("role" for same-org, "org:role" for
   * cross-org) into its parts. Centralizes the one addressing rule that
   * matters (an "own-org:role" self-prefix is intra-org, not cross-org) so
   * deliver()/deliverRemote() don't each re-derive it — the qualified `to`
   * string returned is always the canonical display form for that address.
   */
  private resolveAddress(fromOrg: string, to: string): { cross: boolean; orgName: string; role: string; qualified: string } {
    const cross = to.includes(':');
    if (!cross) return { cross: false, orgName: fromOrg, role: to, qualified: to };
    const [orgName, role] = to.split(':', 2);
    if (orgName === fromOrg) return { cross: false, orgName, role, qualified: role }; // self-prefixed — still intra-org
    return { cross: true, orgName, role, qualified: to };
  }

  /** Mailbox bodies are unbounded — a pasted 20KB file would persist in the
   *  recipient's context for the whole run. Bodies over MAIL_BODY_MAX are
   *  written to <org workdir>/.mail/<message-id>.md and replaced with a ~1KB
   *  digest plus a pointer; smaller messages stay byte-identical. */
  private mailBody(orgName: string, org: RunningOrg | undefined, header: string, body: string, id: string): string {
    if (body.length <= MAIL_BODY_MAX) return `${header}\n\n${body}`;
    const mailDir = join(org?.workdir ?? join(this.root, ORG_DIR, orgName), '.mail');
    const file = join(mailDir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`);
    try {
      mkdirSync(mailDir, { recursive: true });
      writeFileSync(file, body);
      return `${header}\n\n${body.slice(0, MAIL_DIGEST_CHARS)}\n\n[... truncated — full text at ${file} — Read it if needed]`;
    } catch {
      return `${header}\n\n${body}`; // digest write failed — deliver in full rather than lose content
    }
  }

  /** Route a message. to = "role" (same org) or "org:role" (cross-org). Returns a receipt string. */
  async deliver(fromOrg: string, fromRole: string, to: string, subject: string, body: string): Promise<string> {
    const { cross, orgName: targetOrgName, role: targetRole, qualified: toQualified } = this.resolveAddress(fromOrg, to);
    const targetOrg = this.orgs.get(targetOrgName);
    const src = this.orgs.get(fromOrg);
    // Lazy spawn: if the role is pending (not yet spawned), spawn it now.
    // ATOMIC GUARD: Check spawning Set to prevent duplicate spawns from concurrent messages
    const spawning = this.spawning.get(targetOrgName) ?? new Set<string>();
    this.spawning.set(targetOrgName, spawning);
    if (targetOrg && !targetOrg.agents.has(targetRole) && targetOrg.pendingRoles?.has(targetRole) && !spawning.has(targetRole)) {
      const role = targetOrg.pendingRoles.get(targetRole)!;
      targetOrg.pendingRoles.delete(targetRole);
      spawning.add(targetRole); // Mark as spawning before async work
      const check = checkResources();
      if (!check.ok) {
        const waited = await waitForCapacity(60_000);
        spawning.delete(targetRole); // Clear spawning flag after check
        if (!waited.ok) {
          targetOrg.bus.emit({ type: 'audit', from: targetRole, reason: 'resource-skip',
            msg: `deferring lazy spawn of "${targetRole}": ${waited.reason}` });
          // Queue the triggering message so it survives the deferred spawn — without
          // this the sender got "queued" but the message was silently lost.
          // B5 FIX: Queue FIRST, then schedule spawn only if queue succeeds.
          // If queueing fails, we return the error without modifying spawn state.
          const queued = queueMessage(this.root, targetOrgName, {
            fromQualified: cross ? `${fromOrg}:${fromRole}` : fromRole,
            toRole: targetRole, subject, body, ts: Date.now(),
          });
          if (!queued) {
            src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `queue failed: ${subject}`, reason: 'queue-failed' });
            return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
          }
          this.scheduleDeferredSpawn(targetOrgName, targetOrg, role, targetOrg.spawnRole!);
          return `queued for ${toQualified} (role starting — waiting for resources)`;
        }
      }
      targetOrg.spawnRole!(role);
      spawning.delete(targetRole); // Clear spawning flag after spawn completes
      targetOrg.bus.emit({ type: 'status', from: targetRole, msg: `lazy-spawned on first message from ${fromRole}` });
    }
    if (!targetOrg || !targetOrg.agents.has(targetRole)) {
      if (cross && this.opts.crossProcess) return this.deliverRemote(fromOrg, fromRole, targetOrgName, targetRole, toQualified, subject, body, src);
      // Queue + auto-wake: if the org definition exists locally but isn't running, spool the message and start it
      if (cross && this.hasOrgDef(targetOrgName)) {
        const queued = queueMessage(this.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
        if (!queued) {
          src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `queue failed: ${subject}`, reason: 'queue-failed' });
          return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
        }
        src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to: toQualified, subject, msg: body, data: { queued: true } });
        this.autoWake(targetOrgName);
        return `queued for ${toQualified} (org starting)`;
      }
      src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
      return `ERROR: unknown recipient "${toQualified}" (known: ${[...(targetOrg?.agents.keys() ?? this.orgs.keys())].join(', ')})`;
    }
    const targetAgent = targetOrg.agents.get(targetRole)!;
    if (targetAgent.status === 'crashed') {
      src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'recipient crashed (retry budget exhausted)' });
      return `ERROR: recipient "${toQualified}" crashed and will not recover this run — message not delivered (${targetAgent.error ?? 'unknown error'})`;
    }
    if (targetAgent.mailbox.isClosed) {
      // Distinguish two cases that used to share one drop:
      //  - org mid-shutdown: nothing will ever read the queue again — the
      //    message genuinely can't be delivered, so report the real outcome.
      //  - agent session ended but the org is alive (budget exhaustion,
      //    turn limit, crash-restart in flight): the result is still
      //    valuable, so persist it to the inbox. The boss-restart/next-run
      //    drainInbox will deliver it instead of the work vanishing.
      if (this.stopping.has(targetOrgName)) {
        src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'target mailbox closed (org shutting down)' });
        return `ERROR: recipient "${toQualified}" is shutting down — message not delivered`;
      }
      const q = queueMessage(this.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
      src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `recipient session closed — queued to inbox: ${subject}`, data: { queued: q } });
      return `queued to inbox for ${toQualified} (recipient session closed; will be delivered on restart)`;
    }
    // Track message chain: link this message to the target's last message (the one being responded to)
    const targetAgentSrc = targetOrg === src ? src?.agents.get(targetRole) : undefined;
    const parentId = targetAgentSrc?.lastMessageId;
    const evt = { from: cross ? `${fromOrg}:${fromRole}` : fromRole, to: toQualified, subject, msg: body, parentId };
    const emitted = src?.bus.emit({ type: cross ? 'xorg' : 'message', ...evt });
    if (cross && targetOrg !== src) targetOrg.bus.emit({ type: 'xorg', ...evt });
    // Store message ID for the target (so responses can link to it)
    if (targetAgentSrc && emitted) targetAgentSrc.lastMessageId = emitted.id;
    // Also track the source agent's last sent message for cross-org visibility
    const srcAgent = src?.agents.get(fromRole);
    if (srcAgent && emitted) srcAgent.lastMessageId = emitted.id;
    targetAgent.mailbox.push(this.mailBody(targetOrgName, targetOrg, `[message from ${evt.from}] subject: ${subject}`, body,
      emitted?.id ?? `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`));
    return `delivered to ${toQualified}`;
  }

  /** Cross-process leg of deliver(): ask the machine-local broker who hosts targetOrgName, then POST over HTTP.
   *  `to` here is always the fully-qualified "org:role" display form (resolveAddress already normalized it). */
  private async deliverRemote(
    fromOrg: string, fromRole: string, targetOrgName: string, targetRole: string,
    to: string, subject: string, body: string, src: RunningOrg | undefined,
  ): Promise<string> {
    const remote = lookupOrg(targetOrgName, this.opts.brokerDir);
    if (!remote) {
      // No remote host either — queue + auto-wake if the org def exists locally
      if (this.hasOrgDef(targetOrgName)) {
        const queued = queueMessage(this.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
        if (!queued) {
          src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `queue failed: ${subject}`, reason: 'queue-failed' });
          return `ERROR: could not queue message for ${to} (disk full or permissions)`;
        }
        src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body, data: { queued: true } });
        this.autoWake(targetOrgName);
        return `queued for ${to} (org starting)`;
      }
      // Check SSH remote host registry before giving up
      try {
        const { lookupRemoteOrg, deliverRemote: sshDeliver } = await import('./remote.js');
        const remoteHost = lookupRemoteOrg(targetOrgName, this.root);
        if (remoteHost) {
          const result = await sshDeliver(targetOrgName, `${fromOrg}:${fromRole}`, subject, body, remoteHost);
          if (result.ok) {
            src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body, data: { remote: 'ssh', host: remoteHost.host } });
            return `delivered to ${to} via SSH (${remoteHost.host})`;
          }
          src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `SSH delivery failed: ${result.output}`, reason: 'ssh-delivery-failed' });
          return `ERROR: SSH delivery to "${to}" on ${remoteHost.host} failed: ${result.output}`;
        }
      } catch { /* remote.ts unavailable or SSH not configured — fall through */ }
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
      return `ERROR: unknown recipient "${to}" (no local org, no process on this machine, and no SSH remote configured for "${targetOrgName}")`;
    }
    try {
      const res = await fetch(`${remote.url}/api/xdeliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(remote.credential ? { 'x-monomind-cred': remote.credential } : {}),
        },
        body: JSON.stringify({ fromOrg, fromRole, toOrg: targetOrgName, toRole: targetRole, subject, body }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; receipt?: string; error?: string };
      if (res.ok && data.ok) {
        src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body });
        return data.receipt ?? `delivered to ${to} (remote)`;
      }
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `remote delivery rejected: ${data.error ?? res.status}`, reason: 'remote-delivery-rejected' });
      return `ERROR: remote org "${to}" rejected delivery: ${data.error ?? res.status}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `remote delivery failed: ${message}`, reason: 'remote-delivery-failed' });
      return `ERROR: remote org "${targetOrgName}" unreachable: ${message}`;
    }
  }

  /** Inbound handler for cross-process delivery — called by the server's POST /api/xdeliver route
   *  when ANOTHER process's deliverRemote() reaches this daemon. Pushes straight into the target
   *  agent's mailbox; the agent picks it up on its own next turn (see Mailbox — never interrupts). */
  receiveRemote(
    toOrg: string, toRole: string, fromQualified: string, subject: string, body: string,
  ): { ok: true; receipt: string } | { ok: false; error: string } {
    const org = this.orgs.get(toOrg);
    if (!org) {
      // Org not running — queue the message and auto-wake if the def exists
      if (this.hasOrgDef(toOrg)) {
        const queued = queueMessage(this.root, toOrg, { fromQualified, toRole, subject, body, ts: Date.now() });
        if (!queued) {
          return { ok: false, error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)` };
        }
        this.autoWake(toOrg);
        return { ok: true, receipt: `queued for ${toOrg}:${toRole} (org waking)` };
      }
      return { ok: false, error: `org "${toOrg}" not hosted here` };
    }
    // Lazy-spawn pending roles on cross-process delivery (matches deliver/answerQuestion)
    // ATOMIC GUARD: Check spawning Set to prevent duplicate spawns from concurrent messages
    const spawning = this.spawning.get(toOrg) ?? new Set<string>();
    this.spawning.set(toOrg, spawning);
    if (!org.agents.has(toRole) && org.pendingRoles?.has(toRole) && !spawning.has(toRole)) {
      const role = org.pendingRoles.get(toRole)!;
      org.pendingRoles.delete(toRole);
      spawning.add(toRole); // Mark as spawning before async work
      // Resource gate check before spawning (prevents bypass in cross-process delivery)
      const check = checkResources();
      if (!check.ok) {
        spawning.delete(toRole); // Clear spawning flag after check
        org.bus.emit({ type: 'audit', from: toRole, reason: 'resource-pressure',
          msg: `cross-process lazy spawn deferred: ${check.reason}` });
        // B4 FIX: Queue the triggering message FIRST, then schedule spawn only if queue succeeds.
        // This matches the pattern in deliver() and prevents message loss if queue fails.
        const queued = queueMessage(this.root, toOrg, { fromQualified, toRole, subject, body, ts: Date.now() });
        if (!queued) {
          return { ok: false, error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)` };
        }
        this.scheduleDeferredSpawn(toOrg, org, role, org.spawnRole!);
        return { ok: true, receipt: `queued for ${toOrg}:${toRole} (role starting — waiting for resources)` };
      }
      org.spawnRole?.(role);
      spawning.delete(toRole); // Clear spawning flag after spawn completes
      org.bus.emit({ type: 'status', from: toRole, msg: `lazy-spawned on remote delivery from ${fromQualified}` });
    }
    const agent = org.agents.get(toRole);
    if (!agent) return { ok: false, error: `role "${toRole}" not found in org "${toOrg}"` };
    if (agent.status === 'crashed') return { ok: false, error: `role "${toRole}" in org "${toOrg}" crashed and will not recover this run` };
    if (agent.mailbox.isClosed) return { ok: false, error: `role "${toRole}" in org "${toOrg}" is shutting down` };
    const messageEvent = org.bus.emit({ type: 'xorg', from: fromQualified, to: `${toOrg}:${toRole}`, subject, msg: body });
    agent.lastMessageId = messageEvent.id; // Track last message ID for response threading
    agent.mailbox.push(this.mailBody(toOrg, org, `[message from ${fromQualified}] subject: ${subject}`, body, messageEvent.id));
    return { ok: true, receipt: `delivered to ${toOrg}:${toRole} (remote)` };
  }

  private hasOrgDef(name: string): boolean {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) return false;
    return existsSync(join(this.root, ORG_DIR, `${name}.json`));
  }

  private questionsPath(org: string): string {
    return join(this.root, ORG_DIR, org, 'questions.json');
  }

  private readQuestions(org: string): { questions: Array<{ questionId: string; role: string; question: string; ts: number; answer: string | null; answeredAt: number | null }> } {
    try { return JSON.parse(readFileSync(this.questionsPath(org), 'utf8')); } catch { return { questions: [] }; }
  }

  private writeQuestions(org: string, data: ReturnType<OrgDaemon['readQuestions']>): void {
    const dest = this.questionsPath(org);
    mkdirSync(join(this.root, ORG_DIR, org), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, dest);
  }

  // ── Decision gates ──────────────────────────────────────────────────────

  private gatesPath(org: string): string {
    return join(this.root, ORG_DIR, org, 'gates.json');
  }

  private readGates(org: string): { gates: DecisionGate[] } {
    try { return JSON.parse(readFileSync(this.gatesPath(org), 'utf8')); } catch { return { gates: [] }; }
  }

  private writeGates(org: string, data: { gates: DecisionGate[] }): void {
    const dest = this.gatesPath(org);
    mkdirSync(join(this.root, ORG_DIR, org), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, dest);
  }

  async createGate(org: string, role: string, name: string, description: string): Promise<string> {
    return this.withGatesLock(org, async () => {
      const running = this.orgs.get(org);
      const gateId = `gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const gate: DecisionGate = {
        id: gateId, name, description, roleId: role,
        status: 'pending', createdAt: Date.now(),
      };
      const data = this.readGates(org);
      data.gates.push(gate);
      this.writeGates(org, data);
      running?.bus.emit({ type: 'gate', from: role, data: { gateId, name, description } });
      return `Decision gate "${name}" created (id ${gateId}) — a human must approve or reject it before you proceed. End your turn and wait for the resolution.`;
    });
  }

  async resolveGate(org: string, gateId: string, approved: boolean, resolution?: string, resolvedBy?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.withGatesLock(org, async () => {
      const data = this.readGates(org);
      const idx = data.gates.findIndex(g => g.id === gateId);
      if (idx === -1) return { ok: false, error: `gate "${gateId}" not found for org "${org}"` };
      if (data.gates[idx].status !== 'pending') return { ok: false, error: `gate "${gateId}" already resolved (${data.gates[idx].status})` };

      data.gates[idx].status = approved ? 'approved' : 'rejected';
      data.gates[idx].resolvedAt = Date.now();
      data.gates[idx].resolvedBy = resolvedBy ?? 'human';
      data.gates[idx].resolution = resolution;
      this.writeGates(org, data);

      const running = this.orgs.get(org);
      const roleId = data.gates[idx].roleId;
      if (running) {
        running.bus.emit({
          type: 'gate', from: roleId,
          reason: approved ? 'gate-approved' : 'gate-rejected',
          data: { gateId, approved, resolution },
        });
        const agent = running.agents.get(roleId);
        if (agent && !agent.mailbox.isClosed) {
          const verb = approved ? 'approved' : 'rejected';
          const detail = resolution ?? (approved ? 'approved — proceed' : 'rejected — do not proceed');
          agent.mailbox.push(`[gate ${verb}] "${data.gates[idx].name}": ${detail}`);
        }
      }
      return { ok: true };
    });
  }

  listGates(org: string, status?: 'pending' | 'approved' | 'rejected'): DecisionGate[] {
    const data = this.readGates(org);
    return status ? data.gates.filter(g => g.status === status) : data.gates;
  }

  private dagCreateTask(org: string, role: string, title: string, assignee: string, deps: string[]): string {
    const running = this.orgs.get(org);
    if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
    try {
      const task = running.taskDag.add(title, assignee, deps);
      running.bus.emit({
        type: 'status', from: role, reason: 'task-created',
        msg: `task ${task.id} created: "${title}" → ${assignee}`,
        data: { taskId: task.id, assignee, deps, status: task.status },
      });
      if (task.status === 'ready') this.dispatchReadyTasks(org, running);
      return JSON.stringify(task);
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  private dagCompleteTask(org: string, role: string, taskId: string, result?: string): string {
    const running = this.orgs.get(org);
    if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
    try {
      running.taskDag.markRunning(taskId);
      const promoted = running.taskDag.complete(taskId, result);
      running.bus.emit({
        type: 'status', from: role, reason: 'task-done',
        msg: `task ${taskId} completed${promoted.length ? ` — ${promoted.map(t => t.id).join(', ')} now ready` : ''}`,
        data: { taskId, promoted: promoted.map(t => t.id) },
      });
      if (promoted.length > 0) this.dispatchReadyTasks(org, running);
      return JSON.stringify({ done: taskId, promoted: promoted.map(t => ({ id: t.id, title: t.title, assignee: t.assignee })) });
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  private dispatchReadyTasks(org: string, running: RunningOrg): void {
    if (!running.taskDag) return;
    for (const task of running.taskDag.ready()) {
      running.taskDag.markRunning(task.id);
      const agent = running.agents.get(task.assignee);
      if (agent) {
        agent.mailbox.push(`[task:${task.id}] ${task.title}`);
      } else if (running.pendingRoles?.has(task.assignee)) {
        const pending = running.pendingRoles.get(task.assignee)!;
        running.pendingRoles.delete(task.assignee);
        running.spawnRole?.(pending);
        setTimeout(() => {
          const spawned = running.agents.get(task.assignee);
          if (spawned) spawned.mailbox.push(`[task:${task.id}] ${task.title}`);
        }, 500);
      }
      running.bus.emit({
        type: 'status', from: 'dag', reason: 'task-dispatched',
        msg: `task ${task.id} dispatched to ${task.assignee}`,
        data: { taskId: task.id, assignee: task.assignee },
      });
    }
  }

  /** Check if an action requires human approval (beforeTool hook for guardrails). Returns
   *  the approval decision: true = approved, false = denied, null = pending (requires human input).
   *
   *  R5: serialized per-org via withApprovalLock() — concurrent checkApproval and
   *  setApproval calls previously raced on this.approvals + approvals.json. */
  private async checkApproval(org: string, role: string, action: string): Promise<boolean | null> {
    return this.withApprovalLock(org, async () => {
      const approvalKey = `${org}:${role}:${action}`;
      const pending = this.approvals.get(org) ?? [];
      const existing = pending.find(a => a.roleId === role && a.action === action);

      // If already approved/denied, return that decision
      if (existing && existing.approved !== null) return existing.approved;

      // Require human approval for sensitive actions
      const sensitiveActions = ['Bash', 'WebFetch', 'WebSearch', 'org_complete'];
      if (sensitiveActions.includes(action)) {
        // Queue for approval
        if (!existing) {
          pending.push({ roleId: role, action, question: `Approve ${action} tool call?`, ts: Date.now(), approved: null });
          this.approvals.set(org, pending);
        }
        // Persist to approvals.json (C4: atomic write)
        const approvalsPath = join(this.root, ORG_DIR, org, 'approvals.json');
        mkdirSync(join(this.root, ORG_DIR, org), { recursive: true });
        writeJsonFileAtomic(approvalsPath, { approvals: pending });

        // Emit a question event for the dashboard
        const running = this.orgs.get(org);
        running?.bus.emit({ type: 'question', from: role, data: { question: `Approval required for ${action}`, action } });
        return null; // Pending human approval
      }

      return true; // Auto-approved for non-sensitive actions
    });
  }

  /** Approve or deny a pending action (called by dashboard or CLI).
   *  R5: serialized per-org via withApprovalLock(). */
  async setApproval(org: string, role: string, action: string, approved: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.withApprovalLock(org, async () => {
      const pending = this.approvals.get(org) ?? [];
      const item = pending.find(a => a.roleId === role && a.action === action);

      if (!item) return { ok: false, error: `No pending approval found for ${role} action ${action}` };

      item.approved = approved;
      item.ts = Date.now();

      // Persist updated approval state (C4: atomic write)
      const approvalsPath = join(this.root, ORG_DIR, org, 'approvals.json');
      writeJsonFileAtomic(approvalsPath, { approvals: pending });

      // Notify the waiting agent via its mailbox
      const running = this.orgs.get(org);
      const agent = running?.agents.get(role);
      if (agent && !agent.mailbox.isClosed) {
        agent.mailbox.push(`[approval] ${action}: ${approved ? 'APPROVED' : 'DENIED'}`);
      }

      running?.bus.emit({ type: 'status', from: role, msg: `Approval ${approved ? 'granted' : 'denied'} for ${action}` });
      return { ok: true };
    });
  }

  /** R5: serialize approval mutations per org. Chains a Promise so concurrent
   *  callers run strictly in arrival order without blocking the daemon's
   *  event loop on unrelated orgs. Errors unwind the chain but don't poison
   *  future callers (the slot is reset to a resolved promise). */
  private withApprovalLock<T>(org: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.approvalLocks.get(org) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.approvalLocks.set(org, next.catch(() => { /* slot stays usable for the next caller */ }));
    return next;
  }

  /** Serialize gate mutations per org (same pattern as withApprovalLock).
   *  createGate and resolveGate race on gates.json without this. */
  private withGatesLock<T>(org: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.gatesLocks.get(org) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.gatesLocks.set(org, next.catch(() => { /* slot stays usable for the next caller */ }));
    return next;
  }

  /** Serialize question mutations per org (same pattern as withApprovalLock).
   *  askHuman and answerQuestion race on questions.json without this. */
  private withQuestionsLock<T>(org: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.questionsLocks.get(org) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.questionsLocks.set(org, next.catch(() => { /* slot stays usable for the next caller */ }));
    return next;
  }

  /** Time-travel debugging: replay from a specific checkpoint by run ID.
   *  Creates a fresh daemon instance and replays events from the target run's bus.jsonl. */
  async replayFrom(name: string, run: string): Promise<RunningOrg | null> {
    const runDir = join(this.root, ORG_DIR, name, run);
    if (!existsSync(runDir)) return null;

    const busFile = join(runDir, 'bus.jsonl');
    if (!existsSync(busFile)) return null;

    // Create a replay org with a fresh run ID
    const replayRun = `replay-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    const replayDir = join(this.root, ORG_DIR, name, replayRun);
    mkdirSync(replayDir, { recursive: true });

    // Read original events
    const events = readFileSync(busFile, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) as BusEvent; } catch { return null; } })
      .filter((e): e is BusEvent => e !== null);

    if (!events.length) return null;

    // Load org definition
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    if (!existsSync(defPath)) return null;

    const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));

    // Create replay bus
    const bus = new OrgBus(name, replayRun, replayDir);
    const MAX_COLLECTED = 1000;
    const collected: BusEvent[] = [];
    bus.subscribe(e => {
      const slim: BusEvent = e.data?.content != null
        ? { ...e, data: { ...e.data, content: undefined } }
        : e;
      collected.push(slim);
      if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
      for (const fn of this.globalSubscribers) fn(e);
    });

    const running: RunningOrg = { def, run: replayRun, bus, agents: new Map(), busEvents: () => [...collected] };

    // Reemit events into the replay bus with updated timestamps
    const startTime = Date.now();
    for (const e of events) {
      const replayEvent: BusEvent = { ...e, org: name, run: replayRun, ts: startTime };
      bus.emit(replayEvent);
    }

    this.orgs.set(name, running);
    bus.emit({ type: 'status', msg: `replay started from ${run} (${events.length} events replayed)` });
    this.persistState(name, 'running', replayRun);
    return running;
  }

  /** Agent-initiated human question (ask_human tool). Persists to questions.json (survives
   *  process/dashboard restarts) and emits a 'question' BusEvent so the dashboard's SSE
   *  stream and global inbox pick it up in real time. Returns a receipt string for the tool call.
   *  Serialized per-org via withQuestionsLock() (same TOCTOU pattern as approvals). */
  async askHuman(org: string, role: string, question: string): Promise<string> {
    return this.withQuestionsLock(org, async () => {
      const running = this.orgs.get(org);
      const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const data = this.readQuestions(org);
      data.questions.push({ questionId, role, question, ts: Date.now(), answer: null, answeredAt: null });
      this.writeQuestions(org, data);
      running?.bus.emit({ type: 'question', from: role, data: { questionId, question } });
      return `Question recorded (id ${questionId}) — a human will answer it; you'll receive the answer as a new message.`;
    });
  }

  /** Delivers a human's answer to a pending ask_human question. If the org is still
   *  running, pushes straight into the role's live mailbox (picked up on its very next
   *  generator tick — see Mailbox.stream()). If the org has since stopped, queues the
   *  answer via the same offline fallback deliver()/receiveRemote() already use
   *  (inbox.ts + autoWake) and it's delivered when the org next starts.
   *
   *  PERSIST-AFTER-DELIVERY: questions.json is only marked answered once delivery has
   *  actually happened (mailbox push, or the message landing in inbox.jsonl). Marking it
   *  first meant a rejected delivery — unknown role, mailbox closed mid-shutdown, a
   *  queueMessage that threw on a full/read-only disk — left the question recorded as
   *  answered while nobody ever received the answer, and the `already answered` guard
   *  then refused every retry. The answer was simply gone. The inverse failure (crash
   *  between delivery and the write) merely re-shows the question as pending, which a
   *  human can act on; a silently swallowed answer is not recoverable. */
  async answerQuestion(org: string, role: string, questionId: string, answer: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.withQuestionsLock(org, async () => {
      const data = this.readQuestions(org);
      const idx = data.questions.findIndex(q => q.questionId === questionId);
      if (idx === -1) return { ok: false, error: `question "${questionId}" not found for org "${org}"` };
      if (data.questions[idx].answer !== null) return { ok: false, error: `question "${questionId}" already answered` };
      const question = data.questions[idx].question;
      // Applied to questions.json ONLY after the delivery below succeeds.
      const markAnswered = (): void => {
        // Re-read so a question the daemon appended (or answered) meanwhile isn't
        // clobbered by this stale snapshot — merge by questionId, never replace.
        const fresh = this.readQuestions(org);
        const fIdx = fresh.questions.findIndex(q => q.questionId === questionId);
        if (fIdx === -1) fresh.questions.push({ ...data.questions[idx], answer, answeredAt: Date.now() });
        else fresh.questions[fIdx] = { ...fresh.questions[fIdx], answer, answeredAt: Date.now() };
        this.writeQuestions(org, fresh);
      };

      const running = this.orgs.get(org);
      if (running) {
        // Org IS running — deliver or report a real error, but never fall through to the
        // offline queue+autoWake path below: autoWake() no-ops when this.orgs already has
        // the org (see its own guard), so a role-specific delivery failure here (mailbox
        // closed, role unknown) would otherwise queue the answer forever with no real error
        // and no delivery. Mirrors deliver()'s existing "shutting down" error for the same
        // mid-shutdown-mailbox-closed race.
        // Spawn a lazily-deferred role before giving up on it. Roles are no longer
        // all spawned at boot, so `agents` legitimately lacks a role that simply
        // has not been needed yet — and rejecting on that dropped the human's
        // answer with "role not found" for a role that exists and is about to
        // run. deliver() does the same lookup; a human answer must not be the one
        // delivery path that cannot wake a role.
        if (!running.agents.has(role) && running.pendingRoles?.has(role)) {
          const pending = running.pendingRoles.get(role)!;
          running.pendingRoles.delete(role);
          running.spawnRole?.(pending);
        }
        const agent = running.agents.get(role);
        if (!agent) return { ok: false, error: `role "${role}" not found in org "${org}"` };
        if (agent.mailbox.isClosed) return { ok: false, error: `role "${role}" in org "${org}" is shutting down — answer not delivered` };
        try {
          agent.mailbox.push(`[answer from human] question: ${question}\n\nanswer: ${answer}`);
        } catch (err) {
          return { ok: false, error: `delivery to "${role}" in org "${org}" failed — answer not recorded (${err instanceof Error ? err.message : String(err)})` };
        }
        markAnswered();
        running.bus.emit({ type: 'status', from: role, msg: 'question answered', data: { questionId } });
        return { ok: true };
      }
      // Org not running at all — queue for delivery on next start, matching deliver()'s
      // existing offline fallback exactly (inbox.ts + autoWake).
      if (!this.hasOrgDef(org)) return { ok: false, error: `org "${org}" not found (no saved definition)` };
      const queued = queueMessage(this.root, org, {
        fromQualified: 'human', toRole: role,
        subject: `answer:${questionId}`,
        body: `question: ${question}\n\nanswer: ${answer}`,
        ts: Date.now(),
      });
      if (!queued) {
        return { ok: false, error: `could not queue answer for org "${org}" — answer not recorded (disk full or permissions)` };
      }
      markAnswered();
      this.autoWake(org);
      return { ok: true };
    });
  }

  /** Start an offline org in the background so queued messages get drained.
   *  Fire-and-forget — errors are logged but don't propagate to the sender. */
  private autoWake(name: string): void {
    if (this.orgs.has(name) || this.waking.has(name)) return;
    this.waking.add(name);
    this.startOrg(name)
      .catch(err => { console.error(`auto-wake org "${name}" failed:`, err instanceof Error ? err.message : err); })
      .finally(() => { this.waking.delete(name); });
  }

  /** #4: bounded whole-org restart after the boss terminally crashes. Stops the
   *  dead run and re-launches it with fresh sessions (shedding any bloated
   *  context). Capped at MAX_BOSS_RESTARTS per explicit start so a crashing boss
   *  can't loop forever; beyond the cap it gives up and lets the idle watchdog
   *  shut the run down for a human. */
  private scheduleBossRestart(name: string): void {
    if (this.stopping.has(name) || this.restarting.has(name)) return;
    const count = this.bossRestartCounts.get(name) ?? 0;
    const bus = this.orgs.get(name)?.bus;
    if (count >= OrgDaemon.MAX_BOSS_RESTARTS) {
      bus?.emit({ type: 'audit', reason: 'boss-restart-exhausted',
        msg: `boss crashed again after ${count} auto-restart(s) — giving up; manual restart required` });
      return;
    }
    const backoffSchedule = this.opts.bossRestartBackoffMs ?? OrgDaemon.BOSS_RESTART_BACKOFF_MS;
    const backoff = backoffSchedule[Math.min(count, backoffSchedule.length - 1)];
    this.bossRestartCounts.set(name, count + 1);
    this.restarting.add(name);
    bus?.emit({ type: 'audit', reason: 'boss-restart',
      msg: `boss crashed — auto-restarting org with fresh sessions in ${Math.round(backoff / 1000)}s (attempt ${count + 1}/${OrgDaemon.MAX_BOSS_RESTARTS})` });
    const t = setTimeout(() => {
      if (this.stopping.has(name)) { this.restarting.delete(name); return; } // a manual stop won
      this.stopOrg(name)
        .then(() => (this.stopping.has(name) ? null : this.startOrg(name)))
        .then(() => { this.restarting.delete(name); })
        .catch(err => { this.restarting.delete(name); console.error(`org ${name}: boss auto-restart failed:`, err instanceof Error ? err.message : err); });
    }, backoff);
    (t as { unref?: () => void }).unref?.();
  }

  /** @param opts.drainMs how long to let in-flight agent sessions finish before
   *  reaping. Defaults to the short abort bound; the planned-completion path
   *  passes a far longer window (see COMPLETE_DRAIN_MS). */
  async stopOrg(name: string, opts?: { drainMs?: number }): Promise<void> {
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
    const p = this.finishStop(name, org, opts?.drainMs);
    this.stopping.set(name, p);
    try { await p; } finally { this.stopping.delete(name); }
  }

  private async finishStop(name: string, org: RunningOrg, drainMs?: number): Promise<void> {
    // Snapshot checkpoint BEFORE closing mailboxes / draining sessions — the
    // queue is emptied during the drain, so capturing afterwards loses all
    // unconsumed messages (the whole point of checkpoint-resume).
    const stopCheckpoint = captureCheckpoint(org);
    // Capture THIS run's forwarder now: an autoWake-restart of the same org
    // during the long tail below (agent wait, flush, history write) would
    // register a NEW forwarder under the same name — settling/unsubscribing
    // that one would sever the new run's dashboard stream.
    const forwarder = this.forwarders.get(name);
    // Remove crash-cleanup handler — normal stop handles reaping itself
    const cleanup = (org as RunningOrg & { _crashCleanup?: () => void })._crashCleanup;
    if (cleanup) process.removeListener('exit', cleanup);
    const wd = this.watchdogs.get(name);
    if (wd) { clearInterval(wd); this.watchdogs.delete(name); }
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
    const allDone = Promise.allSettled([...org.agents.values()].map(a => a.done)).then(() => false);
    const timedOut = await Promise.race([allDone, new Promise<boolean>(r => setTimeout(() => r(true), stopWaitMs))]);
    if (timedOut) {
      org.bus.emit({
        type: 'audit', msg: `org stop timed out after ${stopWaitMs}ms waiting for agent sessions to finish — proceeding anyway`,
        reason: 'stop-timeout',
      });
      // Reap only SDK processes spawned by THIS node process — ownerPid filter
      // ensures other `monomind org run` daemons' agents are untouched.
      try {
        const reaped = reapOrphanedSdkProcesses(new Set(), process.pid);
        if (reaped > 0) org.bus.emit({ type: 'audit', reason: 'orphan-reap', msg: `reaped ${reaped} orphaned SDK process(es) after stop timeout` });
      } catch { /* best-effort */ }
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
      console.error(`org ${name}: could not write run history:`, err instanceof Error ? err.message : err);
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
        new Promise<void>(r => { const t = setTimeout(r, 5_000); (t as { unref?: () => void }).unref?.(); }),
      ]);
      forwarder.unsubscribe();
      // Only remove from the map if it's still OURS — an autoWake-restart may
      // have registered the new run's forwarder under this name meanwhile.
      if (this.forwarders.get(name) === forwarder) this.forwarders.delete(name);
    }
    // Same guard for runtime.json: if a new run started during shutdown, its
    // 'running' record must not be overwritten with this old run's 'stopped'.
    // Pass the org directly since we already removed it from the map.
    if (!this.orgs.has(name)) this.persistState(name, 'stopped', org.run, org, stopCheckpoint);
    // Clean up git worktrees — shared (workspace: 'worktree') and per-role.
    try {
      const { execSync } = await import('node:child_process');
      if (org.worktreePath) {
        try { execSync(`git worktree remove --force "${org.worktreePath}"`, { cwd: this.root, stdio: 'ignore', timeout: 30_000 }); } catch { /* best-effort */ }
      }
      for (const agent of org.agents.values()) {
        if (agent.worktreePath) {
          try { execSync(`git worktree remove --force "${agent.worktreePath}"`, { cwd: this.root, stdio: 'ignore', timeout: 30_000 }); } catch { /* best-effort */ }
        }
      }
    } catch { /* node:child_process unavailable — skip */ }
  }

  async stopAll(): Promise<void> {
    await Promise.all([
      ...[...this.orgs.keys()].map(n => this.stopOrg(n)),
      ...this.stopping.values(), // detached self-stops still flushing
    ]);
  }

  private orgMemoryNamespace(name: string, def: OrgDef): string {
    return def.run_config.memory_namespace ?? `org:${name}`;
  }

  /** Store dir for org cross-run memory — inside the org root so the bridge's
   *  path guard accepts it when the daemon runs from the project (the normal
   *  case) and test roots stay isolated. */
  private orgMemoryDbPath(): string {
    return join(this.root, '.monomind', 'org-memory');
  }

  /** The memory bridge's traversal guard silently redirects out-of-tree paths
   *  to the per-project default store. For an org rooted outside cwd (tests,
   *  unusual daemon setups) that redirect would write into the WRONG project's
   *  memory — verify the guard kept our path, and skip org memory otherwise. */
  private async orgMemoryUsable(): Promise<boolean> {
    try {
      const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      const want = this.orgMemoryDbPath();
      const got = bridgeGetDbPath(want);
      const { realpathSync } = await import('node:fs');
      const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
      return real(got) === real(want);
    } catch { return false; }
  }

  /** Namespace for a role's PRIVATE memories, inside the org memory DB. */
  private agentMemoryNamespace(name: string, def: OrgDef, role: string): string {
    return `agent:${this.orgMemoryNamespace(name, def)}:${role}`;
  }

  /** org_remember implementation: a deliberate write to org-shared or
   *  role-private memory (both in the org memory DB, split by namespace). */
  private async rememberOrgMemory(name: string, def: OrgDef, role: string, content: string, scope: 'org' | 'agent', run: string): Promise<string> {
    try {
      if (!(await this.orgMemoryUsable())) return 'org memory is not available in this environment.';
      const { bridgeStoreEntry } = await import('../memory/memory-bridge.js');
      const namespace = scope === 'agent' ? this.agentMemoryNamespace(name, def, role) : this.orgMemoryNamespace(name, def);
      const res = await bridgeStoreEntry({
        key: `mem-${run}-${Date.now().toString(36)}`,
        value: content.slice(0, 20_000),
        namespace,
        dbPath: this.orgMemoryDbPath(),
        tags: [scope, role],
        metadata: { origin_refs: [`run:${run}`], by: role },
      });
      if (res?.duplicate) return `Already remembered (near-duplicate exists) — reinforced instead.`;
      return res?.success ? `Remembered (${scope} scope).` : `Could not store memory${res?.error ? `: ${res.error}` : ''}.`;
    } catch (err) {
      return `org_remember failed (${err instanceof Error ? err.message : 'error'})`;
    }
  }

  /** Entry IDs served by org_recall during the current run, per org. This is
   *  the usage record the run-outcome auto-rating consumes (cognee's
   *  used_graph_element_ids pattern) — recall renders text to the agent, so
   *  the IDs must be captured here or they're gone. */
  private recallUsage = new Map<string, Set<string>>();

  /** org_recall implementation: search the org's memory namespace via the
   *  memory bridge (semantic when the local model is available, tokenized
   *  keyword otherwise). Failures return a message, never throw into the tool. */
  private async recallOrgMemory(name: string, def: OrgDef, query: string, role?: string): Promise<{ text: string; hits: number }> {
    try {
      if (!(await this.orgMemoryUsable())) return { text: 'org memory is not available in this environment.', hits: 0 };
      const bridge = await import('../memory/memory-bridge.js');
      // Shared org memory plus the caller's private agent scope, merged by score.
      const [shared, priv] = await Promise.all([
        bridge.bridgeSearchEntries({
          query, namespace: this.orgMemoryNamespace(name, def), limit: 5, dbPath: this.orgMemoryDbPath(),
        }),
        role ? bridge.bridgeSearchEntries({
          query, namespace: this.agentMemoryNamespace(name, def, role), limit: 3, dbPath: this.orgMemoryDbPath(),
        }) : null,
      ]);
      const results = [
        ...(shared?.results ?? []),
        ...(priv?.results ?? []).map(r => ({ ...r, key: `${r.key} (private)` })),
      ].sort((a, b) => b.score - a.score).slice(0, 6);
      if (!results.length) return { text: 'No matching org memory found — this may be the first run covering this topic.', hits: 0 };
      const ids = results.map(r => r.id).filter(Boolean);
      let used = this.recallUsage.get(name);
      if (!used) { used = new Set(); this.recallUsage.set(name, used); }
      for (const id of ids) used.add(id);
      // Frequency reinforcement is immediate; the feedback rating waits for the
      // run outcome (positive-only — see storeRunMemory).
      bridge.bridgeRecordUsage({ entryIds: ids, dbPath: this.orgMemoryDbPath() }).catch(() => { /* best effort */ });
      let text = results.map((r, i) => `${i + 1}. [${r.key}] ${r.content.slice(0, 500)}`).join('\n\n');
      // Structured knowledge: relationship triplets from the org KG, when any.
      try {
        const kg = await import('../memory/memory-kg.js');
        const graph = await kg.kgSearch({ query, dbPath: this.orgMemoryDbPath(), limit: 5 });
        if (graph.context) text += `\n\nKnowledge graph:\n${graph.context.slice(0, 1024)}`;
      } catch { /* best effort */ }
      return { text, hits: results.length };
    } catch (err) {
      return { text: `org memory unavailable (${err instanceof Error ? err.message : 'error'})`, hits: 0 };
    }
  }

  /** knowledge_search implementation for org agents: the user's Second Brain
   *  (this project's documents + the personal global brain), merged with the
   *  same project-first ranking every other surface uses. Failures return a
   *  message, never throw into the tool call. */
  async searchProjectKnowledge(query: string): Promise<{ text: string; hits: number }> {
    try {
      const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
      const excerpts = await searchKnowledge(query, { rootDir: this.root, limit: 3, store: 'all' });
      if (!excerpts.length) return { text: 'No matching documents in the Second Brain for that query.', hits: 0 };
      const text = excerpts.map((e, i) =>
        `${i + 1}. [${e.filePath || 'unknown'}${e.scope === 'global' ? ' · global' : ''}] (${e.similarity.toFixed(2)})\n${e.text.slice(0, 400)}`
      ).join('\n\n');
      return { text, hits: excerpts.length };
    } catch (err) {
      return { text: `knowledge search unavailable (${err instanceof Error ? err.message : 'error'})`, hits: 0 };
    }
  }

  /** org_learn implementation: merge coordinator-extracted entities/relations/
   *  rules into the org's knowledge graph (LLM extraction happens inside the
   *  agent's own subscription-auth SDK session — no separate LLM call here). */
  private orgLearnedRuns = new Set<string>();
  private async learnOrgKnowledge(name: string, run: string, payload: { nodes?: unknown[]; edges?: unknown[]; rules?: unknown[] }): Promise<string> {
    try {
      if (!(await this.orgMemoryUsable())) return 'org memory is not available in this environment.';
      const kg = await import('../memory/memory-kg.js');
      const dbPath = this.orgMemoryDbPath();
      const originRef = `run:${run}`;
      const graph = await kg.kgIngest({
        nodes: (payload.nodes ?? []) as import('../memory/memory-kg.js').KgNodeInput[],
        edges: (payload.edges ?? []) as import('../memory/memory-kg.js').KgEdgeInput[],
        originRef, dbPath,
      });
      const rules = Array.isArray(payload.rules) && payload.rules.length
        ? await kg.kgIngestRules({ rules: payload.rules as { rule: string; context?: string }[], originRef, dbPath })
        : null;
      this.orgLearnedRuns.add(`${name}:${run}`);
      const parts = [
        `entities: +${graph.nodesAdded} new, ${graph.nodesMerged} merged`,
        `relations: +${graph.edgesAdded} new, ${graph.edgesMerged} merged`,
      ];
      if (rules) parts.push(`rules: ${rules.accepted} accepted, ${rules.verdicts.filter(v => v.verdict === 'already_known').length} already known`);
      return `Recorded in org knowledge graph — ${parts.join('; ')}. Rollback ref: ${originRef}.`;
    } catch (err) {
      return `org_learn failed (${err instanceof Error ? err.message : 'error'})`;
    }
  }

  /** Persist the run's outcome into cross-run org memory so org_recall (and
   *  future runs) can find it by meaning, not just recency. Best-effort. */
  private async storeRunMemory(name: string, def: OrgDef, run: string, summary: import('./reporting.js').RunSummary): Promise<void> {
    try {
      if (!(await this.orgMemoryUsable())) return;
      const { bridgeStoreEntry } = await import('../memory/memory-bridge.js');
      const when = summary.endedAt ? new Date(summary.endedAt).toISOString().slice(0, 10) : '';
      const lines = [
        `Org run ${run}${when ? ` (${when})` : ''} — goal: ${def.goal}`,
        summary.outcome
          ? `Outcome: ${summary.outcome.status} — ${summary.outcome.summary}`
          : `Outcome: not recorded (${summary.messages} messages exchanged)`,
        summary.assets.length ? `Assets produced: ${summary.assets.slice(0, 10).join(', ')}` : '',
        summary.crashes.length ? `Crashed agents: ${summary.crashes.join(', ')}` : '',
      ].filter(Boolean);
      await bridgeStoreEntry({
        key: `run-${run}`,
        value: lines.join('\n'),
        namespace: this.orgMemoryNamespace(name, def),
        dbPath: this.orgMemoryDbPath(),
        upsert: true,
      });

      // Heuristic KG fallback: if the coordinator never called org_learn this
      // run, extract lower-trust entities from the outcome summary so the
      // graph still accumulates something. LLM-quality extraction only comes
      // from org_learn (the agent's own session).
      if (!this.orgLearnedRuns.delete(`${name}:${run}`)) {
        try {
          const kg = await import('../memory/memory-kg.js');
          const extracted = kg.heuristicExtract(lines.join('\n'), { sourceName: `run:${run}` });
          if (extracted.nodes.length) {
            await kg.kgIngest({ ...extracted, originRef: `run:${run}`, dbPath: this.orgMemoryDbPath() });
          }
        } catch { /* best effort */ }
      }

      // Auto-rate the memories this run recalled — POSITIVE-ONLY: a failed run
      // proves nothing about the recalled memories (the failure may be entirely
      // unrelated), so failure never rates them down. Idempotent per run via
      // the feedback ledger, so a retried stopOrg can't double-apply.
      const used = this.recallUsage.get(name);
      this.recallUsage.delete(name);
      if (used?.size && summary.outcome?.status === 'achieved') {
        const { bridgeApplyFeedback } = await import('../memory/memory-bridge.js');
        await bridgeApplyFeedback({
          entryIds: [...used],
          score: 0.9,
          ledgerKey: `org-${name}-${run}`,
          dbPath: this.orgMemoryDbPath(),
        }).catch(() => { /* best effort */ });
      }
    } catch (err) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error(`org ${name}: run memory store failed:`, err instanceof Error ? err.message : err);
    }
  }

  /** Resume a previous run from its checkpoint (runtime.json state). Reconstructs
   *  the org's agents and mailboxes from the persisted state, enabling time-travel
   *  debugging and run recovery after crashes. Returns the resumed RunningOrg or null.
   *  Pattern 3: Full state restoration including mailbox queues, policy counters,
   *  and session state with TTL and validation. */
  async resumeOrg(name: string): Promise<RunningOrg | null> {
    const rtPath = join(this.root, ORG_DIR, name, 'runtime.json');
    if (!existsSync(rtPath)) {
      console.error('resumeOrg failed: runtime.json missing for', name);
      return null;
    }

    interface RuntimeState {
      status?: string;
      run?: string;
      checkpoint?: OrgCheckpoint;
      abandonedRoles?: string[];
    }

    let rt: RuntimeState | undefined;
    try {
      rt = JSON.parse(readFileSync(rtPath, 'utf8'));
    } catch (err) {
      console.error('resumeOrg failed: invalid JSON in runtime.json for', name, err instanceof Error ? err.message : err);
      return null;
    }

    // Allow resume from 'stopped' orgs - the checkpoint contains the running state to restore
    if (!rt?.run || !rt?.checkpoint) {
      console.error('resumeOrg failed: invalid runtime state for', name, 'status:', rt?.status, 'run:', rt?.run, 'checkpoint:', !!rt?.checkpoint);
      return null;
    }

    // Pattern 3: Checkpoint TTL validation - expire stale checkpoints
    if (rt.checkpoint && isCheckpointExpired(rt.checkpoint)) {
      console.error('resumeOrg failed: checkpoint expired for', name, 'updated:', rt.checkpoint.updated);
      return null;
    }

    // Pattern 3: Checksum validation - detect corrupted state
    if (rt.checkpoint && !validateCheckpoint(rt.checkpoint)) {
      console.error('resumeOrg failed: checkpoint validation failed for', name);
      return null;
    }

    // Load the org definition
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    if (!existsSync(defPath)) {
      console.error('resumeOrg failed: org definition missing for', name);
      return null;
    }

    const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
    const dir = join(this.root, ORG_DIR, name, rt.run);

    // Check if run directory exists
    if (!existsSync(dir)) {
      console.error('resumeOrg failed: run directory missing', dir);
      return null;
    }

    // Reconstruct the bus from history
    const bus = new OrgBus(name, rt.run, dir);
    const MAX_COLLECTED = 1000;
    const collected: BusEvent[] = [];
    bus.subscribe(e => {
      const slim: BusEvent = e.data?.content != null
        ? { ...e, data: { ...e.data, content: undefined } }
        : e;
      collected.push(slim);
      if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
      for (const fn of this.globalSubscribers) fn(e);
    });

    const running: RunningOrg = { def, run: rt.run, bus, agents: new Map(), busEvents: () => [...collected] };

    // Pattern 3: Full checkpoint restoration - reconstruct agents with complete state
    if (rt.checkpoint) {
      const checkpoint = rt.checkpoint;

      // Reconstruct each role from checkpoint state
      for (const [roleId, roleState] of Object.entries(checkpoint.roleState)) {
        const role = def.roles.find(r => r.id === roleId);
        if (!role) continue; // Role no longer exists in org definition

        const mailbox = new Mailbox();
        const perRoleBudget = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
        const policy = new PolicyEngine(roleId, { maxTokens: perRoleBudget, ...(role.policy ?? {}) }, bus, this.root);

        const runtime: AgentRuntime = {
          mailbox,
          policy,
          status: roleState.status,
          done: Promise.resolve(),
          metrics: { tokens: roleState.tokensUsed, costUsd: roleState.costUsd },
          lastMessageId: roleState.lastMessageId,
          error: roleState.error,
          scrollback: new ScrollbackBuffer(),
        };

        // Restore scrollback from checkpoint if available
        if (roleState.scrollback?.length) {
          for (const line of roleState.scrollback) runtime.scrollback.push(line);
        }

        // Pattern 3: Restore mailbox queue content (not just closed state)
        if (roleState.mailboxQueue.length > 0) {
          restoreMailboxQueue(runtime, roleState.mailboxQueue);
        }

        // Pattern 3: Restore mailbox closed state
        if (roleState.mailboxClosed) {
          mailbox.close();
        }

        // Pattern 3: Restore policy usage counters
        if (roleState.tokensUsed > 0) {
          policy.setUsage(roleState.tokensUsed);
        }

        running.agents.set(roleId, runtime);
      }

      // Set up pending roles for lazy spawn (roles not in checkpoint)
      const reconstructedRoles = new Set(Object.keys(checkpoint.roleState));
      const pendingRoles = new Map<string, OrgRole>();
      for (const role of def.roles) {
        if (!reconstructedRoles.has(role.id)) {
          pendingRoles.set(role.id, role);
        }
      }
      if (pendingRoles.size > 0) {
        running.pendingRoles = pendingRoles;
      }
    }

    // Restore abandoned roles tracking
    if (rt.abandonedRoles) {
      this.abandoned.set(name, new Set(rt.abandonedRoles));
    }

    this.orgs.set(name, running);
    bus.emit({ type: 'status', msg: `org resumed from checkpoint (${rt.run})` });
    this.persistState(name, 'running', rt.run);
    return running;
  }

  /** Create a branch from a checkpoint for "what-if" experiments */
  branchCheckpoint(name: string, run: string, branchName: string): { ok: true; branchRun: string } | { ok: false; error: string } {
    const runDir = join(this.root, ORG_DIR, name, run);
    if (!existsSync(runDir)) {
      return { ok: false, error: `run ${run} not found for org ${name}` };
    }

    const branchRun = `branch-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    const branchDir = join(this.root, ORG_DIR, name, branchRun);

    try {
      mkdirSync(branchDir, { recursive: true });
      // Copy bus.jsonl to branch (C4: atomic — partial copy on crash leaves
      // a branch that can't replay its event log).
      const busFile = join(runDir, 'bus.jsonl');
      if (existsSync(busFile)) {
        const busContent = readFileSync(busFile, 'utf8');
        const branchBusFile = join(branchDir, 'bus.jsonl');
        // Atomic write for raw (non-JSON) content: tmp + rename.
        const tmp = `${branchBusFile}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, busContent, 'utf8');
        renameSync(tmp, branchBusFile);
      }
      // Create branch marker file (atomic)
      writeJsonFileAtomic(join(branchDir, '.branch-source'), { from: run, branchedAt: new Date().toISOString() });
      return { ok: true, branchRun };
    } catch (err) {
      return { ok: false, error: `failed to create branch: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Record a structured decision trace for Rifft-style debugging */
  recordDecision(org: string, role: string, decision: {
    type: 'tool' | 'handoff' | 'approval' | 'routing';
    context: string;
    reasoning: string;
    alternatives?: Array<{ choice: string; score: number; reason: string }>;
    outcome: string;
  }): void {
    const running = this.orgs.get(org);
    if (!running) return;

    running.bus.emit({
      type: 'audit',
      from: role,
      reason: 'decision-trace',
      data: {
        decisionType: decision.type,
        context: decision.context,
        reasoning: decision.reasoning,
        alternatives: decision.alternatives,
        outcome: decision.outcome,
        ts: new Date().toISOString()
      },
    });
  }

  /** Roles that never spawned, per org. An org missing a role is still reported
   *  `running` by every status path, so the absence was visible only as one
   *  audit line in the log — a run went 40 minutes with no tester and nothing
   *  said so. Persisted to runtime.json so `org status` can say it out loud. */
  private abandoned = new Map<string, Set<string>>();

  private persistState(name: string, status: string, run: string, org?: RunningOrg, checkpointOverride?: OrgCheckpoint | null): void {
    const p = join(this.root, ORG_DIR, name, 'runtime.json');
    const missing = [...(this.abandoned.get(name) ?? [])];
    const running = org ?? this.orgs.get(name);
    // Pattern 3: Capture full checkpoint state for resume. On stop, finishStop
    // passes a snapshot captured BEFORE mailboxes close and sessions drain —
    // otherwise the queue is always empty by persist time.
    let checkpoint: OrgCheckpoint | null = checkpointOverride ?? null;
    if (running) {
      checkpoint = captureCheckpoint(running);
    }
    // C4: writeJsonFileAtomic (tmp + rename) — a direct writeFileSync here
    // could leave runtime.json truncated on Ctrl-C during `org stop`, which
    // would brick every subsequent `org status` / isOrgRunning / scheduler
    // call. The state files in 6 other daemon paths already use this helper.
    writeJsonFileAtomic(p, {
      status, run, pid: process.pid, updated: new Date().toISOString(),
      ...(missing.length ? { abandonedRoles: missing } : {}),
      ...(checkpoint ? { checkpoint } : {}),
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
          status: 'crashed', run: org.run, pid: process.pid,
          updated: new Date().toISOString(), closedBy: 'crash-handler',
        });
      } catch { /* best effort — filesystem may be unavailable */ }
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
        pid: process.pid, updatedAt: new Date().toISOString(),
        running: this.listRunning(),
      });
    } catch { /* best effort */ }
  }

  clearHeartbeat(): void {
    try { unlinkSync(this.heartbeatPath()); }
    catch { /* already gone or never written */ }
  }
}
