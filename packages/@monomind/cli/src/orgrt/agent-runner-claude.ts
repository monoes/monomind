// packages/@monomind/cli/src/orgrt/agent-runner-claude.ts
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { fullAccessClaudeSpawn } from './agent-runner-claude-fullaccess.js';
import { resolveClaudeSettingsOverrides } from './agent-runner-claude-settings.js';
import { createSubagentTracker } from './agent-runner-claude-subagent.js';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner-types.js';
import { killOnAbort } from './agent-runner-types.js';
import { maskedCommand } from './authority-mask.js';
import { type ClaudeSdk, loadClaudeSdk } from './claude-sdk.js';
import { coverEveryToolCall, POLICY_HOOK_TIMEOUT_S } from './policy-hook.js';
import { type DescendantTracker, trackDescendants } from './process-tree.js';
import { omitAnthropicManagedKeys } from './provider.js';
import { toolInputSchema } from './tool-fence.js';
import { toolResultSpillHook } from './tool-spill.js';

export { loadClaudeSdk } from './claude-sdk.js';

/** Launch the Claude Code process inside the authority mask. Same stdio as the
 *  SDK's own spawn; stderr is drained (an unread pipe would stall the CLI once
 *  its buffer fills), keeping the tail for diagnostics. */
function maskedClaudeSpawn(mask: string[]) {
  return (o: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal?: AbortSignal;
  }) => {
    const [cmd, argv] = maskedCommand(mask, o.command, o.args);
    const child = spawn(cmd, argv, {
      cwd: o.cwd,
      env: o.env as NodeJS.ProcessEnv,
      signal: o.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stderr?.resume();
    return child;
  };
}

/**
 * Default runner — wraps the Claude Agent SDK. This is the previous inline
 * logic of runOneSession, extracted verbatim:
 *   - convert OrgToolDef[] → SDK tool() calls → createSdkMcpServer
 *   - call queryFn({ prompt, options }) (queryFn and the SDK loader injectable for tests)
 *   - normalize the raw stream into AgentMessage
 */
export class ClaudeAgentRunner implements AgentRunner {
  constructor(
    private queryFn?: typeof query,
    private loadSdk: () => Promise<ClaudeSdk> = loadClaudeSdk,
  ) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    // #522: with an installed Claude Code, this query() passes it as
    // pathToClaudeCodeExecutable (claude-sdk.ts).
    const { createSdkMcpServer, query, tool } = await this.loadSdk();
    const queryFn = this.queryFn ?? query;
    // Wrap each OrgToolDef handler ({ text }) into the Claude SDK's
    // { content: [{ type: 'text', text }] } return shape.
    const sdkTools = args.tools.map((t) =>
      // A catchall or strict tool needs the full object schema (the MCP
      // server strips unlisted keys from a bare shape); the SDK accepts either
      // at runtime.
      tool(
        t.name,
        t.description,
        (t.catchall || t.strict ? toolInputSchema(t) : t.schema) as typeof t.schema,
        async (input: Record<string, unknown>) => {
          const r = await t.handler(input);
          return { content: [{ type: 'text' as const, text: r.text }] };
        },
        // #389: Claude Code runs an MCP call concurrently with its siblings
        // only when the tool says readOnlyHint (its isConcurrencySafe, checked
        // in Claude Code 2.1.226); only callers that opt in set it.
        t.concurrent ? { annotations: { readOnlyHint: true } } : undefined,
      ),
    );
    const orgServer = createSdkMcpServer({ name: 'org', version: '1.0.0', tools: sdkTools });

    // Forward args.signal to the SDK: aborting its controller stops the
    // in-process agent loop (no further tool calls) and ends the stream.
    const abortController = new AbortController();
    const unsubscribe = killOnAbort(args.signal, {
      kill: () => abortController.abort(),
    });
    // #359: the ladder above only stops the SDK's in-process loop from
    // issuing further turns — it never touches an already-running child
    // process. Full access additionally needs the whole process TREE
    // killed on cancel/timeout/budget (agent-exec.ts's terminate(), or
    // session.ts's silent-stream abort for a future full-access org role,
    // #365): reuses killOnAbort's own SIGTERM-then-SIGKILL-after-5s ladder,
    // targeted at `tracker` (set once `fullAccessClaudeSpawn` spawns the
    // child below) instead of a single process. `tracker` has been
    // continuously sampling the tree since spawn (process-tree.ts's
    // `trackDescendants`) — a single point-in-time closure isn't enough
    // against the real Claude Code CLI: it was live-verified to spawn each
    // Bash-tool shell call as the leader of its OWN process group, whose
    // job a background command started can outlive by minutes, long after
    // that shell (and the PPID edge to it) is gone. No-op for scoped mode:
    // `tracker` is never set there.
    let tracker: DescendantTracker | undefined;
    // #359: inherited by every process the turn starts (process-tree-marker.ts).
    const treeToken = randomUUID();
    const unsubscribeGroup =
      args.access === 'full'
        ? killOnAbort(args.signal, {
            kill: (signal) => tracker?.signal(signal ?? 'SIGTERM'),
          })
        : () => {};

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
    // #365: org full-access roles want the rich 'tool_use' start event (for
    // tool_activity bus events) without opting into incremental assistant-
    // text streaming — a second, independent flag so a caller can ask for
    // just the tool_use signal. session.ts sets this only for a role whose
    // resolved access is 'full'; every other caller is unaffected.
    const emitToolUse = streamPartials || args.extras?.includeToolUseEvents === true;
    // canUseTool alone misses every call the CLI allows itself (policy-hook.ts).
    const gate = args.canUseTool ? coverEveryToolCall(args.canUseTool) : undefined;

    // Coder mode (#356): non-empty only when the caller passed `--settings`
    // (agent-exec.ts) — session.ts (org runtime) never sets this, so every
    // existing caller gets settingSources.length === 0 and the branch below
    // reproduces today's options object byte-for-byte. See
    // agent-runner-claude-settings.ts for what each list turns into.
    const settingSources = args.settingSources ?? [];
    const settingsOverrides = resolveClaudeSettingsOverrides(settingSources, {
      systemPrompt: args.systemPrompt,
      orgServer,
      hasCallerTools: args.tools.length > 0,
    });
    if (settingSources.length > 0) yield { type: 'status', phase: 'initializing' };

    const stream = queryFn({
      prompt: args.prompt,
      options: {
        systemPrompt: settingsOverrides.systemPrompt,
        model: args.model,
        // ADR-O001 D8: the Claude half of the cost tier's effort axis. The
        // SDK's own EffortLevel is 'low'|'medium'|'high'|'xhigh'|'max', which
        // the abstract level maps onto 1:1; 'off' has no SDK effort value and
        // means "no extended thinking", i.e. thinking: { type: 'disabled' }.
        // Both spread conditionally so an untiered session sends neither key
        // and is byte-identical to before.
        ...(args.effort && args.effort !== 'off' ? { effort: args.effort } : {}),
        ...(args.effort === 'off' ? { thinking: { type: 'disabled' as const } } : {}),
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
        //
        // #356 (coder mode) re-verified this live: 8 trials of
        // settingSources:['user','project','local'] against a real
        // authenticated account (query()+abortController, no CLI subprocess)
        // — sequential, repeated, and 3 concurrent SDK sessions sharing one
        // HOME — all with 3+ interactive `claude` sessions already running on
        // this machine the whole time (the exact condition the paragraph
        // above names). `system/init` arrived in 0.7-2.5s every time and
        // every turn completed; the hang did not reproduce with this SDK/CLI
        // version, so no settingSources:[] fallback and no env override were
        // added. The startup watchdog below (agent-exec-settings.ts's
        // createExecStatusHandler) stays as a defense-in-depth backstop
        // regardless, per #356's own acceptance criteria. `settingSources`
        // empty (no caller opted in via `--settings`) still takes this exact
        // branch, unchanged from before this issue.
        settingSources: settingsOverrides.settingSources,
        strictMcpConfig: settingsOverrides.strictMcpConfig,
        ...(settingsOverrides.mcpServers ? { mcpServers: settingsOverrides.mcpServers } : {}),
        maxTurns: args.maxTurns,
        // #355: `full` access needs both the permission-mode switch AND the
        // SDK's explicit opt-in (`allowDangerouslySkipPermissions`) it
        // requires for 'bypassPermissions' — see sdk.d.ts's own doc comment
        // on that option. Unset/`scoped` is exactly today's behavior: the
        // `allowDangerouslySkipPermissions` key is omitted entirely rather
        // than sent as `false`, so scoped SDK options stay byte-identical.
        permissionMode: args.access === 'full' ? 'bypassPermissions' : 'default',
        ...(args.access === 'full' ? { allowDangerouslySkipPermissions: true } : {}),
        resume: args.resume,
        // #289: the SDK hands the permission gate this call's own tool_use id;
        // forward it so the invocation event can be correlated with the
        // tool_result event that later reports how the call ended.
        // #366: under bypassPermissions the SDK never calls canUseTool (it
        // only warns that it is shadowed); the PreToolUse hook below still
        // sees every call, so full access passes none.
        canUseTool:
          gate && args.access !== 'full'
            ? (toolName: string, input: Record<string, unknown>, opts?: { toolUseID?: string }) =>
                gate.canUseTool(toolName, input, { toolUseId: opts?.toolUseID })
            : undefined,
        abortController,
        ...(args.claudeRestrictions?.sandbox ? { sandbox: args.claudeRestrictions.sandbox } : {}),
        ...(args.claudeRestrictions?.disallowedTools?.length
          ? { disallowedTools: args.claudeRestrictions.disallowedTools }
          : {}),
        // #359: full access always installs the group-leader spawn (with or
        // without an authorityMask — `fullAccessClaudeSpawn` treats an empty
        // mask as a no-op, see maskedCommand); scoped mode keeps today's
        // plain masked spawn, untouched.
        ...(args.access === 'full'
          ? {
              spawnClaudeCodeProcess: fullAccessClaudeSpawn(
                args.authorityMask ?? [],
                treeToken,
                (pid) => {
                  tracker = trackDescendants(pid, { marker: treeToken });
                  args.onProcessSpawned?.({
                    pid,
                    getBackgroundSurvivors: () => tracker!.liveMembers(),
                  });
                },
              ),
            }
          : args.authorityMask?.length
            ? { spawnClaudeCodeProcess: maskedClaudeSpawn(args.authorityMask) }
            : {}),
        // ADR-O001 D2. A PROGRAMMATIC hook, not a filesystem one: these are
        // registered over the SDK's control protocol at initialize() time and
        // so are unaffected by `settingSources: []` above (which only stops
        // the CLI discovering the invoking user's own hooks).
        ...(gate || args.toolSpillDir
          ? {
              hooks: {
                ...(gate
                  ? { PreToolUse: [{ hooks: [gate.preToolUse], timeout: POLICY_HOOK_TIMEOUT_S }] }
                  : {}),
                ...(args.toolSpillDir
                  ? { PostToolUse: [{ hooks: [toolResultSpillHook(args.toolSpillDir)] }] }
                  : {}),
              },
            }
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
    const subagentOf = createSubagentTracker(); // #387

    const assembleVisible = (): string =>
      [...blockTexts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, t]) => t)
        .join('\n');

    try {
      for await (const m of stream as AsyncIterable<any>) {
        const session_id = m.session_id;
        if (streamPartials && m.type === 'stream_event') {
          // #387: skip a subagent's partials; its whole message is yielded below.
          const event = m.parent_tool_use_id ? undefined : m.event;
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
            if (b?.type === 'tool_use' && typeof b.id === 'string') {
              // #359: an extra sample as the call starts (and on its
              // result, below) — a Bash-tool shell can exit well inside the
              // sampling interval. No-op for scoped mode (`tracker` unset).
              tracker?.sampleNow();
              pendingToolCalls.set(b.id, { tool: String(b.name ?? ''), startedAt: Date.now() });
              // #357: the raw call, up front, for agent-exec.ts's
              // tool_activity events — gated behind streamPartials like
              // every other agent-exec-only enrichment (session.ts never
              // sets it, so the org runtime never sees this message type
              // from this runner and is unaffected).
              if (emitToolUse) {
                yield {
                  type: 'tool_use',
                  session_id,
                  tool_use_id: b.id,
                  tool: String(b.name ?? ''),
                  input: (b.input ?? {}) as Record<string, unknown>,
                  parent_tool_use_id: m.parent_tool_use_id ?? null,
                };
              }
            }
          }
          const parent: string | null = m.parent_tool_use_id ?? null; // #387: subagent text
          const fullText = (m.message?.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
          // Without streamPartials, `text` is always the complete fullText
          // (including '' for a text-less, e.g. tool-use-only, turn) —
          // byte-for-byte the prior behavior session.ts depends on. With
          // it, this yields only whatever safe increment hasn't already
          // been streamed above (normally undefined — already fully shown).
          const text =
            streamPartials && !parent
              ? fullText.length > visibleSoFar.length
                ? fullText.slice(visibleSoFar.length)
                : undefined
              : fullText;
          if (!parent) {
            blockTexts = new Map();
            visibleSoFar = '';
          }
          yield {
            type: 'assistant',
            session_id,
            text,
            ...(parent ? { parent_tool_use_id: parent } : {}),
            ...(typeof m.message?.id === 'string' ? { response_id: m.message.id } : {}),
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
            tracker?.sampleNow(); // #359: bracket the call on its result too — see the tool_use side above
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
        } else if (m.type === 'system' && m.subtype === 'init' && settingSources.length > 0) {
          // #356: only when a caller opted into coder mode (settingSources
          // non-empty) — session.ts (org runtime) never sets it, so this
          // branch never fires there, matching "org runtime unchanged".
          yield { type: 'status', session_id, phase: 'ready', mcp_servers: m.mcp_servers };
        } else if (streamPartials && m.type === 'system') {
          // #387: agent-exec only (the org runtime never sets streamPartials).
          const subagent = subagentOf(m);
          if (subagent) yield { type: 'subagent', session_id, subagent };
        }
        // Other message kinds (system when settingSources is empty, …)
        // carry no signal session.ts acts on.
      }
    } finally {
      unsubscribe();
      unsubscribeGroup();
      // #359: stop sampling once the turn ends (normally or via abort) —
      // `signal()`/`liveMembers()` keep working against whatever was
      // already recorded, so a delayed SIGKILL from the ladder above still
      // reaches everything the tracker saw before this ran.
      tracker?.stop();
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
