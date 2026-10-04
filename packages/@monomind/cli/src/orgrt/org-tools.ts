// packages/@monomind/cli/src/orgrt/org-tools.ts
// Extracted from session.ts — the org tool surface every role session gets.
import { z } from 'zod';
import type { OrgToolDef } from './agent-runner.js';
import type { TaskEvidence } from './completion-gate.js';
import {
  BRIEF_FIELD_HELP,
  type BriefFields,
  briefFieldArgs,
  checkBrief,
  checkTaskResult,
  contextSurface,
  TASK_RESULT_HELP,
  withWarnings,
} from './context-surface.js';
import { documentTools } from './documents/tools-core.js';
import { appendNote, NOTE_APPEND_HELP, readNotes } from './notes.js';
import { checkPacket, REFERENCES_HELP, referencesArg, type TaskReferences } from './packet.js';
import { approvalGateOutcome } from './session-gate.js';
import { resolveSessionScope } from './session-ledger.js';
import type { SessionOpts } from './session-types.js';
import { skillTools } from './skill-tools.js';
import { MAX_TASK_BRIEF } from './task-dag.js';
import { orgTaskTool } from './task-tools.js';
import { strictArgs } from './tool-fence.js';
import { MAX_BLOCK_RECHECK_MINUTES } from './types.js';

/** Build the org tool surface as platform-agnostic OrgToolDef[]. The handlers
 *  close over sessionOpts callbacks (deliver, recall, remember, …) — same
 *  wiring as the previous inline createSdkMcpServer block, just decoupled from
 *  the Claude SDK's tool() shape so any AgentRunner can host them.
 *
 *  Behaviour is identical to the old inline definitions: conditional tools are
 *  gated on their callback being present, org_send/ask_human are always added. */
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
        "⚠️ Ends the run — every agent session shuts down after this. Call exactly once, and only against the org's actual, full stated goal (see your briefing), never against just the current batch of dispatched tasks. \"achieved\" means the WHOLE goal is done, not \"everyone assigned so far finished their piece\" — a multi-phase or open-ended goal is very rarely achieved in a single run. If the current task batch is clearly done but the goal has more scope left: do NOT call this — use org_task/createTask to dispatch the next phase's work instead, so the org keeps making progress instead of stopping short. \"achieved\" only when the full goal is met; \"failed\" only when it clearly cannot be — neither requires a blocker (though if this org's run_config.completion is set to 'dag', \"achieved\" is ALSO refused while org_tasks still has runnable work that is not blocked on a real-world time — check org_tasks first if that setting applies to you). Use outcome \"partial\" only when you are ending the run with real scope still remaining, and you MUST name why with `blocker`: 'budget' (a role is genuinely near its token/USD ceiling), 'human' (an ask_human question or decision gate is actually pending), 'time' (if the only thing blocking further work is a scheduled process or deadline you know the time of, call org_task_block instead of ending the run so a future run can pick back up automatically — this blocker is refused unless a task is actually blocked that way), or 'external' (anything else — `blockerDetail` must be a real, substantive explanation; placeholders like \"none\"/\"n/a\" and anything under 10 characters are refused, because this is the one blocker nothing else can check, and it is recorded verbatim in the run history under your name). A refusal names which of these to use instead. Before calling, check org_tasks — siblings with in-progress work only get a short drain window to finish before being cut off, so do not call this while others are still mid-build or mid-edit unless the run genuinely cannot continue. The outcome and summary are persisted to the org run history and briefed to the next run. If the run produced a concrete deliverable (a post, document, message, piece of content, code, etc.), summary MUST include that deliverable's full text verbatim — not a meta-description of what happened. Someone reading only summary should be able to see the actual result, not just that \"a result was produced\". 'achieved' is refused while a worker's write failed and its file is not on disk: verify deliverables exist (ls -l) first, or end 'partial' naming what was not written.",
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
      description:
        (opts.requireTaskEvidence
          ? 'Mark a task as completed. This org requires EVIDENCE (run_config.completion_evidence): pass `evidence` with the current commit sha of the work (the HEAD of any worktree of this repository, or any local branch tip), `worktree` naming the worktree you ran in when it is not the org workspace, and one entry per acceptance criterion — the command you actually ran, its real exit code, and its output. `evidence` is its own argument next to `taskId` and `result`; evidence written as text inside `result` is not read. A task that correctly changed nothing closes the same way, pinned to the unchanged HEAD it verified. A check passes when its exit code equals `expectExit` (default 0): when the criterion is met by a non-zero exit (a lookup that must find nothing → 1, a timeout that must fire → 124), set `expectExit` instead of appending `|| true`, which erases the exit code, and always say why in a one-line `expectReason` ("404 = branch not protected") — `expectExit` without it is refused. `expectExit` is only for a SINGLE-PURPOSE command: on a test suite or any other aggregate runner (vitest, jest, `pnpm test`, `pnpm -r`, a verify script) it is refused outright, because a suite exit code means "at least one of many things failed" and declaring it expected accepts every other failure too — run the one failing test file on its own and declare `expectExit` on that, or exclude the known failure and record the exclusion in `result`. A task whose job is to REPORT (QA, an audit) closes on commands that prove the report exists and is complete (e.g. `test -s <report file>`); the failures it found are findings — put them in `result` and send them to the coordinator, not in `checks`. If you tested something outside a git worktree (a scratch dir, an installed tarball), pin `headSha`/`worktree` to the worktree the artifact was built from. Evidence pinned to a commit that is no longer the head of that work is stale and will be refused, and a refused completion puts the task back in your queue with the reason — but only up to run_config.max_evidence_attempts refused proofs (default 3; a call with no `evidence` at all is refused without counting), after which the task is recorded as failed and escalated to the boss instead of returned to you. Any downstream tasks whose deps are now all done become ready and are dispatched.'
          : 'Mark a task as completed and optionally provide a result summary. Any downstream tasks whose deps are now all done will become ready and be dispatched.') +
        ' Verify a deliverable file exists (ls -l / Read) before closing; a completion after a failed write whose file is not on disk is refused, so report a refused write as blocked in `result` instead.' +
        (contextSurface(opts.def).enabled ? TASK_RESULT_HELP : ''),
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
      handler: async (args) => {
        // Phase 2: a delegated task returns a summary, never a transcript (context-surface.ts).
        const tooLong = contextSurface(opts.def).enabled
          ? checkTaskResult(args.result as string | undefined)
          : undefined;
        if (tooLong) return text(JSON.stringify({ error: tooLong }));
        return text(
          completeTask(
            role.id,
            args.taskId as string,
            args.result as string | undefined,
            args.evidence as TaskEvidence | undefined,
          ),
        );
      },
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
  const surface = contextSurface(opts.def);
  if (surface.notes && opts.orgDir) {
    const orgDir = opts.orgDir;
    tools.push({
      name: 'org_note_append',
      description: NOTE_APPEND_HELP,
      schema: { text: z.string(), current_state: z.boolean().optional() },
      handler: async (args) => {
        try {
          appendNote(
            orgDir,
            role.id,
            args.text as string,
            args.current_state ? 'current_state' : 'note',
          );
        } catch (err) {
          return text(JSON.stringify({ error: (err as Error).message }));
        }
        return text(JSON.stringify({ ok: true, entries: readNotes(orgDir, role.id).length }));
      },
    });
  }
  if (planGraph) {
    tools.push({
      name: 'org_plan_graph',
      description:
        'Propose a full work graph in one call. Each task spec uses a local "name" and references other specs by name in "after", and may carry a "brief" with its instructions exactly as org_task does.' +
        (catalog ? ' Each spec may select a "loadout" exactly as org_task does.' : '') +
        (surface.enabled ? BRIEF_FIELD_HELP + REFERENCES_HELP : ''),
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
                ...(surface.enabled ? { ...briefFieldArgs(), references: referencesArg } : {}),
                ...loadoutArg,
              },
              { deps: 'use `after` with node names' },
            ),
          )
          .min(1),
      },
      handler: async (args) => {
        type Spec = {
          name: string;
          title: string;
          assignee: string;
          after?: string[];
          loadout?: string;
          brief?: string;
          references?: TaskReferences;
        } & BriefFields;
        let specs = (args.tasks as Spec[]) ?? [];
        const warnings: string[] = [];
        if (surface.enabled) {
          // One bad task rejects the whole graph: a half-created plan has dangling `after` edges.
          const errors: string[] = [];
          specs = specs.map((s) => {
            const { objective, output, tools: toolsField, boundaries, acceptance, ...rest } = s;
            const checked = checkBrief(
              surface,
              { objective, output, tools: toolsField, boundaries, acceptance },
              s.brief,
              `task "${s.name}"`,
            );
            if (checked.error) errors.push(checked.error);
            else {
              const tooBig = checkPacket({
                title: s.title,
                brief: checked.brief,
                references: s.references,
              });
              if (tooBig) errors.push(`task "${s.name}": ${tooBig}`);
            }
            warnings.push(...checked.warnings);
            return { ...rest, ...(checked.brief !== undefined ? { brief: checked.brief } : {}) };
          });
          if (errors.length) return text(JSON.stringify({ error: errors.join('; ') }));
        }
        return text(withWarnings(planGraph(role.id, specs), warnings));
      },
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
        : '') +
      // Org sections (plan P3.12): only a session with a documents host, so every other tool list is unchanged.
      (opts.documents
        ? ' In an org with sections, a message to a role in another section is refused: hand work over with org_doc_publish, or go through your section lead or the root.'
        : ''),
    schema: { to: z.string(), subject: z.string(), message: z.string() },
    handler: async (args) => {
      if (opts.beforeTool) {
        const outcome = approvalGateOutcome(
          'org_send',
          await opts.beforeTool(role.id, 'org_send', args),
        );
        if (!outcome.allow) return text(outcome.message);
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
  // Org sections (plan P3.6): last, so every existing tool keeps its place in the list.
  if (opts.documents) tools.push(...documentTools(opts.documents));
  // Built-in org tools reject undeclared keys instead of stripping them: a
  // stripped `deps` on an org_plan_graph node silently dropped every edge.
  for (const t of tools) t.strict ??= {};
  return tools;
}
