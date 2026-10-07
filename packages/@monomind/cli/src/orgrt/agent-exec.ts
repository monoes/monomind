// packages/@monomind/cli/src/orgrt/agent-exec.ts
/**
 * Agent Exec engine — one-shot exposure of the AgentRunner surface over the
 * public subprocess protocol in doc/agent-exec-protocol.md (§3).
 *
 * Process model: the CALLER (e.g. monoagentcli) spawns `monomind agent exec`;
 * monomind resolves the requested runtime's AgentRunner and drives ONE agent
 * turn, adapting the `--prompt` string into the single-message async stream
 * the runner interface expects (`AgentRunArgs.prompt`). With
 * `--tools stdio` (+ `--tools-file` / `--tool-names`), tool handler
 * invocations are bridged to the caller as `tool_call` frames on stdout and
 * satisfied by `tool_result` frames on stdin — identically for native
 * runners (ClaudeAgentRunner registers them as real SDK tools) and fence
 * runners (subprocess CLIs render + parse the fence protocol in-process).
 *
 * stdout purity (§3): the ONLY thing this engine writes to stdout is NDJSON
 * events via the injected `emit` sink. Everything else goes to stderr.
 *
 * Cancellation semantics: `--timeout`, budget breach, and caller `cancel`
 * frames all funnel through `terminate()` — a fire-and-forget
 * `stream.return()` (the runner's finally-blocks SIGTERM/SIGKILL its child)
 * raced against a grace window, after which the engine resolves regardless.
 * A runner wedged mid-await cannot have its return() propagate until it
 * reaches a yield; the grace bound keeps the exec from hanging forever, and
 * the runner's own 2h/45s ladders remain the backstop for orphaned children.
 */

import { fullAccessCanUseTool, resolveAccess, resolveExecSandbox } from './agent-exec-access.js';
import { StdioToolBridge, UsageTracker } from './agent-exec-bridge.js';
import { type ExecErrorCode, execErrorCode, FATAL_CODES } from './agent-exec-errors.js';
import { execAllowedToolNames, execCanUseTool } from './agent-exec-gate.js';
import {
  type AgentExecOptions,
  jsonSchemaToZodShape,
  type Terminal,
} from './agent-exec-options.js';
import { type AttemptContext, runWithRateLimitRetry } from './agent-exec-retry.js';
import { createExecStatusHandler, runtimeStartupNotices } from './agent-exec-settings.js';
import { mapStopReason } from './agent-exec-stop-reason.js';
import type { AgentMessage, OrgToolDef } from './agent-runner.js';
import { appendFullAccessAudit } from './full-access-audit.js';
import { loadCreateOrgSkillGuidance } from './org-design-skill.js';
import { resolveExecRunner, runnerSpec } from './runner-registry.js';
import { NATIVE_SUBAGENT_RUNTIMES, ToolActivityTracker } from './tool-activity.js';

export type { ExecErrorCode } from './agent-exec-errors.js';
export type { AgentExecOptions, ToolSpec } from './agent-exec-options.js';
export { jsonSchemaToZodShape } from './agent-exec-options.js';

// ─── engine ─────────────────────────────────────────────────────────────────

/**
 * Run one agent exec turn. Emits protocol events via opts.emit and returns
 * the process exit code (§3.2): 0 success · 1 error · 124 timeout ·
 * 130 cancelled. `done` is emitted exactly once before returning. A turn
 * that fails on a transient rate limit is retried (agent-exec-retry.ts).
 */
export function runAgentExec(opts: AgentExecOptions): Promise<number> {
  return runWithRateLimitRetry(opts, runAgentExecOnce);
}

/** One attempt; a later one skips `start` + startup notices (see AttemptContext). */
export async function runAgentExecOnce(
  opts: AgentExecOptions,
  ctx: AttemptContext = { attempt: 1 },
): Promise<number> {
  const emit = opts.emit;
  const grace = opts.returnGraceMs ?? 5000;

  // Resolve runner (no-runner vs missing-binary is classified here).
  const runner = opts.runnerOverride ?? (await resolveExecRunner(opts.runtime));
  if (!runner) {
    const known = runnerSpec(opts.runtime);
    const message = known
      ? `runtime "${opts.runtime}" could not be constructed`
      : `unknown runtime "${opts.runtime}" — no AgentRunner implementation exists for it`;
    emit({ v: 1, type: 'error', code: 'no-runner', fatal: true, message });
    emit({ v: 1, type: 'done', exit_code: 2 });
    return 2;
  }

  const hasCallerTools = (opts.toolSpecs?.length ?? 0) > 0;
  const { access, abort: accessDenied } = resolveAccess({ ...opts, hasCallerTools }, emit); // #355
  if (accessDenied) return 2;
  const sandbox = resolveExecSandbox({ ...opts, access }, emit); // #396
  if (sandbox.abort) return 2;
  // Tool specs (§4). The bridge itself is constructed below, after
  // terminate() exists (its cancel callback wires into termination).
  const toolSpecs = opts.toolSpecs ?? null;
  let bridge: StdioToolBridge | null = null;
  const tools: OrgToolDef[] = (toolSpecs ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema ? jsonSchemaToZodShape(t.schema) : {},
    concurrent: true, // #389: parallel calls go to the caller at once (§4.3)
    handler: (args: Record<string, unknown>) =>
      bridge ? bridge.call(t.name, args) : Promise.resolve({ text: 'ERROR: tools not bridged' }),
  }));

  // Single-message prompt stream — the AgentRunArgs.prompt contract.
  const promptStream = (async function* () {
    yield {
      type: 'user',
      message: { role: 'user', content: opts.prompt },
      parent_tool_use_id: null,
      session_id: undefined,
    };
  })();

  const usage = new UsageTracker();
  const rawTexts: string[] = [];
  let lastSession: string | undefined;
  const totals = usage.total;
  let lastResult: AgentMessage | undefined;
  // #359: set once the runner reports its spawned agent-CLI process (full
  // access only — see AgentRunArgs.onProcessSpawned). `getBackgroundSurvivors`
  // reads the runner's continuously-sampled process tracker (process-tree.ts's
  // trackDescendants), not just a point-in-time snapshot — used on a normal
  // end_turn to list background survivors for `done.background_pids`.
  let getBackgroundSurvivors: (() => { pids: number[]; supported: boolean }) | undefined;
  // Holder object: `terminal` is assigned inside the terminate() closure and
  // read after the loop — TS flow analysis would otherwise keep the `null`
  // narrowing across closure calls and type the post-loop reads as `never`.
  const state: { terminal: Terminal | null } = { terminal: null };
  let stream: AsyncGenerator<AgentMessage> | null = null;

  // Post-done suppression: once `done` is emitted, nothing else goes out.
  let finished = false;
  const safeEmit = (ev: Record<string, unknown>): void => {
    if (finished) return;
    emit(ev);
  };

  // Termination races the consumer loop: a runner that goes quiet (wedged
  // child, hung SDK) must not pin the exec open — terminate() resolves the
  // race directly while the abandoned consumer finishes in the background.
  let settleTerminal: (t: Terminal) => void = () => {};
  const terminalPromise = new Promise<Terminal>((r) => {
    settleTerminal = r;
  });

  const firstEmit = ctx.attempt === 1 ? safeEmit : () => {}; // rev 20: retries stay quiet
  firstEmit({
    v: 1,
    type: 'start',
    runtime: opts.runtime,
    ...(opts.model ? { model: opts.model } : {}),
    cwd: opts.cwd ?? process.cwd(),
    ...(opts.resume ? { resume: opts.resume } : {}),
    pid: process.pid,
    access, // #355
    ...sandbox.report, // #396: native_sandbox + approvals the CLI really runs with
    // rev 5: lets a caller (e.g. a chat UI) set the user's expectations
    // honestly BEFORE assuming a quiet turn is stuck — see runner-registry.ts's
    // RunnerSpec.streamsIncrementally doc comment and doc/agent-exec-protocol.md
    // §3.2/§9. Absent runtime (shouldn't happen — resolveExecRunner already
    // failed above for an unknown id) defaults to false, the safe assumption.
    streams_incrementally: runnerSpec(opts.runtime)?.streamsIncrementally ?? false,
  });
  // rev 19: what a non-claude --settings turn loads, and an ignored --effort.
  const effortSupported = runnerSpec(opts.runtime)?.effort ?? false;
  for (const ev of [...sandbox.notices, ...runtimeStartupNotices({ ...opts, effortSupported })])
    firstEmit(ev); // #482: a sandbox fallback notice first

  // Abort hook for the runner (AgentRunArgs.signal): return() alone queues
  // behind a runner blocked in `for await (child.stdout)` and never reaches
  // its finally/kill before process.exit() orphans the child — the signal
  // makes the runner kill its subprocess right now.
  const abort = new AbortController();

  const terminate = (code: ExecErrorCode, exitCode: number) => {
    if (state.terminal) return;
    state.terminal = { code, exitCode };
    abort.abort();
    // Ladder the runner's return() (its finally-blocks kill the child) with
    // a grace bound — a wedged runner may not propagate until its own
    // 2h/45s ladders fire, and the exec must not wait for that.
    if (stream && typeof stream.return === 'function') {
      void Promise.race([
        stream.return(undefined as never).catch(() => {}),
        new Promise((r) => setTimeout(r, grace)),
      ]);
    }
    settleTerminal(state.terminal);
  };

  // Coder mode (#356): startup watchdog for `--settings` non-none turns,
  // claude-only (only claude reports `ready`); a no-op otherwise.
  const statusHandler = createExecStatusHandler({
    enabled: opts.runtime === 'claude' && (opts.settings?.length ?? 0) > 0,
    timeoutMs: opts.startupTimeoutMs ?? 30_000,
    emit: safeEmit,
    terminate,
  });

  bridge =
    (toolSpecs && toolSpecs.length > 0) || opts.stdioFrames
      ? new StdioToolBridge(opts.stdin ?? process.stdin, opts.toolTimeoutMs, safeEmit, () =>
          terminate('cancelled', 130),
        )
      : null;
  bridge?.start();

  const timeoutTimer = opts.timeoutMs
    ? setTimeout(() => terminate('timeout', 124), opts.timeoutMs)
    : null;
  const onSignal = () => terminate('cancelled', 130);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  // The SDK's own permission gate (permissionMode: 'default', set
  // unconditionally in ClaudeAgentRunner.run) requires either an
  // allow-listed tool name or a canUseTool callback to approve any call —
  // without one, every tool this exec call was explicitly given is denied
  // before it ever runs, and since this is a headless one-shot turn (no
  // TTY, no UI that could answer an interactive approval prompt), that
  // denial is permanent for the whole session, not just delayed. There's
  // no PolicyEngine/fence/human-approval infra here (that's the org-runtime
  // path's concern, see session.ts's gatedCanUseTool) — the caller already
  // decided the exact tool surface via --tools-file/--tool-names, so
  // approving every tool in that already-scoped list is the correct
  // default, not a laxer one: this narrows the SDK's own default-deny-all
  // down to exactly what was asked for, nothing broader.
  //
  // Both name forms are included because this same canUseTool is shared by
  // two different calling conventions: the native SDK path
  // (ClaudeAgentRunner) registers these as real MCP tools and the SDK
  // always prefixes the server name, so it calls canUseTool with
  // "mcp__org__<name>"; fence-protocol runners (antigravity-runner.ts and
  // any other AgentRunner built on tool-fence.ts's executeToolCall) never
  // register real tools at all — the model calls them by emitting a
  // ```tool_call fence, and executeToolCall passes canUseTool the bare name
  // straight off that fence. Checking only the prefixed form denied every
  // fence-protocol call outright ("was not in the tool list this exec call
  // was given"), which silently broke tool use for those runtimes:
  // tool.handler (the stdio bridge that actually emits tool_call/tool_result
  // on the wire) was never reached, since canUseTool denies before it runs.
  const allowedToolNames = execAllowedToolNames(opts.runtime, sandbox.mode, tools); // #482
  const rawCanUseTool =
    access === 'full'
      ? null
      : execCanUseTool(access, allowedToolNames, opts.allowBashPrefixes ?? []); // #388

  // #357: tool_activity events (see tool-activity.ts) — observability only.
  const fidelity = runnerSpec(opts.runtime)?.toolActivityFidelity;
  const synthSubagents = !NATIVE_SUBAGENT_RUNTIMES.has(opts.runtime); // #387 rev 24
  const toolActivity = new ToolActivityTracker(safeEmit, fidelity, synthSubagents);
  const effectiveCanUseTool = rawCanUseTool
    ? toolActivity.wrapCanUseTool(rawCanUseTool)
    : fullAccessCanUseTool; // #355

  // This session's own tool list has no way to reach the real
  // mastermind:createorg skill (no settingSources, no `skills` SDK option,
  // canUseTool above would deny a Skill tool call anyway) — if create_org
  // is among the tools this exec call was given, fold the skill's actual
  // content onto the system prompt instead of leaving the model to
  // free-style org design (single-root structure, archetype icon ids,
  // policy/provider conventions) from scratch every time.
  const hasOrgDesignTools = tools.some((t) => t.name === 'create_org');
  const skillGuidance = hasOrgDesignTools ? loadCreateOrgSkillGuidance() : null;
  const systemPrompt = skillGuidance
    ? `${opts.systemPrompt ?? ''}\n\n${skillGuidance}`
    : (opts.systemPrompt ?? '');

  const consumer = (async () => {
    try {
      stream = runner.run({
        tools,
        prompt: promptStream,
        systemPrompt,
        model: opts.model,
        effort: opts.effort, // rev 16 (+ rev 19/20 runners): each runner maps or ignores it
        cwd: opts.cwd ?? process.cwd(),
        // #365: marks this child as an agent-turn process tree so `monomind
        // org role set-access ... full` (agent-context.ts) refuses to run
        // inside it even under --yes-i-understand.
        env: { ...opts.env, MONOMIND_AGENT_EXEC: '1' },
        // o-18: this command has no --provider concept at all (no config
        // resolved, no resolveProviderEnv call anywhere in this file), so an
        // ambient/inherited ANTHROPIC_API_KEY is the only way to get
        // non-subscription Anthropic auth through `agent exec --runtime
        // claude` today WITHOUT CHANGING HOW THE COMMAND IS INVOKED — an
        // explicit `--env ANTHROPIC_API_KEY=...` also works and would win
        // under the safe default below, same as it does for every vendor
        // runner. Inheriting the ambient shell value is still worth
        // preserving on its own: unlike `--env`, it never puts a credential
        // on the command line (visible in `ps`/shell history).
        // envAuthoritative defaults to true (safe) on every OTHER caller;
        // this is the one deliberate, documented opt-out, so that ambient
        // path keeps working exactly as it does today. It does not reopen
        // the vendor-runner leak: the 12 vendor runners strip ambient
        // Anthropic creds unconditionally regardless of this flag, so this
        // only affects the claude runtime reached from here.
        envAuthoritative: false,
        maxTurns: opts.maxTurns,
        resume: opts.resume,
        settingSources: opts.settings, // coder mode (#356); each runner decides what it loads
        canUseTool: effectiveCanUseTool,
        access,
        ...(sandbox.mode ? { sandbox: sandbox.mode } : {}), // #396
        signal: abort.signal,
        onProcessSpawned: (info) => {
          getBackgroundSurvivors = info.getBackgroundSurvivors;
        }, // #359
        // Opts every runner that supports it (each subprocess runner's own
        // `streamPartials`/equivalent gate — claude, antigravity, qwen-rpc,
        // opencode, pi-rpc) into per-token/per-chunk incremental `assistant`
        // yields — this protocol's own `assistant` frame is documented as
        // incremental (§3.2), unlike session.ts's org-runtime usage, which
        // needs one complete message per step/round regardless of which
        // runner backs the role, and never sets this. Runners without their
        // own incremental path (a hard wire-format limitation, or not yet
        // built — see runner-registry.ts's streamsIncrementally per id)
        // ignore this unrecognized `extras` key (AgentRunArgs.extras's own
        // contract) and behave exactly as before.
        extras: { includePartialMessages: true },
      }) as AsyncGenerator<AgentMessage>;

      for await (const m of stream) {
        if (state.terminal) break;
        statusHandler.onMessage(m); // coder mode (#356): emits `status`, clears the watchdog

        if (m.session_id && m.session_id !== lastSession) {
          lastSession = m.session_id;
          safeEmit({ v: 1, type: 'session', session_id: m.session_id });
        }

        if (m.type === 'assistant' && m.text) {
          const sub = m.parent_tool_use_id ? { parent_tool_use_id: m.parent_tool_use_id } : {};
          if (!m.parent_tool_use_id) rawTexts.push(m.text); // #387: subagent text stays out
          safeEmit({ v: 1, type: 'assistant', text: m.text, ...sub });
        } else if (m.type === 'subagent') safeEmit({ v: 1, type: 'subagent', ...m.subagent });
        else if (m.type === 'result') {
          const d = usage.delta(m);
          safeEmit({
            v: 1,
            type: 'usage',
            input_tokens: d.in,
            output_tokens: d.out,
            cost_usd: d.usd,
          });
          lastResult = m;
          // Budget is enforced at result granularity on a single-shot exec:
          // the turn has completed, but the overspend is surfaced as the
          // terminal outcome (no success result event) so callers stop.
          // An unknown cost (null) is not spend: it never trips the cap.
          if (opts.budgetUsd !== undefined && totals.usd !== null && totals.usd > opts.budgetUsd) {
            terminate('budget', 1);
            safeEmit({
              v: 1,
              type: 'error',
              code: 'budget',
              fatal: true,
              message: `spend cap exceeded: $${totals.usd.toFixed(4)} > --budget-usd ${opts.budgetUsd}`,
            });
            break;
          }
        } else if (m.type === 'tool_use' || m.type === 'tool_result') toolActivity.onMessage(m); // #357
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        const spec = runnerSpec(opts.runtime);
        terminate('missing-binary', 1);
        safeEmit({
          v: 1,
          type: 'error',
          code: 'missing-binary',
          fatal: true,
          message: `${opts.runtime} CLI not found${spec ? ` — ${spec.installHint}` : ''}`,
        });
      } else {
        const msg = e.message ?? String(err);
        const { code, rateLimit } = execErrorCode(err, msg);
        if (rateLimit) ctx.rateLimit = rateLimit; // rev 20: the wrapper decides
        const spec = runnerSpec(opts.runtime);
        const login =
          code === 'auth' && spec?.loginHint && !/login|log in/i.test(msg)
            ? ` Run: ${spec.loginHint}`
            : '';
        terminate(code, 1);
        safeEmit({
          v: 1,
          type: 'error',
          code,
          fatal: FATAL_CODES.has(code),
          message: `${msg}${login}`,
        });
      }
    }
  })();

  try {
    await Promise.race([consumer, terminalPromise]);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    bridge?.stop();
    statusHandler.dispose();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  const finish = (exitCode: number, extra?: Record<string, unknown>): number => {
    // #360 guardrail 3: one audit line per full-access turn, regardless of
    // how it ended (success/error/timeout/cancelled/budget all funnel
    // through this single chokepoint) — never for scoped access. Best
    // effort by design (see full-access-audit.ts); never blocks `done`.
    if (access === 'full') {
      appendFullAccessAudit({
        ts: new Date().toISOString(),
        cwd: opts.cwd ?? process.cwd(),
        runtime: opts.runtime,
        ...(lastSession ? { sessionId: lastSession } : {}),
        exitCode,
        toolCalls: toolActivity.toolCallCount,
      });
    }
    safeEmit({ v: 1, type: 'done', exit_code: exitCode, ...extra });
    finished = true;
    return exitCode;
  };

  // #359: only for a turn that ends NORMALLY (not killed via terminate()) —
  // cancel/timeout/budget already kill the whole process tree above, so
  // there's nothing left to report there. `getBackgroundSurvivors` reads
  // the runner's tree tracker, which has been sampling continuously since
  // spawn — not just a point-in-time snapshot — so it also reports a job
  // whose launching shell has since exited (process-tree.ts's module doc).
  // `supported:false` on win32 (no POSIX process groups, v1 gap), in which
  // case the field is omitted entirely rather than falsely reporting "none".
  const backgroundPids = (): number[] | undefined => {
    if (access !== 'full' || !getBackgroundSurvivors) return undefined;
    const { pids, supported } = getBackgroundSurvivors();
    return supported ? pids : undefined;
  };

  if (state.terminal) {
    // timeout/cancelled errors are emitted here (terminate() only ladders);
    // missing-binary/budget/auth/quota/runner-error already emitted inline.
    if (state.terminal.code === 'timeout' || state.terminal.code === 'cancelled') {
      toolActivity.closeInFlight(); // #357: no dangling "start" left for the caller
      safeEmit({
        v: 1,
        type: 'error',
        code: state.terminal.code,
        fatal: false,
        message:
          state.terminal.code === 'timeout'
            ? `exec exceeded overall timeout (${opts.timeoutMs}ms)`
            : 'cancelled by caller',
      });
    }
    return finish(state.terminal.exitCode);
  }

  if (!lastResult) {
    safeEmit({
      v: 1,
      type: 'error',
      code: 'runner-error',
      fatal: false,
      message: 'runner stream ended without a result message',
    });
    return finish(1);
  }

  const isError = lastResult.is_error === true || (lastResult.subtype ?? 'success') !== 'success';
  if (isError) {
    const message =
      (lastResult as { text?: string }).text ?? `turn failed (${lastResult.subtype ?? 'error'})`;
    const { code, rateLimit } = execErrorCode(undefined, message);
    if (rateLimit) {
      // rev 20: ends like a thrown 429 (error + done, no result) so it can be retried.
      ctx.rateLimit = rateLimit;
      safeEmit({ v: 1, type: 'error', code, fatal: true, message });
      return finish(1);
    }
    safeEmit({ v: 1, type: 'error', code: 'runner-error', fatal: false, message });
  }
  // §3.2: result.text is the aggregate final text. Runners rarely put text on
  // their own result message, so derive it from what was streamed: an
  // incremental runner's assistant events are deltas (join them all), a
  // non-incremental runner's are complete messages (the last one is final).
  const resultText =
    (lastResult as { text?: string }).text ||
    (runnerSpec(opts.runtime)?.streamsIncrementally ? rawTexts.join('') : rawTexts.at(-1));
  safeEmit({
    v: 1,
    type: 'result',
    subtype: isError ? 'error' : 'success',
    is_error: isError,
    stop_reason: mapStopReason(lastResult.subtype, rawTexts, state.terminal),
    ...(resultText ? { text: resultText } : {}),
    input_tokens: totals.in,
    output_tokens: totals.out,
    cost_usd: totals.usd,
    ...resultVisibility(lastResult, opts.model),
  });
  const bg = backgroundPids();
  return finish(isError ? 1 : 0, bg ? { background_pids: bg } : undefined);
}

/** Over this much main-thread context per call, every further call re-reads it. */
const CONTEXT_WARN_TOKENS = 200_000;

/** #655: what the request actually ran on, beside what was selected. `model_usage`
 *  is per model served (child agents included); `unexpected_models` lists those
 *  that are not the selected model, so an escalation is visible, not inferred. */
export function resultVisibility(
  m: AgentMessage,
  selected: string | undefined,
): Record<string, unknown> {
  const used = m.model_usage ? Object.keys(m.model_usage) : [];
  const sel = selected && selected !== 'default' ? selected.toLowerCase() : undefined;
  const unexpected = sel
    ? used.filter((u) => !u.toLowerCase().includes(sel) && !sel.includes(u.toLowerCase()))
    : [];
  return {
    ...(m.model_usage ? { model_usage: m.model_usage } : {}),
    ...(m.effort ? { effort: m.effort } : {}),
    ...(m.agent_launches ? { agent_launches: m.agent_launches } : {}),
    ...(m.peak_context_tokens
      ? {
          peak_context_tokens: m.peak_context_tokens,
          ...(m.peak_context_tokens > CONTEXT_WARN_TOKENS ? { context_warning: true } : {}),
        }
      : {}),
    ...(unexpected.length ? { unexpected_models: unexpected } : {}),
  };
}
