// packages/@monomind/cli/src/orgrt/session.ts
import { z } from 'zod';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { OrgBus } from './bus.js';
import type { PolicyEngine } from './policy.js';
import { Mailbox } from './mailbox.js';
import type { OrgDef, OrgRole } from './types.js';

/** How long an SDK stream may stay open with zero messages before we say so.
 *  Comfortably longer than a slow first turn, shorter than the idle watchdog's
 *  10-minute window so the specific cause is reported before the generic
 *  "boss appears hung". */
const SILENT_SESSION_MS = 4 * 60_000;

/** Matches provider context-window-overflow errors that surface as assistant
 *  "API Error: … context window limit" text. A role that hits this can't recover
 *  on its own — every later turn returns the same +0-token error. */
const CONTEXT_LIMIT_RE = /context[- ]?(window|length|size|limit)|maximum context|exceeds?.{0,12}(context|token)|too many tokens|prompt is too long/i;
import { resolveProviderEnv } from './provider.js';
import { StateDetector } from './state-detector.js';

export type DeliverFn = (from: string, to: string, subject: string, body: string) => Promise<string>;

export interface SessionOpts {
  org: string;
  role: OrgRole;
  bus: OrgBus;
  policy: PolicyEngine;
  mailbox: Mailbox;
  cwd: string;
  deliver: DeliverFn;
  askHuman?: (role: string, question: string) => Promise<string>;
  /** Coordinator-only: records the run's outcome (daemon persists it to run history). */
  onComplete?: (role: string, outcome: 'achieved' | 'partial' | 'failed', summary: string) => void;
  /** Coordinator-only: fired ONCE if the boss's own session overflows its context
   *  window (every subsequent turn returns a +0-token context-limit error, so it
   *  can never recover). The daemon uses this to restart the whole org with fresh
   *  sessions instead of the idle watchdog nudging a context-full boss for 30 min. */
  onContextLimit?: () => void;
  /** Search the org's accumulated cross-run memory (memory_namespace). */
  recall?: (role: string, query: string) => Promise<string>;
  /** Write a memory deliberately: scope 'org' (shared, default) or 'agent' (private to this role). */
  remember?: (role: string, content: string, scope: 'org' | 'agent') => Promise<string>;
  /** Persist extracted entities/relations/rules into the org's knowledge graph. */
  learn?: (role: string, payload: {
    nodes?: { name: string; type?: string; description?: string }[];
    edges?: { source: string; target: string; relation: string; description?: string }[];
    rules?: { rule: string; context?: string }[];
  }) => Promise<string>;
  /** Top existing KG entity names - injected into the coordinator prompt so
   *  extraction reuses canonical names instead of minting near-duplicates. */
  glossary?: string[];
  /** Search the user's Second Brain (project documents + personal global brain). */
  searchKnowledge?: (role: string, query: string) => Promise<string>;
  /** Guardrail beforeTool hook: checks if a tool call requires approval before execution. */
  beforeTool?: (role: string, toolName: string) => Promise<boolean | null>;
  /** Circuit breaker: close role after N consecutive non-success session results. */
  circuitBreaker?: { threshold: number; state: { failures: number; tripped: boolean } };
  /** Decision gate: create a human-approval checkpoint. Returns a receipt string. */
  onGate?: (role: string, name: string, description: string) => Promise<string>;
  /** Task DAG: create a task with optional dependencies. Returns task JSON. */
  createTask?: (role: string, title: string, assignee: string, deps: string[]) => string;
  /** Task DAG: mark a task as done. Returns list of newly-ready task IDs. */
  completeTask?: (role: string, taskId: string, result?: string) => string;
  /** Task DAG: list all tasks. Returns JSON array. */
  listTasks?: () => string;
  /** Scrollback capture: called with each line of agent output text. */
  onOutput?: (line: string) => void;
  def?: OrgDef;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
  /** ID of the last message received by this agent (for threading responses). Function to ensure live reading. */
  lastMessageId?: () => string | undefined;
}

/** Role briefing given to each agent session (SDK systemPrompt option). */
export function buildRolePrompt(role: OrgRole, def: Pick<OrgDef, 'name' | 'goal'>, roster: string[], glossary?: string[]): string {
  const isCoordinator = role.reports_to == null;
  return [
    `You are agent "${role.id}" (${role.title || role.type}) in the org "${def.name}".`,
    `Org goal: ${def.goal}`,
    isCoordinator ? `You are the coordinator of this org.` : `You report to "${role.reports_to}".`,
    role.responsibilities?.length ? `Your responsibilities:\n- ${role.responsibilities.join('\n- ')}` : '',
    `## Communication protocol`,
    `The ONLY way to communicate with other agents is the org_send tool.`,
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    `If you need a human decision, call ask_human with your question, then end your turn - you'll receive the human's answer as a new message when it arrives. Do not call ask_human for anything you can resolve yourself.`,
    `For irreversible or high-risk actions (deployments, deletions, external communications), call org_gate to create a decision gate — a hard-blocking approval checkpoint. End your turn and wait for the human's approval or rejection before proceeding.`,
    `You can structure work as a task DAG: use org_task to create tasks with dependencies, org_task_done to mark them complete, and org_tasks to see the full DAG. Tasks with satisfied dependencies are automatically dispatched to their assignee.`,
    `Before starting substantial work, call org_recall to check what previous runs already learned or delivered - do not redo finished work.`,
    `The user's documents (notes, handbooks, specs) are searchable with knowledge_search - ground your work in them instead of guessing; results labeled [global] come from the user's personal cross-project brain.`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    isCoordinator
      ? `When the org's goal for this run is achieved (or clearly can't be): first call org_learn ONCE with the durable knowledge this run produced - key entities (basic types, fullest names), their relationships (snake_case, one-sentence facts), and any reusable rules ("when X, do Y") worth keeping. Then call org_complete exactly once with the outcome and a concise summary. Then end your turn.`
      : `When your current work is complete and no reply is needed, end your turn without further tool calls.`,
    isCoordinator && glossary?.length
      ? `Known entities (reuse these EXACT names in org_learn instead of near-duplicates): ${glossary.slice(0, 40).join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');
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
  const { mailbox } = opts;
  // Carries the SDK's own session_id across a maxTurns restart so the next
  // query() call resumes the prior conversation instead of starting cold -
  // without this, a restart silently discarded all in-progress reasoning.
  let resumeSessionId: string | undefined;
  // #1: when a session ends on the turn limit mid-work, push a continuation so
  // the restarted query() has input to act on instead of blocking on an empty
  // mailbox until the 10-minute idle watchdog. Bounded: if the role consumed no
  // real message since the last restart (it is spinning on its own
  // continuations), stop auto-pushing after MAX_CONTINUATIONS and let the
  // watchdog re-engage — so a stuck role can't burn tokens forever.
  const MAX_CONTINUATIONS = 3;
  let consecutiveSpin = 0;
  // Always run at least once: a mailbox can be closed with queued items still
  // pending (stream() drains the queue before honoring `closed`), which is a
  // normal, valid starting state - checking isClosed before the first run
  // would skip that drain entirely.
  while (true) {
    const realBefore = mailbox.consumedRealCount;
    const { sessionId, hitTurnLimit } = await runOneSession(opts, resumeSessionId);
    resumeSessionId = sessionId;
    // The dead session's generator may still hold the waker - drop it so a
    // push() before the next stream() starts only queues instead of being
    // consumed by the abandoned generator (silent message loss).
    mailbox.detach();
    if (mailbox.isClosed) return;
    const madeProgress = mailbox.consumedRealCount > realBefore;
    if (hitTurnLimit && madeProgress) consecutiveSpin = 0;
    if (hitTurnLimit) {
      if (!madeProgress) consecutiveSpin++;
      if (consecutiveSpin < MAX_CONTINUATIONS) {
        mailbox.push(`${Mailbox.CONTINUE_PREFIX} You reached the per-session turn limit while still working. Continue your in-progress task from where you left off; if nothing remains, end your turn.`);
        opts.bus.emit({ type: 'status', from: opts.role.id, reason: 'turn-limit-resume', msg: 'session restarting (turn limit reached, mailbox still open)' });
      } else {
        // Spinning on continuations alone — park for the watchdog instead of
        // looping forever. Reset so the watchdog's nudge buys a fresh budget.
        consecutiveSpin = 0;
        opts.bus.emit({ type: 'status', from: opts.role.id, reason: 'turn-limit-park', msg: 'turn limit hit repeatedly with no new input — parking for idle watchdog' });
      }
    } else {
      opts.bus.emit({ type: 'status', from: opts.role.id, msg: 'session restarting (turn limit reached, mailbox still open)' });
    }
  }
}

/** One bounded SDK session for a role; resolves with the SDK's session_id (for
 *  resuming on restart) and whether it ended by hitting the turn limit (so the
 *  caller can push a continuation) when the stream ends (mailbox closed or
 *  maxTurns reached). */
async function runOneSession(opts: SessionOpts, resume?: string): Promise<{ sessionId?: string; hitTurnLimit?: boolean }> {
  const { org, role, bus, policy, mailbox, cwd, deliver } = opts;
  // Read lastMessageId live from opts instead of capturing at session start
  // This ensures chat responses link to the most recent message delivered
  const getLastMessageId = () => opts.lastMessageId ? opts.lastMessageId() : undefined;
  const queryFn = opts.queryFn ?? query;

  const orgServer = createSdkMcpServer({
    name: 'org',
    version: '1.0.0',
    tools: [
      ...(opts.searchKnowledge ? [tool(
        'knowledge_search',
        'Semantic search over the user\'s Second Brain: this project\'s indexed documents plus their personal cross-project global brain. Use to ground work in the user\'s actual notes, handbooks, and documents.',
        { query: z.string() },
        async (args) => {
          const text = await opts.searchKnowledge!(role.id, args.query);
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      ...(opts.recall ? [tool(
        'org_recall',
        'Search this org\'s accumulated memory from previous runs (outcomes, decisions, learnings). Use before starting work that may already have been done.',
        { query: z.string() },
        async (args) => {
          const text = await opts.recall!(role.id, args.query);
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      ...(opts.remember ? [tool(
        'org_remember',
        'Save a memory for future runs. scope "org" (default) shares it with the whole org; scope "agent" keeps it private to your role. Use for decisions, findings, and state worth recalling later - org_recall searches both.',
        { content: z.string(), scope: z.enum(['org', 'agent']).optional() },
        async (args) => {
          const text = await opts.remember!(role.id, args.content, args.scope ?? 'org');
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      ...(opts.learn ? [tool(
        'org_learn',
        'Persist durable knowledge from this run into the org\'s knowledge graph: entities ({name, type?, description?}), relationships ({source, target, relation, description?}) and reusable rules ({rule, context?}). Entities merge by name across runs - reuse the exact names listed in your briefing. Call once, before org_complete.',
        {
          nodes: z.array(z.object({ name: z.string(), type: z.string().optional(), description: z.string().optional() })).optional(),
          edges: z.array(z.object({ source: z.string(), target: z.string(), relation: z.string(), description: z.string().optional() })).optional(),
          rules: z.array(z.object({ rule: z.string(), context: z.string().optional() })).optional(),
        },
        async (args) => {
          const text = await opts.learn!(role.id, args);
          return { content: [{ type: 'text' as const, text }] };
        },
      )] : []),
      // Gate purely on onComplete: the daemon passes it only to the role its
      // boss-selection rule picked, so tool availability always matches the
      // kickoff instruction (reports_to may be non-null for a fallback boss).
      ...(opts.onComplete ? [tool(
        'org_complete',
        'Record the outcome of this run. Call exactly once, when the goal is achieved or clearly cannot be. The outcome and summary are persisted to the org run history and briefed to the next run.',
        { outcome: z.enum(['achieved', 'partial', 'failed']), summary: z.string() },
        async (args) => {
          opts.onComplete!(role.id, args.outcome, args.summary);
          return { content: [{ type: 'text' as const, text: `outcome "${args.outcome}" recorded` }] };
        },
      )] : []),
      tool(
        'org_send',
        'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.',
        { to: z.string(), subject: z.string(), message: z.string() },
        async (args) => {
          // Check beforeTool guardrail if available
          if (opts.beforeTool) {
            const approved = await opts.beforeTool(role.id, 'org_send');
            if (approved === false) {
              return { content: [{ type: 'text' as const, text: 'Tool "org_send" was denied by guardrail approval' }] };
            }
            if (approved === null) {
              return { content: [{ type: 'text' as const, text: 'Tool "org_send" is pending human approval - you will receive the result when it is approved or denied.' }] };
            }
          }
          const receipt = await deliver(role.id, args.to, args.subject, args.message);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
      tool(
        'ask_human',
        'Ask a human a free-form question and pause for their answer. Use only when you genuinely need human judgment.',
        { question: z.string() },
        async (args) => {
          if (!opts.askHuman) {
            return { content: [{ type: 'text' as const, text: 'ask_human is not available in this session' }] };
          }
          const receipt = await opts.askHuman(role.id, args.question);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
      ...(opts.onGate ? [tool(
        'org_gate',
        'Create a decision gate — a hard-blocking human-approval checkpoint. Use before irreversible actions (deployments, deletions, external comms). The gate pauses your work until a human approves or rejects it. End your turn after calling this; you will receive the resolution as a new message.',
        { name: z.string(), description: z.string() },
        async (args) => {
          const receipt = await opts.onGate!(role.id, args.name, args.description);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      )] : []),
      ...(opts.createTask ? [
        tool(
          'org_task',
          'Create a task in the DAG with optional dependencies. Dependencies must be existing task IDs. Tasks become ready when all deps are done, then get dispatched to the assignee.',
          { title: z.string(), assignee: z.string(), deps: z.array(z.string()).default([]) },
          async (args) => {
            const result = opts.createTask!(role.id, args.title, args.assignee, args.deps);
            return { content: [{ type: 'text' as const, text: result }] };
          },
        ),
        tool(
          'org_task_done',
          'Mark a task as completed and optionally provide a result summary. Any downstream tasks whose deps are now all done will become ready and be dispatched.',
          { taskId: z.string(), result: z.string().optional() },
          async (args) => {
            const result = opts.completeTask!(role.id, args.taskId, args.result);
            return { content: [{ type: 'text' as const, text: result }] };
          },
        ),
        tool(
          'org_tasks',
          'List all tasks in the DAG with their current status and dependencies.',
          {},
          async () => {
            const result = opts.listTasks!();
            return { content: [{ type: 'text' as const, text: result }] };
          },
        ),
      ] : []),
    ],
  });

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  let sessionId: string | undefined = resume;
  let hitTurnLimit = false;
  let contextLimitFired = false;
  try {
    const stream = queryFn({
      prompt: mailbox.stream(),
      options: {
        systemPrompt: buildRolePrompt(role, (opts.def ?? { name: org, goal: '' }) as OrgDef,
          opts.def?.roles.map(r => r.id) ?? [role.id], opts.glossary),
        model: role.adapter_config?.model,
        cwd,
        env: {
          ...resolveProviderEnv(role.provider),
          // Suppress all hook advisory output and expensive graph operations for
          // SDK-spawned org agent sessions. These agents don't need routing,
          // intelligence injection, or monograph suggestions — they have their
          // own role prompt and tools. Without this, every org agent fires all
          // UserPromptSubmit/PreToolUse/PostToolUse hooks per message, re-reading
          // the massive cached context on every turn (the #1 token-burn source).
          MONOMIND_HOOK_QUIET: '1',
          MONOMIND_SDK_AGENT: '1',
        },
        mcpServers: { org: orgServer },
        maxTurns: opts.maxTurns ?? 30,
        permissionMode: 'default',
        resume,
        canUseTool: async (toolName: string, input: Record<string, unknown>) =>
          policy.decide(toolName, input),
        // test seam: lets the scripted fake SDK (test-loop.ts) drive org_send and
        // tool calls through the real deliver/policy paths; the real SDK ignores it
        _orgTest: {
          deliver: (to: string, subject: string, body: string) => deliver(role.id, to, subject, body),
          callTool: (name: string, input: Record<string, unknown>) => policy.decide(name, input),
        },
      } as any,
    });

    // A silent session is its own failure mode, and until now an unnameable
    // one: nine consecutive cycles of a scheduled org opened all seven streams
    // and yielded NOTHING - no assistant message, no result, no error, and no
    // stream end. The only symptom was the idle watchdog reporting the boss
    // "appears hung" twenty minutes later, which described neither the scope
    // (every role) nor the cause. Name the condition at the one place that can
    // see it: the stream itself. Cleared as soon as any message arrives, so a
    // healthy session never emits it.
    const openedAt = Date.now();
    const detector = new StateDetector();
    let sawAnyMessage = false;
    const silentAlarm = setTimeout(() => {
      if (sawAnyMessage) return;
      bus.emit({
        type: 'audit', from: role.id, reason: 'session-silent',
        msg: `SDK stream open ${Math.round((Date.now() - openedAt) / 1000)}s with zero messages - not an error, not an end, nothing. Set MONOMIND_DEBUG=1 to log raw message types.`,
      });
    }, SILENT_SESSION_MS);
    (silentAlarm as { unref?: () => void }).unref?.();

    try {
      for await (const m of stream as AsyncIterable<any>) {
        if (!sawAnyMessage) { sawAnyMessage = true; clearTimeout(silentAlarm); }
        if (process.env.MONOMIND_DEBUG) {
          console.error(`[orgrt:${org}/${role.id}] sdk message type=${String(m?.type)} subtype=${String(m?.subtype ?? '-')}`);
        }
      if (m.session_id) sessionId = m.session_id;
      const prevState = detector.current();
      const text_for_detect = m.type === 'assistant'
        ? (m.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        : undefined;
      const newState = detector.onMessage(m.type, m.subtype, text_for_detect);
      if (newState !== prevState) {
        bus.emit({ type: 'status', from: role.id, reason: 'state-change', msg: `${prevState} → ${newState}`, data: { from: prevState, to: newState } });
      }
      if (m.type === 'assistant') {
        const text = (m.message?.content ?? [])
          .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (text.trim()) {
          opts.onOutput?.(text);
          bus.emit({ type: 'chat', from: role.id, msg: text, parentId: getLastMessageId() });
          // #11: a context-window overflow surfaces here as an "API Error: …
          // context window limit" assistant message. The boss can't recover from
          // this (every later turn returns the same +0-token error) and it isn't
          // a crash, so without this signal the idle watchdog just nudges a dead
          // boss for 30 minutes. Fire the callback once so the daemon restarts.
          if (opts.onContextLimit && !contextLimitFired && CONTEXT_LIMIT_RE.test(text)) {
            contextLimitFired = true;
            bus.emit({ type: 'audit', from: role.id, reason: 'boss-context-limit', msg: 'coordinator context window exhausted — requesting whole-org restart with fresh sessions' });
            opts.onContextLimit();
          }
        }
      } else if (m.type === 'result') {
        const tokens = (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0);
        policy.addUsage(tokens);
        bus.emit({ type: 'usage', from: role.id, data: { tokens, cost_usd: m.total_cost_usd, subtype: m.subtype } });
        // A result whose subtype is anything but `success` is the SDK reporting
        // a failed turn - hit max_turns, refused, rate/usage limited, errored
        // mid-execution. Recording it only as a usage event made those
        // indistinguishable from a healthy turn: three consecutive cycles once
        // produced zero tool calls and zero messages, and the sole signal was
        // the idle watchdog firing 20 minutes later with no stated cause.
        if (m.subtype && m.subtype !== 'success') {
          // max_turns means the role was actively working and got capped - the
          // caller pushes a continuation so the restarted session resumes work
          // instead of blocking on an empty mailbox.
          if (m.subtype === 'error_max_turns') hitTurnLimit = true;
          bus.emit({
            type: 'audit', from: role.id, reason: 'session-result-error',
            msg: `turn ended with subtype "${m.subtype}"${m.is_error ? ' (is_error)' : ''} - the role produced no usable output`,
          });
          // Circuit breaker: count consecutive non-success, non-max-turns results.
          // max_turns is a normal session lifecycle event, not a failure.
          if (opts.circuitBreaker && m.subtype !== 'error_max_turns') {
            const cb = opts.circuitBreaker;
            cb.state.failures++;
            if (cb.state.failures >= cb.threshold) {
              cb.state.tripped = true;
              bus.emit({
                type: 'audit', from: role.id, reason: 'circuit-breaker-tripped',
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
          bus.emit({ type: 'status', from: role.id, msg: 'token budget exhausted - closing session' });
          mailbox.close();
        }
      }
      }
    } finally {
      clearTimeout(silentAlarm);
    }
    bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
    return { sessionId, hitTurnLimit };
  } catch (err) {
    bus.emit({ type: 'status', from: role.id, msg: `session error: ${(err as Error).message}` });
    throw err;
  }
}
