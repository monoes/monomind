// packages/@monomind/cli/src/orgrt/agent-runner.ts
/**
 * AgentRunner — provider-agnostic execution surface for Org Runtime v2.
 *
 * Why this exists: session.ts used to import `query`, `tool`, and
 * `createSdkMcpServer` directly from `@anthropic-ai/claude-agent-sdk`, which
 * hard-coupled the entire org runtime to Claude. This interface lets session.ts
 * describe WHAT to run (an agent with a set of org tools, a system prompt, and
 * a mailbox prompt stream) without knowing WHICH SDK executes it.
 *
 * Behavior preservation (the invariant the Claude path must not break):
 * ClaudeAgentRunner is a faithful, line-for-line extraction of the previous
 * inline logic in session.ts's runOneSession — same options object, same
 * message normalization, same queryFn injection seam that test-loop.ts relies
 * on. The default runner is ClaudeAgentRunner, so an org that doesn't ask for
 * opencode executes through exactly the same code path it always did.
 */

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { z } from 'zod';
import { omitAnthropicManagedKeys } from './provider.js';

/** A platform-agnostic org tool definition. `schema` is a zod object because
 *  both the Claude SDK's `tool()` and opencode's `tool()` consume zod. */
export interface OrgToolDef {
  name: string;
  description: string;
  /** zod shape object (e.g. { query: z.string() }), NOT a z.object() instance.
   *  Both the Claude SDK's tool() and opencode's tool() consume a shape. */
  schema: Record<string, z.ZodType<any>>;
  handler: (args: Record<string, unknown>) => Promise<{ text: string }>;
}

/** Arguments every runner needs to execute one agent session. */
export interface AgentRunArgs {
  tools: OrgToolDef[];
  /** The mailbox prompt stream (or any async iterable of prompt messages). */
  prompt: AsyncIterable<any>;
  systemPrompt: string;
  model?: string;
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
  /** Abort hook. An async generator's return() queues behind its in-flight
   *  next(), so a subprocess runner blocked in `for await (child.stdout)`
   *  never reaches its finally/kill on return() alone — the child is
   *  orphaned. Aborting this signal makes every subprocess runner kill its
   *  child (SIGTERM, then SIGKILL) so the blocked pull unblocks and the
   *  turn fails; the in-process Claude runner forwards it to the SDK's
   *  abortController. Fired by agent-exec.ts's terminate() and session.ts's
   *  silent-stream abort. */
  signal?: AbortSignal;
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
 *  per-assistant-turn budget accounting for why this distinction matters. */
export interface AgentMessage {
  type: 'assistant' | 'result' | 'tool_use' | 'tool_result';
  session_id?: string;
  text?: string; // assistant (prose) / tool_use (short progress label) / tool_result (body)
  subtype?: string; // result
  is_error?: boolean; // result, tool_result
  tool_use_id?: string; // tool_result
  tool?: string; // tool_result
  duration_ms?: number; // tool_result
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
  run(args: AgentRunArgs): AsyncIterable<AgentMessage>;
}

/**
 * Default runner — wraps the Claude Agent SDK. This is the previous inline
 * logic of runOneSession, extracted verbatim:
 *   - convert OrgToolDef[] → SDK tool() calls → createSdkMcpServer
 *   - call queryFn({ prompt, options }) (queryFn injectable for tests)
 *   - normalize the raw stream into AgentMessage
 */
export class ClaudeAgentRunner implements AgentRunner {
  constructor(private queryFn: typeof query = query) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    // Wrap each OrgToolDef handler ({ text }) into the Claude SDK's
    // { content: [{ type: 'text', text }] } return shape.
    const sdkTools = args.tools.map((t) =>
      tool(t.name, t.description, t.schema, async (input: Record<string, unknown>) => {
        const r = await t.handler(input);
        return { content: [{ type: 'text' as const, text: r.text }] };
      }),
    );
    const orgServer = createSdkMcpServer({ name: 'org', version: '1.0.0', tools: sdkTools });

    // Forward args.signal to the SDK: aborting its controller stops the
    // in-process agent loop (no further tool calls) and ends the stream.
    const abortController = new AbortController();
    const unsubscribe = killOnAbort(args.signal, {
      kill: () => abortController.abort(),
    });

    // Incremental text streaming is opt-in via extras, not unconditional:
    // this runner has two independent consumers. agent-exec.ts (the Agent
    // Exec Protocol) wants incremental `assistant` messages — its own
    // protocol doc already documents the `assistant` frame as "Incremental
    // assistant text ... callers append" (doc/agent-exec-protocol.md §3.2)
    // — and sets this. session.ts (the org runtime) treats each
    // `assistant` AgentMessage as ONE COMPLETE TURN: it feeds the full text
    // into StateDetector's regex pattern-matching and emits ONE org
    // chat-bus event per turn (`bus.emit({type:'chat', ..., msg: text})`).
    // Streaming there unconditionally would fragment the chat log into
    // per-token pieces and pattern-match against incomplete prose.
    // session.ts never sets this (verified: its only `extras` use is the
    // `_orgTest` test seam, and only when no real runner is configured) —
    // so leaving this opt-in, rather than always-on, keeps the org runtime
    // byte-for-byte unchanged.
    const streamPartials = args.extras?.includePartialMessages === true;

    const stream = this.queryFn({
      prompt: args.prompt,
      options: {
        systemPrompt: args.systemPrompt,
        model: args.model,
        cwd: args.cwd,
        // The SDK's own default (`env = {...process.env}`) only applies when
        // this option is omitted entirely — passing `args.env` directly, even
        // as `{}` (the common case: most callers only set one or two
        // overrides, e.g. MONOMIND_CWD), replaces the ENTIRE spawned
        // process's environment with just that object. No inherited HOME,
        // USER, or PATH means the Claude CLI's Keychain-based credential
        // lookup can't resolve an account at all — observed as "Not logged
        // in" even though `claude auth status` succeeds fine on its own.
        // Merge onto process.env so args.env is additive overrides, matching
        // every other env-passing path in this codebase (e.g. monoagentcli's
        // own filteredEnviron()+overrides pattern).
        //
        // o-18: that additive merge undid resolveProviderEnv's subscription-
        // mode strip identically to every vendor runner — `...process.env`
        // put ANTHROPIC_API_KEY/BASE_URL/AUTH_TOKEN straight back whenever
        // `args.env` had already (correctly) omitted them, since a spread
        // cannot delete a key it doesn't have. Read against the SDK's own
        // bundled source (@anthropic-ai/claude-agent-sdk/sdk.mjs): it takes
        // a passed `env` option as-is and never independently re-derives it
        // from process.env, so there was no code-level protection here
        // despite this site sometimes being described as the one that
        // "worked" — it did not, at the monomind-code level.
        // `envAuthoritative` (default true, see AgentRunArgs) makes
        // `args.env` — not the ambient process.env — authoritative for
        // those three keys specifically, while every OTHER inherited var
        // (HOME/USER/PATH included, the keychain fix above) still merges
        // exactly as before.
        env:
          args.envAuthoritative === false
            ? { ...process.env, ...args.env }
            : { ...omitAnthropicManagedKeys(process.env), ...args.env },
        // Without these, the SDK falls back to its interactive-CLI default of
        // auto-discovering the invoking user's ~/.claude/settings.json and any
        // project-level .claude/settings.json under cwd — pulling in that
        // user's own hooks, MCP servers, and multi-agent-teams coordination
        // (a Unix-socket handshake with whatever other Claude Code session is
        // running) into what's supposed to be an isolated, headless one-shot
        // turn. Observed failure mode: `query()` never yields a result message
        // at all (the SDK's own runHeadless path logs "no result message
        // returned from query"), which callers up the stack — having no better
        // signal — surface as a generic/misleading "Not logged in" error even
        // though the account is authenticated (`claude auth status` succeeds
        // independently). settingSources: [] and strictMcpConfig: true make
        // this runner's `mcpServers` the complete, exclusive tool surface and
        // skip settings/hook discovery entirely, matching the intent that this
        // is a scripted org-runtime turn, not an interactive user session.
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: { org: orgServer },
        maxTurns: args.maxTurns,
        permissionMode: 'default',
        resume: args.resume,
        // #289: the SDK hands the permission gate this call's own tool_use id;
        // forward it so the invocation event can be correlated with the
        // tool_result event that later reports how the call ended.
        canUseTool: args.canUseTool
          ? (toolName: string, input: Record<string, unknown>, opts?: { toolUseID?: string }) =>
              args.canUseTool?.(toolName, input, { toolUseId: opts?.toolUseID })
          : undefined,
        abortController,
        ...(args.claudeRestrictions?.sandbox ? { sandbox: args.claudeRestrictions.sandbox } : {}),
        ...(args.claudeRestrictions?.disallowedTools?.length
          ? { disallowedTools: args.claudeRestrictions.disallowedTools }
          : {}),
        ...(args.extras || {}),
      } as any,
    });

    // Per-turn incremental-streaming state (only meaningfully used when
    // streamPartials — see above). blockTexts accumulates each text
    // content-block's own text by index; visibleSoFar is the fence-free
    // equivalent of antigravity-runner.ts's own visibleSoFar: the fully
    // assembled, already-yielded prefix, recomputed and diffed against on
    // every delta so the incremental and complete-message reconstructions
    // (both index-sorted-join-with-'\n') always agree — see
    // antigravity-runner.ts's computeSafeChunk/emitVisible/flushText for
    // the sibling pattern this mirrors (no fence-safety concern here,
    // since Claude's content blocks are already cleanly delimited by
    // index rather than needing to be scanned out of raw text).
    let blockTexts = new Map<number, string>();
    let visibleSoFar = '';

    /** #289: tool_use id → what was called and when, so the tool_result block
     *  (which carries only the id) can be reported with a name and a duration. */
    const pendingToolCalls = new Map<string, { tool: string; startedAt: number }>();

    const assembleVisible = (): string =>
      [...blockTexts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, t]) => t)
        .join('\n');

    try {
      for await (const m of stream as AsyncIterable<any>) {
        const session_id = m.session_id;
        if (streamPartials && m.type === 'stream_event') {
          const event = m.event;
          if (event?.type === 'message_start') {
            // Defends against a turn that errors/aborts without ever
            // reaching the 'assistant' branch below (which normally does
            // this reset) — without it, leftover block text from an
            // incomplete turn would contaminate the next turn's indices.
            blockTexts = new Map();
            visibleSoFar = '';
          } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const idx = event.index ?? 0;
            const deltaText = event.delta.text ?? '';
            if (deltaText) {
              blockTexts.set(idx, (blockTexts.get(idx) ?? '') + deltaText);
              const assembled = assembleVisible();
              if (assembled.length > visibleSoFar.length) {
                const increment = assembled.slice(visibleSoFar.length);
                visibleSoFar = assembled;
                yield { type: 'assistant', session_id, text: increment };
              }
            }
          }
          // Other stream_event subtypes (content_block_start/stop,
          // message_delta/stop, and non-text deltas like input_json_delta
          // for tool-call args or thinking_delta) carry no additional
          // visible-text signal — ignored, matching how they were never
          // surfaced in the pre-streaming design either (the complete
          // message's own content array, filtered to text blocks, was
          // always the sole source of visible text).
        } else if (m.type === 'assistant') {
          // #289: remember each tool_use block's id → name/start time. The
          // tool_result block that comes back later carries only the id, so
          // this is the only place the tool's name and the moment it was
          // invoked are observable.
          for (const b of m.message?.content ?? []) {
            if (b?.type === 'tool_use' && typeof b.id === 'string')
              pendingToolCalls.set(b.id, { tool: String(b.name ?? ''), startedAt: Date.now() });
          }
          const fullText = (m.message?.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
          // Without streamPartials, `text` is always the complete fullText
          // (including '' for a text-less, e.g. tool-use-only, turn) —
          // byte-for-byte the prior behavior session.ts depends on. With
          // it, this yields only whatever safe increment hasn't already
          // been streamed above (normally undefined — already fully shown).
          const text = streamPartials
            ? fullText.length > visibleSoFar.length
              ? fullText.slice(visibleSoFar.length)
              : undefined
            : fullText;
          blockTexts = new Map();
          visibleSoFar = '';
          yield {
            type: 'assistant',
            session_id,
            text,
            input_tokens: m.message?.usage?.input_tokens,
            output_tokens: m.message?.usage?.output_tokens,
            // BetaUsage types both cache fields as `number | null`; normalize
            // null to undefined so `?? 0` downstream reads the same either way.
            cache_read_input_tokens: m.message?.usage?.cache_read_input_tokens ?? undefined,
            cache_creation_input_tokens: m.message?.usage?.cache_creation_input_tokens ?? undefined,
          };
        } else if (m.type === 'result') {
          const cumulative = sumModelUsage(m.modelUsage);
          yield {
            type: 'result',
            session_id,
            subtype: m.subtype,
            is_error: m.is_error,
            input_tokens: m.usage?.input_tokens ?? 0,
            output_tokens: m.usage?.output_tokens ?? 0,
            cache_read_input_tokens: m.usage?.cache_read_input_tokens ?? undefined,
            cache_creation_input_tokens: m.usage?.cache_creation_input_tokens ?? undefined,
            ...(cumulative ? { cumulative_tokens: cumulative } : {}),
            cost_usd: m.total_cost_usd,
          };
        } else if (m.type === 'user') {
          // #289: the tool's result comes back as a user-role message carrying
          // tool_result blocks — the one point at which the org runtime can
          // observe whether a command actually worked, instead of taking the
          // agent's later prose about it at face value.
          for (const b of m.message?.content ?? []) {
            if (b?.type !== 'tool_result') continue;
            const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined;
            const started = id ? pendingToolCalls.get(id) : undefined;
            if (id) pendingToolCalls.delete(id);
            yield {
              type: 'tool_result',
              session_id,
              tool_use_id: id,
              tool: started?.tool,
              is_error: b.is_error === true,
              text: toolResultText(b.content),
              ...(started ? { duration_ms: Date.now() - started.startedAt } : {}),
            };
          }
        }
        // Other message kinds (system, …) carry no signal session.ts acts on.
      }
    } finally {
      unsubscribe();
    }
  }
}

/** ADR-O001 D1: collapse SDKResultMessage.modelUsage (a per-model record whose
 *  fields are camelCase: inputTokens / outputTokens / cacheReadInputTokens /
 *  cacheCreationInputTokens) into one total. Unlike `usage` it covers Task
 *  subagents and other auxiliary calls — on the measured run, 46 subagent
 *  calls the main-loop counter never saw. Returns undefined when the SDK
 *  reported no modelUsage at all, so session.ts can fall back to `usage`. */
function sumModelUsage(
  modelUsage: unknown,
): { input: number; output: number; cache_read: number; cache_creation: number } | undefined {
  if (!modelUsage || typeof modelUsage !== 'object') return undefined;
  const entries = Object.values(modelUsage as Record<string, any>);
  if (entries.length === 0) return undefined;
  const total = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  for (const u of entries) {
    if (!u || typeof u !== 'object') continue;
    total.input += Number(u.inputTokens) || 0;
    total.output += Number(u.outputTokens) || 0;
    total.cache_read += Number(u.cacheReadInputTokens) || 0;
    total.cache_creation += Number(u.cacheCreationInputTokens) || 0;
  }
  return total;
}

/** #289: a tool_result block's `content` is either a plain string or an array
 *  of content blocks; flatten it to the text a reader would actually see. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

/** Shared default instance (stateless — safe to reuse). */
export const defaultClaudeRunner = new ClaudeAgentRunner();
