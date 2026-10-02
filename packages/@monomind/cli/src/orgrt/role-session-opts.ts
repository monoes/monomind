// packages/@monomind/cli/src/orgrt/role-session-opts.ts
// Extracted from daemon.ts — the SessionOpts one role incarnation runs with
// (every daemon callback its org tools reach) and the org_complete gate.
import { join } from 'node:path';
import type { OrgBus } from './bus.js';
import type { RoleCheckpoint } from './checkpoint.js';
import { type CompletionFacts, checkCompletion, type TaskEvidence } from './completion-gate.js';
import type { OrgDaemon } from './daemon.js';
import type { AgentRuntime, RunningOrg } from './daemon-types.js';
import * as decisionOps from './decisions.js';
import { openTaskCount } from './decisions.js';
import { loadoutCatalog, resolveLoadout } from './loadouts.js';
import type { Mailbox } from './mailbox.js';
import type { TaskReferences } from './packet.js';
import type { PolicyEngine } from './policy.js';
import * as questionOps from './questions.js';
import { endTurn, withTrace } from './role-trace.js';
import { resolveRoleRunner } from './runner-resolve.js';
import { effectiveToolProviders } from './skill-library.js';
import { isTerminalStatus } from './task-dag.js';
import { resolveAutoAssignee, type TaskPick } from './task-match.js';
import { type DecisionKind, ORG_DIR, type OrgRole } from './types.js';

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
    | 'mode'
    | 'maxBudgetFraction'
    | 'pendingHumanWaits'
    | 'hasActiveBlock'
    | 'hasPendingWork'
    | 'openBlockingQuestions'
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

/** The sessionOpts built inside spawnRoleIncarnation (role-incarnation.ts). */
export function buildRoleSessionOpts(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  role: OrgRole,
  roleCwd: string,
  runtime: AgentRuntime,
  abort: AbortController,
  loadout: ReturnType<typeof resolveLoadout> | undefined,
  policy: PolicyEngine,
  mailbox: Mailbox,
  roleCheckpoint: RoleCheckpoint | undefined,
) {
  const { def, bus, run } = running;
  return {
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
    orgDir: join(daemon.root, ORG_DIR, name),
    // Project root for named-provider (`adapter_config.provider`) config
    // lookup — role cwd may be an isolated workspace with no config file.
    orgRoot: daemon.root,
    run,
    // M1: role tool providers — listed at session start, processes spawned
    // lazily on first call and killed when the session ends.
    buildProviderTools: async () => {
      const providers = effectiveToolProviders(role, daemon.root);
      if (providers.length === 0) return undefined;
      return daemon.toolProviders.buildRoleTools({
        ctx: { org: name, run, role: role.id, root: daemon.root },
        providers,
        trace: () => daemon.roleTrace(name, role.id),
        bus,
        cwd: roleCwd,
      });
    },
    maxTurns: role.max_turns_per_message ?? def.run_config.max_turns_per_message,
    resumeSessionId: roleCheckpoint?.sessionId,
    sessionLedger: running.sessionLedger,
    // #480: a closed task's session TMPDIR is removed (role-tmpdir.ts).
    isTaskClosed: (taskId: string) => {
      const task = running.taskDag?.get(taskId);
      return !!task && isTerminalStatus(task.status);
    },
    // ADR-O001 D3 x D7: a task-scoped session is built with its task's own
    // recorded loadout. Unresolvable → no loadout, loudly (as at spawn).
    loadoutFor: (taskId: string) => {
      const name = running.taskDag?.get(taskId)?.loadout;
      if (!name) return undefined;
      try {
        return resolveLoadout(def, name, daemon.root);
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
      daemon.deliver(name, from, to, subject, withTrace(body, daemon.roleTrace(name, role.id))),
    askHuman: (r: string, question: string, blocking?: boolean) =>
      daemon.askHuman(name, r, question, blocking),
    onGate: (r: string, gateName: string, gateDesc: string) =>
      daemon.createGate(name, r, gateName, gateDesc),
    circuitBreaker: (() => {
      const cb = (def.run_config as Record<string, unknown>).circuit_breaker as
        | { failure_threshold?: number; cooldown_ms?: number }
        | undefined;
      if (!cb) return undefined;
      return { threshold: cb.failure_threshold ?? 5, state: { failures: 0, tripped: false } };
    })(),
    beforeTool: (r: string, toolName: string, input: Record<string, unknown>) =>
      daemon.awaitApproval(name, r, toolName, input),
    fence: running.fences?.get(role.id),
    // ORG-1: gatedCanUseTool denials are a natural decision point — record them so
    // `org decisions` shows real traces instead of always reporting none.
    onDecision: (r: string, toolName: string, message: string, kind: DecisionKind) => {
      daemon.recordDecision(name, r, {
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
    hasPendingGate: () => daemon.listGates(name, 'pending').some((g) => g.roleId === role.id),
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
            const blockingQuestions = questionOps.pendingBlockingQuestions(daemon.root, name);
            const pendingHumanWaits =
              daemon.listGates(name, 'pending').length + blockingQuestions.length;
            return resolveOrgComplete(bus, r, outcome, summary, blocker, blockerDetail, {
              mode: def.run_config.completion ?? 'boss',
              maxBudgetFraction,
              pendingHumanWaits,
              // #564: the boss's own and every other role's blocking questions.
              openBlockingQuestions: blockingQuestions.map((q) => q.questionId),
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
      role.id === running.bossRoleId ? () => daemon.scheduleBossRestart(name) : undefined,
    onListRuntimeOptions:
      role.id === running.bossRoleId && (def.run_config.max_role_respawns ?? 0) > 0
        ? () => daemon.listRuntimeOptions()
        : undefined,
    onRespawnRole:
      role.id === running.bossRoleId && (def.run_config.max_role_respawns ?? 0) > 0
        ? (callerId: string, args: any) => daemon.respawnRole(name, callerId, args)
        : undefined,
    recall: async (r: string, q: string) => {
      const answer = await daemon.recallOrgMemory(name, def, q, r);
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
      const answer = await daemon.searchProjectKnowledge(q);
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
      const text = await daemon.rememberOrgMemory(name, def, r, content, scope, run);
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
      const text = await daemon.learnOrgKnowledge(name, run, payload);
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
      references?: TaskReferences,
    ) => {
      return daemon.dagCreateTask(name, r, title, assignee, deps, loadout, brief, pick, references);
    },
    pickAssignee: resolveAutoAssignee(
      def,
      (id) => openTaskCount(daemon.orgs.get(name), id),
      () => daemon.orgs.get(name)?.taskDag?.all() ?? [],
    ),
    onSkillLoad: (r: string, skill: string) =>
      decisionOps.recordSkillLoad(daemon.orgs.get(name), r, skill),
    // ADR-O001 D7: only an org with a catalog gets the `loadout` argument;
    // the session itself is built with the loadout frozen above.
    loadoutCatalog: loadoutCatalog(def),
    loadout,
    completeTask: (r: string, taskId: string, result?: string, evidence?: TaskEvidence) => {
      return daemon.dagCompleteTask(name, r, taskId, result, evidence);
    },
    // ADR-O001 D5: only an org that opted in advertises the evidence
    // argument, so every other org's tool list stays byte-identical.
    requireTaskEvidence: def.run_config.completion_evidence === true && role.deliberative !== true,
    // ADR-O001 D6: only an org with an artifact-only reviewer gets org_review,
    // so every other org's tool list stays byte-identical.
    requestReview: def.roles.some((r) => r.review_input === 'artifact-only')
      ? (r: string, taskId: string, reviewer: string, base?: string) =>
          daemon.dagRequestReview(name, r, taskId, reviewer, base)
      : undefined,
    listTasks: (taskId?: string) => decisionOps.dagListTasks(daemon, name, taskId),
    splitTask: (r: string, parentId: string, children: { title: string; assignee: string }[]) => {
      return daemon.dagSplitTask(name, r, parentId, children);
    },
    mergeTask: (r: string, sourceId: string, targetId: string) => {
      return daemon.dagMergeTask(name, r, sourceId, targetId);
    },
    cancelTask: (r: string, taskId: string, reason?: string) => {
      return daemon.dagCancelTask(name, r, taskId, reason);
    },
    blockTask: (r: string, taskId: string, untilIso: string, reason?: string, every?: number) => {
      return daemon.dagBlockTask(name, r, taskId, untilIso, reason, every);
    },
    planGraph: (r: string, specs: decisionOps.PlanTaskSpec[]) => {
      return daemon.dagPlanGraph(name, r, specs);
    },
    queryFn: daemon.opts.queryFn,
    // Runner resolution: explicit opts.runner > role `runtime` field >
    // org def `runtime` field > MONOMIND_RUNTIME env (opencode/kimicode) >
    // undefined (session.ts falls back to ClaudeAgentRunner via queryFn).
    // Leaving it undefined for the default path is what keeps
    // Claude/Antigravity orgs byte-for-byte unchanged. Session opts are
    // built per role here, so each role gets its own runner.
    runner:
      daemon.opts.runner ??
      resolveRoleRunner(role.runtime, def.runtime, role.provider?.kind, undefined, role.provider),
    // Lets respawnRole force-stop THIS specific incarnation (mid-run role
    // replacement's forced-stop step) without reaching into runAgentSession's
    // internals.
    externalAbort: abort,
    silentSessionMs: daemon.opts.silentSessionMs,
  };
}
