// packages/@monomind/cli/src/orgrt/org-start.ts
// Extracted from daemon.ts — starting an org run: the reservation guard
// (startOrg) and the run setup it protects (startOrgInner).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { reapOrphanedSdkProcesses } from '../utils/resource-governor.js';
import { onBudgetBusEvent } from './budget-closure.js';
import { OrgBus } from './bus.js';
import type { RoleCheckpoint } from './checkpoint.js';
import type { OrgDaemon } from './daemon.js';
import type { RunningOrg } from './daemon-types.js';
import * as decisionOps from './decisions.js';
import { agentRoles, isEndpointRole } from './endpoint-roles.js';
import { attachForwarder } from './forwarder.js';
import * as idleWatchdog from './idle-watchdog.js';
import * as orgMemory from './org-memory.js';
import * as startSteps from './org-start-steps.js';
import { readHistory } from './reporting.js';
import { mergeEffectiveRoleConfig, type RoleOverrides } from './role-slot.js';
import { sweepStaleRoleTmpdirs } from './role-tmpdir.js';
import { SessionLedger } from './session-ledger.js';
import { TaskDag } from './task-dag.js';
import type { BusEvent, OrgRole } from './types.js';

/** Drain window for a PLANNED stop (the boss called org_complete). Long enough
 *  for a sibling mid-build or mid-test to finish and flush its work. A hard
 *  stop keeps the short bound — see finishStop. */
const COMPLETE_DRAIN_MS = 5 * 60_000;

export async function startOrg(
  daemon: OrgDaemon,
  name: string,
  taskOverride?: string,
  options?: { resume?: boolean; autoApprove?: string[]; evalGate?: boolean },
): Promise<RunningOrg> {
  // A restart-driven start (scheduleBossRestart) keeps its crash counter so the
  // cap holds; any other (explicit) start resets it so a manual re-run gets a
  // fresh budget.
  if (!daemon.restarting.has(name)) daemon.bossRestartCounts.delete(name);
  // Join any in-flight stop for this org before checking `this.orgs` — otherwise a
  // start racing a stop's drain window (up to stopWaitMs) can share the stopping
  // run's worktree path while it's still being force-removed.
  const inflightStop = daemon.stopping.get(name);
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
  if (daemon.orgs.has(name)) throw new Error(`org ${name} already running`);
  if (daemon.startingOrgs.has(name)) throw new Error(`org ${name} already starting`);
  daemon.startingOrgs.add(name);
  // #345: the run's --auto-approve list — kept by a boss auto-restart like
  // the crash counter, replaced by any other start. Set only after the
  // guards above, so a rejected start can't rewrite a live run's list.
  if (!daemon.restarting.has(name)) {
    if (options?.autoApprove?.length) daemon.runAutoApprove.set(name, options.autoApprove);
    else daemon.runAutoApprove.delete(name);
  }
  try {
    return await startOrgInner(daemon, name, taskOverride, options);
  } catch (err) {
    // startOrgInner registers the org in `this.orgs` (and spawns the boss,
    // installs the exit listener, starts the broker lease) well before it
    // returns; persistState (ENOSPC/EACCES) and BrokerLease.start() can
    // still throw after that. Left alone, that was a live, unreachable org:
    // sessions running, `this.orgs` still holding it, every later startOrg
    // rejected with "already running", and nothing ever calling stopOrg.
    // Only this call can have registered the name (the reservation above
    // holds until `finally`), so anything in the map is ours to tear down.
    if (daemon.orgs.has(name)) {
      // #302: tag the real cause so a run's history/report can never read
      // this as a boss-attributed outcome — nothing here asked the boss.
      await daemon
        .stopOrg(name, { closedBy: 'failed-start' })
        .catch((stopErr) =>
          console.error(
            `org ${name}: teardown after failed start failed:`,
            stopErr instanceof Error ? stopErr.message : stopErr,
          ),
        );
    }
    throw err;
  } finally {
    daemon.startingOrgs.delete(name);
  }
}

/** The actual startOrg implementation. Split out of startOrg() so the
 *  reservation guard above runs synchronously, before any `await` in here —
 *  see the bug 2 comment in startOrg(). */
async function startOrgInner(
  daemon: OrgDaemon,
  name: string,
  taskOverride?: string,
  options?: { resume?: boolean; autoApprove?: string[]; evalGate?: boolean },
): Promise<RunningOrg> {
  const { def, run, checkpoint, dir, cwd, worktreePath, checklistWarnings, documents } =
    await startSteps.prepareOrgStart(daemon, name, options);
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
  bus.subscribe((e) => {
    const slim: BusEvent =
      e.data?.content != null ? { ...e, data: { ...e.data, content: undefined } } : e;
    collected.push(slim);
    if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
    // The watchdog's own events must not count as org activity, or a hung
    // boss would never trip the "nudge produced no activity" stop and a
    // silent role would clear its own no-progress alarm.
    const selfEmitted = /^(idle-nudge|no-progress|hold-expired|lead-watch)$/.test(e.reason ?? '');
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
        daemon
          .stopOrg(name, { drainMs: COMPLETE_DRAIN_MS, closedBy: 'org-complete' })
          .catch((err) =>
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
        // A null/missing cost is unknown, not $0: metrics.costUsd stays null
        // until a real cost arrives (rev 28).
        const cost = (e.data as { cost_usd?: number | null }).cost_usd;
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          runtime.metrics.costUsd = (runtime.metrics.costUsd ?? 0) + cost;
        }
      }
    }
    // Bug 1 / #343: enforce the org-wide run_config.budget_tokens ceiling,
    // hold a budget-closed role's tasks, warn near a budget.
    onBudgetBusEvent(running, e);
    // Track last message ID for threading responses
    if ((e.type === 'message' || e.type === 'xorg') && e.from) {
      const runtime = running.agents.get(e.from);
      if (runtime) {
        runtime.lastMessageId = e.id;
      }
    }
    // Apply audit filter if configured (skip filtered tool events before forwarding)
    if (daemon.opts.auditFilter && e.type === 'tool') {
      const { tool, decision } = daemon.opts.auditFilter;
      if (tool && e.tool !== tool) return; // Skip: tool name doesn't match
      if (decision && e.decision !== decision) return; // Skip: decision doesn't match
    }
    for (const fn of daemon.globalSubscribers) fn(e);
  });
  if (daemon.opts.forward !== false)
    daemon.forwarders.set(
      name,
      attachForwarder(bus, daemon.opts.controlJson ?? join(daemon.root, '.monomind/control.json')),
    );

  const running: RunningOrg = {
    def,
    run,
    sessionLedger: new SessionLedger(join(dir, 'sessions.json')),
    gates: decisionOps.readGates(daemon.root, name),
    bus,
    agents: new Map(),
    roleSlots: new Map(),
    bossRoleId: '', // set below, once bossRole is computed
    glossary: [],
    respawning: new Set(),
    busEvents: () => [...collected],
    workdir: cwd,
    credential: randomUUID(),
    ...(documents ? { documents } : {}),
  };
  daemon.orgs.set(name, running);
  // Org sections spec 7.3 advice, so it sits in the run's own record.
  for (const w of checklistWarnings)
    bus.emit({ type: 'audit', reason: 'checklist-warning', msg: w });
  // #480: private role TMPDIRs a dead earlier run of this org left behind.
  const staleTmp = sweepStaleRoleTmpdirs({ org: name, root: daemon.root, run });
  if (staleTmp.length > 0)
    bus.emit({
      type: 'audit',
      reason: 'role-tmpdir-sweep',
      msg: `removed ${staleTmp.length} stale role TMPDIR(s) left by an earlier run of this org`,
      data: { removed: staleTmp },
    });

  const roleFences = await startSteps.createRoleFences(daemon, def);
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
  const unoverriddenRoleCount = agentRoles(def.roles).filter((r) => r.budget_tokens == null).length;
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
      if (!(await daemon.orgMemoryUsable())) return [];
      const kg = await import('../memory/memory-kg.js');
      return await kg.kgGlossary({
        dbPath: daemon.orgMemoryDbPath(),
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
    // #552: nothing spawns while the org-wide run_config.budget_tokens ceiling
    // is spent — a reload that raises it clears this and re-spawns the roles.
    // A caller that took the role out of pendingRoles doesn't lose it: it is
    // set aside with the other unspawned roles, which the reload restores.
    if (running.orgBudgetClosed) {
      if (!roleCheckpoint) (running.orgBudgetPendingRoles ??= new Map()).set(role.id, role);
      bus.emit({
        type: 'audit',
        from: role.id,
        reason: 'spawn-refused',
        msg: `not spawning "${role.id}": the org-wide token budget is exhausted`,
        data: { roleId: role.id },
      });
      return;
    }
    const { runtime, abort } = daemon.spawnRoleIncarnation(
      name,
      running,
      role,
      roleCheckpoint?.generation ?? 0,
      { roleCheckpoint },
    );
    running.agents.set(role.id, runtime);
    daemon.abandoned.get(name)?.delete(role.id); // a gave-up deferral that started after all
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
    decisionOps.dispatchReadyTasks(daemon, name, running);
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
        cwd: daemon.root,
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
  if (staleThreshold && staleThreshold > 0 && cwd === daemon.root) {
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
    const prev = readHistory(daemon.root, name).at(-1);
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
  daemon.persistState(name, 'running', run);

  idleWatchdog.startIdleWatchdog(daemon, name, running, bossRole, {
    lastActivity: () => lastActivity,
    lastToolActivity: () => lastToolActivity,
    roleActivity,
    noProgressAlarmed,
  });

  await startSteps.startInboxAndDrain(daemon, name, running);

  return running;
}
