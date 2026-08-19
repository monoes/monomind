// packages/@monomind/cli/src/orgrt/session.ts
import { z } from 'zod';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { OrgBus } from './bus.js';
import type { PolicyEngine, Decision } from './policy.js';
import { Mailbox } from './mailbox.js';
import type { OrgDef, OrgRole } from './types.js';
import type { RoleFence } from './fence.js';
import { scanInput } from './fence.js';
import type { AgentRunner, AgentMessage, OrgToolDef } from './agent-runner.js';
import { ClaudeAgentRunner, defaultClaudeRunner } from './agent-runner.js';
import { StateDetector } from './state-detector.js';

/** How long an SDK stream may stay open with zero messages before we say so.
 *  Comfortably longer than a slow first turn, shorter than the idle watchdog's
 *  10-minute window so the specific cause is reported before the generic
 *  "boss appears hung". */
const SILENT_SESSION_MS = 4 * 60_000;
const CONTEXT_LIMIT_RE = /context.window.limit|context.length.exceeded|maximum.context/i;
import { resolveProviderEnv } from './provider.js';

/** Per-vendor/per-runtime default models. Used when a role doesn't pin
 *  adapter_config.model explicitly. Explicit model always wins. */
const VENDOR_DEFAULTS: Record<string, string> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-sonnet-5',
  glm: 'glm-5.2',
  google: 'gemini-3.1-pro',
  xai: 'grok-4.5',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
  groq: 'moonshotai/kimi-k2-instruct-0905',
  together: 'zai-org/GLM-5',
  fireworks: 'accounts/fireworks/models/glm-5p2',
  cohere: 'command-a-reasoning-08-2025',
  perplexity: 'sonar-reasoning-pro',
  alibaba: 'qwen3-max',
  openrouter: 'anthropic/claude-sonnet-5',
  ollama: 'llama3.3',
  'openai-compatible': '',
};

/** Resolve the model string for a role: explicit adapter_config.model wins;
 *  otherwise fall back to the vendor/runtime default. */
export function resolveModel(
  role: OrgRole,
  runtime?: string,
  vendor?: string,
): string {
  const explicit = role.adapter_config?.model;
  if (explicit) return explicit;
  if (vendor && VENDOR_DEFAULTS[vendor]) return VENDOR_DEFAULTS[vendor];
  switch (runtime) {
    case 'claude': return 'claude-sonnet-4-5';
    // Kimi Code CLI namespaces model ids as <provider>/<model> (its own
    // default_model is "kimi-code/kimi-for-coding-highspeed") — a bare "k3"
    // 404s with "Model \"k3\" is not configured in config.toml".
    case 'kimicode': return 'kimi-code/k3';
    case 'opencode': return 'glm-5.2';   // opencode is typically paired with a vendor; this is the bare-runtime fallback
    case 'codex': return 'gpt-5.6-terra';
    case 'antigravity': return 'gemini-3.6-flash-high';
    case 'vercel': return 'gpt-5.5';
    default: return 'claude-sonnet-4-5';
  }
}

export type DeliverFn = (from: string, to: string, subject: string, body: string) => Promise<string>;

/** The SDK's `canUseTool` gate, composed from two independent layers: PolicyEngine's
 *  static config checks (deny/allow lists, path scoping, git level, web allowlist,
 *  budget), then — only for calls policy would allow — the human-approval guardrail
 *  (`beforeTool`, i.e. daemon.checkApproval) for whatever action names it treats as
 *  sensitive (Bash/WebFetch/WebSearch/org_complete). Exported standalone so this
 *  composition is unit-testable without spinning up a real SDK session: previously
 *  `beforeTool` was wired into SessionOpts but never actually called from here, so
 *  none of those sensitive actions ever paused for a human. */
export function gatedCanUseTool(
  policy: PolicyEngine,
  beforeTool: SessionOpts['beforeTool'],
  roleId: string,
  fence?: RoleFence,
  /** Optional hook invoked whenever this gate denies a tool call — wired to
   *  daemon.recordDecision() so denials show up in `org decisions` traces. */
  onDeny?: (toolName: string, input: Record<string, unknown>, decision: Extract<Decision, { behavior: 'deny' }>) => void,
  /** ORG-9: reports whether this role has a pending (unresolved) decision gate.
   *  org_gate is documented as creating a "hard-blocking" checkpoint, but until
   *  this was wired in nothing actually stopped tool use while a gate sat
   *  pending — only approvals did that. When set and true, ALL tool calls are
   *  denied (not just the sensitive subset approvals gate) until the gate is
   *  resolved, matching the "hard-blocking" description. */
  hasPendingGate?: () => boolean,
): (toolName: string, input: Record<string, unknown>) => Promise<Decision> {
  return async (toolName: string, input: Record<string, unknown>): Promise<Decision> => {
    if (hasPendingGate?.()) {
      const decision: Decision = {
        behavior: 'deny',
        message: `Tool "${toolName}" is blocked — awaiting gate resolution. A decision gate is pending; wait for a human to approve or reject it via 'monomind org gate-approve/gate-reject'.`,
      };
      onDeny?.(toolName, input, decision);
      return decision;
    }
    if (fence) {
      const text = typeof input.command === 'string' ? input.command
        : typeof input.content === 'string' ? input.content
        : typeof input.url === 'string' ? input.url
        : JSON.stringify(input);
      const fenceDecision = await scanInput(fence.instance, text, fence.abortThreshold);
      if (fenceDecision.behavior === 'deny') {
        onDeny?.(toolName, input, fenceDecision);
        return fenceDecision;
      }
    }
    const decision = await policy.decide(toolName, input);
    if (decision.behavior === 'deny') {
      onDeny?.(toolName, input, decision);
      return decision;
    }
    if (!beforeTool) return decision;
    const approved = await beforeTool(roleId, toolName);
    if (approved === false) {
      const denied: Decision = { behavior: 'deny', message: `Tool "${toolName}" was denied by guardrail approval` };
      onDeny?.(toolName, input, denied);
      return denied;
    }
    if (approved === null) {
      const pending: Decision = { behavior: 'deny', message: `Tool "${toolName}" is pending human approval — it will be available once approved or denied via 'monomind org approve/deny'.` };
      onDeny?.(toolName, input, pending);
      return pending;
    }
    return decision;
  };
}

export interface SessionOpts {
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
  deliver: DeliverFn;
  askHuman?: (role: string, question: string) => Promise<string>;
  /** Coordinator-only: records the run's outcome (daemon persists it to run history). */
  onComplete?: (role: string, outcome: 'achieved' | 'partial' | 'failed', summary: string) => void;
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
  /** Called whenever gatedCanUseTool denies a tool call — wired to daemon.recordDecision()
   *  so those denials show up in `org decisions` traces. */
  onDecision?: (role: string, toolName: string, message: string) => void;
  /** ORG-9: reports whether this role currently has a pending decision gate —
   *  wired to daemon.listGates(org, 'pending'). When true, gatedCanUseTool
   *  denies every tool call until the gate is resolved. */
  hasPendingGate?: () => boolean;
  def?: OrgDef;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
  /** Provider-agnostic runner. Takes precedence over queryFn. When unset,
   *  session.ts builds a ClaudeAgentRunner from queryFn (or the default),
   *  preserving the previous Claude-only behaviour exactly. */
  runner?: AgentRunner;
  /** ID of the last message received by this agent (for threading responses). Function to ensure live reading. */
  lastMessageId?: () => string | undefined;
  /** Callback for each output line — feeds ScrollbackBuffer. */
  onOutput?: (line: string) => void;
  /** Callback when the SDK assigns a session ID — enables checkpoint resume (P2-13). */
  onSessionId?: (id: string) => void;
  /** SDK session ID persisted in a checkpoint from a prior run — when set, the
   *  first query() call resumes it instead of starting a fresh conversation
   *  (P2-13: this is what actually makes checkpoint resume resume). */
  resumeSessionId?: string;
  /** Circuit breaker config for this role. */
  circuitBreaker?: { threshold: number; state: { failures: number; tripped: boolean } };
  /** Called when the coordinator's context window is exhausted. */
  onContextLimit?: () => void;
  /** MonoFence guardrail instance for this role. */
  fence?: RoleFence;
  /** Decision gate: creates a hard-blocking human-approval checkpoint. */
  onGate?: (role: string, name: string, description: string) => Promise<string>;
  /** Task DAG: create a task with dependencies. */
  createTask?: (role: string, title: string, assignee: string, deps: string[]) => string;
  /** Task DAG: mark a task as completed. */
  completeTask?: (role: string, taskId: string, result?: string) => string;
  /** Task DAG: list all tasks. */
  listTasks?: () => string;
  splitTask?: (role: string, parentId: string, children: { title: string; assignee: string }[]) => string;
  mergeTask?: (role: string, sourceId: string, targetId: string) => string;
  cancelTask?: (role: string, taskId: string, reason?: string) => string;
  /** Task DAG: mark a 'running' task as waiting on a real-world time (not a
   *  dependency) — e.g. a scheduled soak test, a CI run, a human-set
   *  deadline. The idle watchdog skips nudging while any task is actively
   *  blocked, and auto-resumes (re-dispatches) it once the time passes. */
  blockTask?: (role: string, taskId: string, untilIso: string, reason?: string) => string;
  planGraph?: (role: string, specs: { name: string; title: string; assignee: string; after?: string[] }[]) => string;
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
    `The work graph is dynamic: call org_task_split when scope expands, org_task_merge when parallel branches converge early, or org_task_cancel when evidence makes a planned task moot. Use org_plan_graph to propose a full work graph in one call when you know the plan upfront. If a task genuinely can't proceed until a specific real-world time — a scheduled long-running process, a deadline someone gave you, anything with a known future unblock time — call org_task_block instead of leaving it idle: it stops the idle watchdog from nudging you about it and automatically resumes the task when the time arrives, instead of you repeatedly re-confirming "still waiting" every idle cycle.`,
    `Before starting substantial work, call org_recall to check what previous runs already learned or delivered - do not redo finished work.`,
    `The user's documents (notes, handbooks, specs) are searchable with knowledge_search - ground your work in them instead of guessing; results labeled [global] come from the user's personal cross-project brain.`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    isCoordinator
      ? `When the org's goal for this run is achieved (or clearly can't be): first call org_learn ONCE with the durable knowledge this run produced, then call org_complete exactly once with the outcome and a concise summary. Then end your turn.`
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
  // Seeded from opts.resumeSessionId (a checkpoint's persisted sessionId) when
  // this is a checkpoint resume, not a fresh run — P2-13.
  let resumeSessionId: string | undefined = opts.resumeSessionId;
  // #149: a resumeSessionId seeded from a persisted checkpoint (org run
  // --resume) points at an SDK session that may no longer exist on the
  // provider's side by the time resume happens — hours can pass between
  // `org stop` and `org run --resume`. Track whether we've already tried
  // falling back to a fresh session for THIS specific session id, so a
  // stale checkpoint session gets one recovery attempt instead of crashing
  // the whole role outright, but a second failure (a real, non-staleness
  // error) still crashes normally rather than looping forever.
  const initialResumeSessionId = opts.resumeSessionId;
  let triedFreshAfterResumeFailure = false;
  // #1: when a session ends on the turn limit mid-work, push a continuation so
  // the restarted query() has input to act on instead of blocking on an empty
  // mailbox until the 10-minute idle watchdog. Bounded: if the role consumed no
  // real message since the last restart (it is spinning on its own
  // continuations), stop auto-pushing after MAX_CONTINUATIONS and let the
  // watchdog re-engage — so a stuck role can't burn tokens forever.
  const MAX_CONTINUATIONS = 3;
  let consecutiveSpin = 0;
  // The SDK's result message reports total_cost_usd CUMULATIVELY for the whole
  // SDK session: one query() call stays open across every mailbox message
  // (streaming-input mode) and emits one result per message, and the running
  // total even survives a resume after a maxTurns restart. daemon.ts and
  // reporting.ts both SUM the cost_usd of usage events, so forwarding the raw
  // value charged every previous turn again on each new message - observed as
  // ~10-20x cost inflation on long org runs. Track the last-seen total per
  // SDK session id here (it must outlive individual runOneSession calls,
  // since resume continues the same billing session) and emit only deltas.
  const sessionCostTotals = new Map<string, number>();
  // Always run at least once: a mailbox can be closed with queued items still
  // pending (stream() drains the queue before honoring `closed`), which is a
  // normal, valid starting state - checking isClosed before the first run
  // would skip that drain entirely.
  while (true) {
    const realBefore = mailbox.consumedRealCount;
    let sessionId: string | undefined;
    let hitTurnLimit: boolean | undefined = false;
    try {
      const res = await runOneSession(opts, resumeSessionId, sessionCostTotals);
      sessionId = res.sessionId;
      hitTurnLimit = res.hitTurnLimit;
      resumeSessionId = sessionId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (/Reached maximum number of turns|error_max_turns/i.test(errMsg)) {
        // Runner/SDK threw an error on max turns or exhausted turns on resume.
        // Drop the dead resumeSessionId and grant continuation turn with fresh session.
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = true;
      } else if (
        resumeSessionId &&
        resumeSessionId === initialResumeSessionId &&
        !triedFreshAfterResumeFailure
      ) {
        // #149: first failure on a checkpoint-provided session id — treat as
        // a stale/expired resume, not a genuine crash. Retry once with a
        // fresh session before falling into the crash/backoff path below;
        // a second failure with no resumeSessionId in play is a real error.
        triedFreshAfterResumeFailure = true;
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = false;
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'resume-session-stale',
          msg: `agent "${opts.role.id}" could not resume its prior session (${errMsg}) — retrying with a fresh session`,
        });
      } else {
        throw err;
      }
    }
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
async function runOneSession(opts: SessionOpts, resume?: string, costTotals?: Map<string, number>): Promise<{ sessionId?: string; hitTurnLimit?: boolean }> {
  const { org, role, bus, policy, mailbox, cwd } = opts;
  // Read lastMessageId live from opts instead of capturing at session start
  // This ensures chat responses link to the most recent message delivered
  const getLastMessageId = () => opts.lastMessageId ? opts.lastMessageId() : undefined;

  // Resolve runner. Precedence: explicit runner > queryFn-wrapped > default.
  // queryFn stays supported so daemon.ts / test-loop.ts need no changes.
  const runner: AgentRunner = opts.runner
    ?? (opts.queryFn ? new ClaudeAgentRunner(opts.queryFn) : defaultClaudeRunner);

  const tools = buildOrgTools(opts);

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  let sessionId: string | undefined = resume;
  let hitTurnLimit = false;
  let contextLimitFired = false;
  try {
    const stream = runner.run({
      tools,
      prompt: mailbox.stream(),
      systemPrompt: buildRolePrompt(role, (opts.def ?? { name: org, goal: '' }) as OrgDef,
        opts.def?.roles.map(r => r.id) ?? [role.id], opts.glossary),
      model: resolveModel(role, role.runtime, role.provider?.vendor),
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
        MONOMIND_GRAPH_GATE: 'off',
        MONOMIND_SDK_AGENT: '1',
        // Per-role scoping for runners that persist state under the org dir
        // (VercelAgentRunner session files). Without these, session files would
        // land in args.cwd (project root for workspace:'repo') under the literal
        // 'default' roleId, polluting the repo and making files unattributable.
        MONOMIND_ORG_DIR: opts.orgDir ?? opts.cwd,
        MONOMIND_ROLE_ID: role.id,
      },
      maxTurns: opts.maxTurns ?? 30,
      resume,
      canUseTool: gatedCanUseTool(policy, opts.beforeTool, role.id, opts.fence,
        opts.onDecision
          ? (toolName, _input, decision) => opts.onDecision!(role.id, toolName, decision.message ?? 'denied')
          : undefined,
        opts.hasPendingGate),
      // test seam forwarded through extras: lets the scripted fake SDK
      // (test-loop.ts) drive org_send and tool calls through the real
      // deliver/policy paths; the real SDK ignores it.
      extras: opts.runner ? undefined : {
        _orgTest: {
          deliver: (to: string, subject: string, body: string) => opts.deliver(role.id, to, subject, body),
          callTool: (name: string, input: Record<string, unknown>) => policy.decide(name, input),
        },
      },
      // VercelAgentRunner-only fields — ignored by other runners.
      vendor: role.provider?.vendor,
      providerConfig: role.provider,
    } as any);

    // A silent session is its own failure mode, and until now an unnameable
    // one: nine consecutive cycles of a scheduled org opened all seven streams
    // and yielded NOTHING - no assistant message, no result, no error, and no
    // stream end. The only symptom was the idle watchdog reporting the boss
    // "appears hung" twenty minutes later, which described neither the scope
    // (every role) nor the cause.
    //
    // Naming it used to be all this did: log an audit event at 4 minutes and
    // then keep waiting on the same stuck `for await`, so recovery still
    // depended on the org-wide idle watchdog (10m nudge + 10m stop = 20m of
    // dead time per cycle - and it kills the WHOLE run, not just the stuck
    // session). Only the FIRST pull from the stream is raced against the
    // timeout: once any message has arrived the session is demonstrably
    // alive, so a slow-but-working tool call is never mistaken for a stall.
    // On silence, abandon this attempt (best-effort iterator.return() to
    // signal the SDK) and throw - the caller's crash-retry-with-backoff loop
    // (daemon.ts's `runtime.done`) already knows how to retry a failed
    // session with a fresh query() call and, for the boss, escalate to a
    // whole-org restart if it keeps failing. That gives the SDK several
    // fresh attempts within a single cycle instead of one silent attempt
    // followed by twenty minutes of nothing.
    const openedAt = Date.now();
    const detector = new StateDetector();
    const iterator = stream[Symbol.asyncIterator]();
    const SILENT = Symbol('silent');
    let silentTimer: ReturnType<typeof setTimeout> | undefined;
    const firstPull = await Promise.race([
      iterator.next(),
      new Promise<typeof SILENT>(resolve => {
        silentTimer = setTimeout(() => resolve(SILENT), SILENT_SESSION_MS);
        (silentTimer as { unref?: () => void }).unref?.();
      }),
    ]);
    clearTimeout(silentTimer);
    if (firstPull === SILENT) {
      bus.emit({
        type: 'audit', from: role.id, reason: 'session-silent',
        msg: `SDK stream open ${Math.round((Date.now() - openedAt) / 1000)}s with zero messages - aborting this attempt and retrying. Set MONOMIND_DEBUG=1 to log raw message types.`,
      });
      try {
        await Promise.race([
          iterator.return?.(undefined) ?? Promise.resolve(),
          new Promise<void>(r => { const t = setTimeout(() => r(), 2_000); (t as { unref?: () => void }).unref?.(); }),
        ]);
      } catch { /* best-effort */ }
      throw new Error(`org "${org}" role "${role.id}": SDK stream silent for ${Math.round(SILENT_SESSION_MS / 1000)}s with zero messages`);
    }
    const first: IteratorResult<AgentMessage> = firstPull;

    // Replay the first pulled message, then continue draining normally.
    async function* rest(): AsyncGenerator<AgentMessage> {
      if (!first.done) yield first.value;
      while (true) {
        const r = await iterator.next();
        if (r.done) return;
        yield r.value;
      }
    }

    for await (const m of rest()) {
      if (process.env.MONOMIND_DEBUG) {
        console.error(`[orgrt:${org}/${role.id}] runner message type=${m.type} subtype=${String(m.subtype ?? '-')}`);
      }
      if (m.session_id) {
        sessionId = m.session_id;
        // P2-13: propagate the session ID back to the daemon so checkpoints
        // can resume the SDK session after a crash/restart.
        opts.onSessionId?.(sessionId);
      }
      const prevState = detector.current();
      const textForDetect = m.type === 'assistant' ? (m.text || '') : undefined;
      const newState = detector.onMessage(m.type, m.subtype, textForDetect);
      if (newState !== prevState) {
        bus.emit({ type: 'status', from: role.id, reason: 'state-change', msg: `${prevState} → ${newState}`, data: { from: prevState, to: newState } });
      }
      if (m.type === 'assistant') {
        const text = m.text || '';
        if (text.trim()) {
          opts.onOutput?.(text);
          bus.emit({ type: 'chat', from: role.id, msg: text, parentId: getLastMessageId() });
          if (opts.onContextLimit && !contextLimitFired && CONTEXT_LIMIT_RE.test(text)) {
            contextLimitFired = true;
            bus.emit({ type: 'audit', from: role.id, reason: 'boss-context-limit', msg: 'coordinator context window exhausted — requesting whole-org restart with fresh sessions' });
            opts.onContextLimit();
          }
        }
      } else if (m.type === 'result') {
        const tokens = (m.input_tokens ?? 0) + (m.output_tokens ?? 0);
        policy.addUsage(tokens);
        // Convert the SDK's cumulative-per-session total_cost_usd into a
        // per-result delta before emitting - downstream sums usage events.
        // costTotals is keyed by session_id, so a genuinely new/restarted
        // session (fresh sid, no prior entry) correctly gets its full
        // cumulative value as the delta. A same-sid value that ticks down
        // (rounding, a provider-side cost correction) is NOT a restart —
        // treating it as one would re-add the full cumulative cost and,
        // now that this feeds real USD budget enforcement (ORG-7), could
        // incorrectly close a well-behaved session's mailbox. Floor at 0
        // instead of re-adding the cumulative value in that case.
        let costDelta = m.cost_usd;
        if (costTotals && typeof m.cost_usd === 'number' && Number.isFinite(m.cost_usd)) {
          const sid = m.session_id ?? sessionId ?? '';
          const prev = costTotals.get(sid);
          costDelta = prev === undefined ? m.cost_usd : Math.max(0, m.cost_usd - prev);
          costTotals.set(sid, m.cost_usd);
        }
        // ORG-7: accumulate real USD cost so policy.overBudgetUsd (role.budget_usd) is enforceable.
        if (typeof costDelta === 'number' && Number.isFinite(costDelta)) policy.addUsageUsd(costDelta);
        bus.emit({ type: 'usage', from: role.id, data: { tokens, cost_usd: costDelta, subtype: m.subtype } });
        if (m.subtype && m.subtype !== 'success') {
          if (m.subtype === 'error_max_turns') hitTurnLimit = true;
          bus.emit({
            type: 'audit', from: role.id, reason: 'session-result-error',
            msg: `turn ended with subtype "${m.subtype}"${m.is_error ? ' (is_error)' : ''} - the role produced no usable output`,
          });
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
        // ORG-7: parallel USD-budget enforcement, same pattern as the token check above.
        if (policy.overBudgetUsd) {
          bus.emit({ type: 'status', from: role.id, reason: 'budget-exhausted', msg: 'USD budget exhausted - closing session' });
          mailbox.close();
        }
      }
    }
    bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
    return { sessionId, hitTurnLimit };
  } catch (err) {
    bus.emit({ type: 'status', from: role.id, msg: `session error: ${(err as Error).message}` });
    throw err;
  }
}

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

  if (opts.searchKnowledge) {
    tools.push({
      name: 'knowledge_search',
      description: 'Semantic search over the user\'s Second Brain: this project\'s indexed documents plus their personal cross-project global brain. Use to ground work in the user\'s actual notes, handbooks, and documents.',
      schema: { query: z.string() },
      handler: async (args) => text(await opts.searchKnowledge!(role.id, args.query as string)),
    });
  }
  if (opts.recall) {
    tools.push({
      name: 'org_recall',
      description: 'Search this org\'s accumulated memory from previous runs (outcomes, decisions, learnings). Use before starting work that may already have been done.',
      schema: { query: z.string() },
      handler: async (args) => text(await opts.recall!(role.id, args.query as string)),
    });
  }
  if (opts.remember) {
    tools.push({
      name: 'org_remember',
      description: 'Save a memory for future runs. scope "org" (default) shares it with the whole org; scope "agent" keeps it private to your role. Use for decisions, findings, and state worth recalling later - org_recall searches both.',
      schema: { content: z.string(), scope: z.enum(['org', 'agent']).optional() },
      handler: async (args) => text(await opts.remember!(role.id, args.content as string, (args.scope as 'org' | 'agent') ?? 'org')),
    });
  }
  if (opts.learn) {
    tools.push({
      name: 'org_learn',
      description: 'Persist durable knowledge from this run into the org\'s knowledge graph: entities ({name, type?, description?}), relationships ({source, target, relation, description?}) and reusable rules ({rule, context?}). Entities merge by name across runs - reuse the exact names listed in your briefing. Call once, before org_complete.',
      schema: {
        nodes: z.array(z.object({ name: z.string(), type: z.string().optional(), description: z.string().optional() })).optional(),
        edges: z.array(z.object({ source: z.string(), target: z.string(), relation: z.string(), description: z.string().optional() })).optional(),
        rules: z.array(z.object({ rule: z.string(), context: z.string().optional() })).optional(),
      },
      handler: async (args) => text(await opts.learn!(role.id, args as any)),
    });
  }
  // Gate purely on onComplete: the daemon passes it only to the role its
  // boss-selection rule picked, so tool availability always matches the
  // kickoff instruction (reports_to may be non-null for a fallback boss).
  if (opts.onComplete) {
    tools.push({
      name: 'org_complete',
      description: '⚠️ Ends the run — every agent session shuts down after this. Call exactly once, and only against the org\'s actual, full stated goal (see your briefing), never against just the current batch of dispatched tasks. "achieved" means the WHOLE goal is done, not "everyone assigned so far finished their piece" — a multi-phase or open-ended goal is very rarely achieved in a single run. If the current task batch is clearly done but the goal has more scope left: do NOT call this — use org_task/createTask to dispatch the next phase\'s work instead, so the org keeps making progress instead of stopping short. Use outcome "partial" only when you are ending the run with real scope still remaining (e.g. a genuine external stopping point, not merely "out of tasks right now" — if the only thing blocking further work is a scheduled process or deadline you know the time of, call org_task_block instead of ending the run, so a future run can pick back up automatically); "achieved" only when the full goal is met; "failed" only when it clearly cannot be. Before calling, check org_tasks — siblings with in-progress work only get a short drain window to finish before being cut off, so do not call this while others are still mid-build or mid-edit unless the run genuinely cannot continue. The outcome and summary are persisted to the org run history and briefed to the next run.',
      schema: { outcome: z.enum(['achieved', 'partial', 'failed']), summary: z.string() },
      handler: async (args) => {
        opts.onComplete!(role.id, args.outcome as 'achieved' | 'partial' | 'failed', args.summary as string);
        return text(`outcome "${args.outcome}" recorded`);
      },
    });
  }
  if (opts.onGate) {
    tools.push({
      name: 'org_gate',
      description: 'Create a decision gate — a hard-blocking human-approval checkpoint. Use before irreversible actions (deployments, deletions, external comms). The gate pauses your work until a human approves or rejects it. End your turn after calling this; you will receive the resolution as a new message.',
      schema: { name: z.string(), description: z.string() },
      handler: async (args) => text(await opts.onGate!(role.id, args.name as string, args.description as string)),
    });
  }
  if (opts.createTask) {
    tools.push({
      name: 'org_task',
      description: 'Create a task in the DAG with optional dependencies. Dependencies must be existing task IDs. Tasks become ready when all deps are done, then get dispatched to the assignee.',
      schema: { title: z.string(), assignee: z.string(), deps: z.array(z.string()).default([]) },
      handler: async (args) => text(opts.createTask!(role.id, args.title as string, args.assignee as string, (args.deps as string[]) ?? [])),
    });
    tools.push({
      name: 'org_task_done',
      description: 'Mark a task as completed and optionally provide a result summary. Any downstream tasks whose deps are now all done will become ready and be dispatched.',
      schema: { taskId: z.string(), result: z.string().optional() },
      handler: async (args) => text(opts.completeTask!(role.id, args.taskId as string, args.result as string | undefined)),
    });
    tools.push({
      name: 'org_tasks',
      description: 'List all tasks in the DAG with their current status and dependencies.',
      schema: {},
      handler: async () => text(opts.listTasks!()),
    });
  }
  if (opts.splitTask) {
    tools.push({
      name: 'org_task_split',
      description: 'Split a task into parallel children when scope expands. The parent becomes "split"; children inherit its deps; downstream tasks are rewired to depend on all children.',
      schema: { parentId: z.string(), children: z.array(z.object({ title: z.string(), assignee: z.string() })).min(1) },
      handler: async (args) => text(opts.splitTask!(role.id, args.parentId as string, (args.children as { title: string; assignee: string }[]) ?? [])),
    });
  }
  if (opts.mergeTask) {
    tools.push({
      name: 'org_task_merge',
      description: 'Merge one task into another when parallel branches converge early. The source becomes "merged"; downstream deps are rewired to the target.',
      schema: { sourceId: z.string(), targetId: z.string() },
      handler: async (args) => text(opts.mergeTask!(role.id, args.sourceId as string, args.targetId as string)),
    });
  }
  if (opts.cancelTask) {
    tools.push({
      name: 'org_task_cancel',
      description: 'Cancel a task as moot. The task becomes "cancelled" and unblocks downstream work.',
      schema: { taskId: z.string(), reason: z.string().optional() },
      handler: async (args) => text(opts.cancelTask!(role.id, args.taskId as string, args.reason as string | undefined)),
    });
  }
  if (opts.blockTask) {
    tools.push({
      name: 'org_task_block',
      description: 'Mark a task you are actively working (status "running") as blocked on a real-world time, not on other tasks — e.g. a scheduled soak test, a CI run that takes hours, a human-set deadline. Use this INSTEAD of leaving the task "running" with nothing actually happening, and instead of calling org_complete just because there is genuinely nothing to do right now: the idle watchdog will stop nudging you about this task until the time you give arrives, then automatically re-dispatch it to you. Give untilIso as an ISO 8601 date/time (e.g. "2026-08-19T09:00:00Z").',
      schema: { taskId: z.string(), untilIso: z.string(), reason: z.string().optional() },
      handler: async (args) => text(opts.blockTask!(role.id, args.taskId as string, args.untilIso as string, args.reason as string | undefined)),
    });
  }
  if (opts.planGraph) {
    tools.push({
      name: 'org_plan_graph',
      description: 'Propose a full work graph in one call. Each task spec uses a local "name" and references other specs by name in "after".',
      schema: { tasks: z.array(z.object({ name: z.string(), title: z.string(), assignee: z.string(), after: z.array(z.string()).default([]) })).min(1) },
      handler: async (args) => text(opts.planGraph!(role.id, (args.tasks as { name: string; title: string; assignee: string; after?: string[] }[]) ?? [])),
    });
  }
  tools.push({
    name: 'org_send',
    description: 'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.',
    schema: { to: z.string(), subject: z.string(), message: z.string() },
    handler: async (args) => {
      if (opts.beforeTool) {
        const approved = await opts.beforeTool(role.id, 'org_send');
        if (approved === false) return text('Tool "org_send" was denied by guardrail approval');
        if (approved === null) return text('Tool "org_send" is pending human approval - you will receive the result when it is approved or denied.');
      }
      const receipt = await deliver(role.id, args.to as string, args.subject as string, args.message as string);
      return text(receipt);
    },
  });
  tools.push({
    name: 'ask_human',
    description: 'Ask a human a free-form question and pause for their answer. Use only when you genuinely need human judgment.',
    schema: { question: z.string() },
    handler: async (args) => {
      if (!opts.askHuman) return text('ask_human is not available in this session');
      const receipt = await opts.askHuman(role.id, args.question as string);
      return text(receipt);
    },
  });
  return tools;
}
