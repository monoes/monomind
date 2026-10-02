// packages/@monomind/cli/src/orgrt/agent-runner-types.ts
import type { z } from 'zod';
import type { SubagentEvent } from './agent-runner-claude-subagent.js';
import type { OrgEffortLevel } from './cost-tier.js';

/** A platform-agnostic org tool definition. `schema` is a zod object because
 *  both the Claude SDK's `tool()` and opencode's `tool()` consume zod. */
export interface OrgToolDef {
  name: string;
  description: string;
  /** zod shape object (e.g. { query: z.string() }), NOT a z.object() instance.
   *  Both the Claude SDK's tool() and opencode's tool() consume a shape. */
  schema: Record<string, z.ZodType<any>>;
  /** Schema for argument keys `schema` does not list. Unset: unlisted keys are
   *  stripped. Set (a provider tool whose JSON Schema allows
   *  additionalProperties): they are kept and validated against it. */
  catchall?: z.ZodType<any>;
  /** Reject argument keys `schema` does not list instead of stripping them
   *  (the built-in org tools). `hints` maps a key callers are known to
   *  confuse with a real one to the correction the error names. */
  strict?: { hints?: Record<string, string> };
  /** #389: calls to this tool made in one assistant message may run at the
   *  same time (agent exec's caller tools: each is its own stdio round trip,
   *  matched by id). Fence runners start such a round's calls together;
   *  ClaudeAgentRunner marks the tool `readOnlyHint`, which is what makes
   *  Claude Code run MCP calls concurrently. Unset: one after another. */
  concurrent?: boolean;
  handler: (args: Record<string, unknown>) => Promise<{ text: string }>;
}

/** Arguments every runner needs to execute one agent session. */
export interface AgentRunArgs {
  tools: OrgToolDef[];
  /** #355. `full` = ClaudeAgentRunner sets `permissionMode: 'bypassPermissions'`
   *  + `allowDangerouslySkipPermissions: true`; a subprocess runner whose
   *  RunnerSpec.supportsFullAccess is true runs its CLI's own no-approval,
   *  no-sandbox mode in a process group (process-group-spawn.ts). Unset/
   *  `scoped` = today's behavior, byte-identical. Set by agent-exec.ts and
   *  full-access org roles (#365). Runners without full access ignore it.
   *  `read` (#388, agent exec only) = the CLI's own read-only mode on a
   *  runtime whose RunnerSpec.readAccess is true (runner-access.ts); claude
   *  gets it from the caller's canUseTool instead. */
  access?: 'scoped' | 'read' | 'full';
  /** #396 (agent exec `--sandbox`, rev 23): the vendor CLI's own sandbox
   *  mode, already capped by the role's git level (runner-sandbox.ts).
   *  Unset or `full` = today's behaviour. Each runner acts only on the
   *  modes RUNNER_SANDBOX_MODES lists for it (#482 added `restricted` and
   *  copilot/antigravity/opencode/pi); agent-exec refuses the rest. */
  sandbox?: 'read-only' | 'restricted' | 'workspace-write' | 'full';
  /** The mailbox prompt stream (or any async iterable of prompt messages). */
  prompt: AsyncIterable<any>;
  systemPrompt: string;
  model?: string;
  /** ADR-O001 D8: abstract reasoning/thinking effort for this session, set by
   *  the role's cost tier (see orgrt/cost-tier.ts). Provider-agnostic on
   *  purpose — each runner maps it to its own mechanism, and a runner with no
   *  such mechanism ignores it. ClaudeAgentRunner maps it to the SDK's own
   *  `effort` option ('off' → `thinking: { type: 'disabled' }`); the vendor
   *  CLI runners take only `--model`, so a tier expresses their effort
   *  through `cost_tiers.providers.<key>.effort_env` (which arrives in `env`)
   *  or by naming an effort-encoding model id per tier. Unset = today's
   *  behavior: the provider's own default. */
  effort?: OrgEffortLevel;
  cwd: string;
  env: Record<string, string>;
  /**
   * o-18: only `ClaudeAgentRunner` consults this — the 12 vendor runners
   * always strip ambient ANTHROPIC_* creds from process.env unconditionally
   * (no vendor CLI has a legitimate use for one). Claude is the one runtime
   * where an ambient Anthropic credential CAN be legitimate (that is what
   * API-key mode is), so it needs a signal rather than a blanket rule.
   * Defaults to `true` (safe: `args.env`, not the ambient process.env, is
   * authoritative for ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL/
   * ANTHROPIC_AUTH_TOKEN — matching `session.ts`'s already-resolved
   * `resolveProviderEnv` output). Only `orgrt/agent-exec.ts` sets this to
   * `false`, explicitly and with its own comment: it is the only caller
   * with no `--provider` concept at all, so preserving today's inherited-
   * credential behavior for `agent exec --runtime claude` requires opting
   * OUT of the safe default, not into an unsafe one. Making the safe path
   * the default means a future caller that forgets this field gets the
   * safe behavior, not a silent leak.
   */
  envAuthoritative?: boolean;
  maxTurns: number;
  /** Fence-protocol runners: tool rounds per mailbox message (#326). Unset =
   *  tool-fence.ts MAX_TOOL_ROUNDS. */
  maxToolRounds?: number;
  resume?: string;
  /** `meta.toolUseId` (#289) is the harness's id for this specific call —
   *  threaded through so the invocation event can be correlated with the
   *  `tool_result` message that reports how the call ended. */
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    meta?: { toolUseId?: string },
  ) => Promise<unknown>;
  /** Provider-specific escape hatch. ClaudeAgentRunner merges this into the
   *  SDK options verbatim (e.g. the `_orgTest` seam used by test-loop.ts).
   *  Other runners ignore it. */
  extras?: Record<string, unknown>;
  /** OS sandbox settings and permission deny rules enforcing the role's
   *  policy.git (#258, role-sandbox.ts). ClaudeAgentRunner passes them to
   *  query() as `sandbox` / `disallowedTools`; other runners ignore them. */
  claudeRestrictions?: { sandbox?: Record<string, unknown>; disallowedTools?: string[] };
  /** bubblewrap arguments hiding human authority (authority-mask.ts) from a
   *  role that runs outside the SDK sandbox. Subprocess runners launch their
   *  CLI inside it; ClaudeAgentRunner launches the Claude Code process in it. */
  authorityMask?: string[];
  /** Coder mode (#356): `--settings` sources to load via the SDK's own
   *  discovery ('user'/'project'/'local' settings.json, CLAUDE.md, skills,
   *  hooks, project+user MCP servers). A subprocess runner reads non-empty
   *  as "do not isolate the CLI's own config" (its sources are all or
   *  nothing); runners with no such isolation ignore it. Unset/`[]` = today's isolated behavior (settingSources: [],
   *  strictMcpConfig: true, plain-string system prompt) — see
   *  agent-runner-claude-settings.ts. */
  settingSources?: Array<'user' | 'project' | 'local'>;
  /** #359: full-access only. Called synchronously once a runner spawns
   *  its agent CLI process (ClaudeAgentRunner, and every subprocess runner
   *  via process-group-spawn.ts's `spawnRunnerProcess`), with its pid and a handle
   *  onto the tree tracker (`process-tree.ts`'s `trackDescendants`) that
   *  has been sampling its process tree since spawn — lets a caller
   *  (agent-exec.ts) discover background survivors on a normal end_turn,
   *  including ones whose launching shell has since exited (a point-in-
   *  time walk from this pid alone would miss those — see process-tree.ts's
   *  module doc), without a new AgentMessage frame every runner would need
   *  to implement. Runners that don't spawn a real OS process, or that
   *  don't support `access: 'full'`, never call it. */
  onProcessSpawned?: (info: {
    pid: number;
    getBackgroundSurvivors: () => { pids: number[]; supported: boolean };
  }) => void;
  /** ADR-O001 D2: directory for spilled tool-result bodies. When set,
   *  ClaudeAgentRunner installs a PostToolUse hook that writes an oversized
   *  result here in full and replaces it in the transcript with a bounded
   *  digest plus this path (see tool-spill.ts). Claude-only: no vendor CLI
   *  exposes an equivalent seam. Unset = today's unbounded behavior. */
  toolSpillDir?: string;
  /** Abort hook. An async generator's return() queues behind its in-flight
   *  next(), so a subprocess runner blocked in `for await (child.stdout)`
   *  never reaches its finally/kill on return() alone — the child is
   *  orphaned. Aborting this signal makes every subprocess runner kill its
   *  child (SIGTERM, then SIGKILL) so the blocked pull unblocks and the
   *  turn fails; the in-process Claude runner forwards it to the SDK's
   *  abortController. Fired by agent-exec.ts's terminate() and session.ts's
   *  silent-stream abort. */
  signal?: AbortSignal;
  /** #550: the role's token budget as the org meters it (policy's
   *  budgetedUsage basis). `left` is 0 once the session was closed for
   *  budget, including by the org-wide ceiling; `max` is the role's ceiling;
   *  undefined = no token budget. Read by runners whose CLI reports usage
   *  only per completed step or exec (runner-usage.ts); others ignore it. */
  tokenBudget?: () => { left: number; max?: number } | undefined;
  /** The role's USD budget left (policy.maxUsd minus recorded spend); `left`
   *  is 0 once the session was closed for budget; undefined = no USD cap. The
   *  Claude runner passes it to the SDK as the query's maxBudgetUsd and starts
   *  no query when nothing is left. */
  usdBudget?: () => { left: number } | undefined;
  /** Claude runner, org sessions: when `signal` aborts, interrupt the query
   *  first so the SDK reports its cost so far, and abort it only after this
   *  many ms. Unset = abort at once (agent exec, one-shot callers). */
  interruptGraceMs?: number;
}

/** Wire `signal` to a child-process kill ladder: SIGTERM on abort, SIGKILL
 *  after `graceMs` if the child is still alive. If the signal is already
 *  aborted the ladder fires immediately (the runner was asked to stop before
 *  this turn spawned). Returns an unsubscribe for the runner's cleanup path;
 *  the escalation timer is unref'd and a kill() on an exited ChildProcess
 *  is a no-op, so it needs no clearing. */
export function killOnAbort(
  signal: AbortSignal | undefined,
  child: { kill(signal?: NodeJS.Signals): unknown },
  graceMs = 5000,
): () => void {
  if (!signal) return () => {};
  const onAbort = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, graceMs);
    t.unref?.();
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

/** Normalized message every runner yields. Carries `session_id` on whatever
 *  message the underlying SDK attaches it to, so session.ts can track it for
 *  resume — matching the previous `if (m.session_id) sessionId = m.session_id`
 *  behaviour that read it off ANY message kind.
 *
 *  `tool_use` is a lightweight liveness/progress signal: session.ts never
 *  renders it as chat or usage — it only feeds the StateDetector (which maps
 *  it to the 'tool-call' state) and refreshes last-activity. Subprocess
 *  runners (kimicode) emit it for native tool activity so long turns show
 *  ongoing progress instead of looking silent.
 *
 *  #357: ClaudeAgentRunner additionally emits a richer 'tool_use' (id/name/
 *  input/parent id) for agent-exec.ts's tool_activity events, gated behind
 *  `extras.includePartialMessages` like every other agent-exec-only
 *  enrichment — session.ts never sets that flag, so this is invisible to it.
 *
 *  `tool_result` (#289) reports how ONE tool call ended: `tool_use_id`
 *  correlates it with the invocation, `tool` names the tool (resolved from the
 *  matching tool_use block, since the result block carries only the id),
 *  `is_error` is the outcome, `text` the raw result body (session.ts redacts
 *  and caps it before it reaches the bus), and `duration_ms` the wall time
 *  from the invoking turn to the result landing. A runner that cannot observe
 *  tool completion simply never yields it.
 *
 *  `input_tokens`/`output_tokens` on an 'assistant' message are that ONE
 *  model turn's real token usage (from the Claude SDK's BetaMessage.usage),
 *  as opposed to the 'result' message's usage, which the SDK's own type docs
 *  describe as per-turn (i.e. just the last turn) rather than a cumulative
 *  total for the whole streaming-input message — see session.ts's
 *  per-assistant-turn budget accounting for why this distinction matters.
 *
 *  `status` (#356): startup progress, ClaudeAgentRunner-only and only when
 *  `AgentRunArgs.settingSources` is non-empty (coder mode) — see its own
 *  doc comment there and agent-exec-settings.ts's startup watchdog. */
export interface AgentMessage {
  type: 'assistant' | 'result' | 'tool_use' | 'tool_result' | 'status' | 'subagent';
  session_id?: string;
  text?: string; // assistant (prose) / tool_use (short progress label) / tool_result (body)
  phase?: 'initializing' | 'ready'; // status only
  mcp_servers?: { name: string; status: string }[]; // status(phase:'ready') only
  subtype?: string; // result
  is_error?: boolean; // result, tool_result
  tool_use_id?: string; // tool_use (#357), tool_result
  tool?: string; // tool_use (#357), tool_result
  /** #357: raw tool input as the model sent it (native tool_use only).
   *  Rev 19: a vendor runner translates its CLI's native shape into the
   *  canonical keys for `kind` (doc §3.2); claude keeps its own input. */
  input?: Record<string, unknown>; // tool_use
  /** Rev 19: normalized tool kind (tool-kind.ts's ToolKind) when the runner
   *  knows it; unset = derived from `tool`'s name. */
  kind?: string; // tool_use
  /** Rev 19: a shell call's exit code, when the CLI reports one. */
  exit_code?: number; // tool_result
  /** #357: non-null when produced inside a Task/Agent subagent's own turn —
   *  lets a caller nest tool_activity events under the subagent's call. */
  parent_tool_use_id?: string | null; // tool_use
  /** #387: ClaudeAgentRunner only, agent-exec opt-in (see SubagentEvent).
   *  An `assistant` message with a non-null `parent_tool_use_id` is that
   *  subagent's own text, not the main agent's. */
  subagent?: SubagentEvent; // subagent
  duration_ms?: number; // tool_result
  /** Rev 20: the runner's own policy refused the call (it never ran) — the
   *  tool_activity end then carries `ok:false, denied:true`, as a denial by
   *  claude's canUseTool does. */
  denied?: boolean; // tool_result
  /** #597: the API response this assistant message belongs to (Claude's
   *  `message.id`). One response can arrive as several messages repeating
   *  the same usage, so the meter counts each response once. Unset when the
   *  runner does not report it. */
  response_id?: string; // assistant
  input_tokens?: number; // result, assistant (that turn's own usage)
  output_tokens?: number; // result, assistant (that turn's own usage)
  /** ADR-O001 D1: cache tokens are SIBLINGS of input_tokens in the Anthropic
   *  API (verified against @anthropic-ai/sdk's BetaUsage), not subsets of it —
   *  `input_tokens` is the uncached remainder. Both are billable (~0.1x and
   *  ~1.25x the input rate), so a meter that ignores them reports ~0.3% of a
   *  well-cached run. A runner whose provider does not report them omits
   *  them. */
  cache_read_input_tokens?: number; // result, assistant
  cache_creation_input_tokens?: number; // result, assistant
  /** ADR-O001 D1: result only, and only from runners whose SDK reports
   *  whole-pipeline usage — the Claude Agent SDK's `modelUsage`, which covers
   *  Task subagents, sidechains and compaction that its `usage` field
   *  explicitly excludes ("MAIN AGENT LOOP ONLY ... Prefer modelUsage for
   *  token/cost accounting"). Like `cost_usd` it is CUMULATIVE per session,
   *  not per turn, so session.ts converts it to a delta against the previous
   *  value for the same session_id instead of adding it. */
  cumulative_tokens?: {
    input: number;
    output: number;
    cache_read: number;
    cache_creation: number;
  };
  cost_usd?: number; // result
}

export interface AgentRunner {
  /** #550: true for runners that refuse to start a CLI exec below the
   *  budget floor (runner-usage.ts's budgetRefusal) — a role closed that way
   *  counts as out of budget until its cap is raised (budget-closure.ts). */
  readonly budgetFloorGated?: boolean;
  run(args: AgentRunArgs): AsyncIterable<AgentMessage>;
}
