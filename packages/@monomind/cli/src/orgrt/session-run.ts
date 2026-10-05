// packages/@monomind/cli/src/orgrt/session-run.ts
// Extracted from session.ts — one bounded runner session for a role (runOneSession).

import { homedir, tmpdir } from 'node:os';
import type { AgentRunner } from './agent-runner.js';
import { ClaudeAgentRunner, defaultClaudeRunner } from './agent-runner.js';
import { ensureAuthorityDirs } from './authority-mask.js';
import { appendContextCall } from './context-log.js';
import { resolveRoleCostTier } from './cost-tier.js';
import type { CumulativeMeter } from './cumulative-meter.js';
import { sectionsRoleProtection } from './documents/role-protection.js';
import { effectiveRole } from './effective-role-policy.js';
import { roleExecMask } from './exec-deny.js';
import type { StreamOptions } from './mailbox.js';
import { ensureOperatorProtectedPaths } from './operator-protected-paths.js';
import { buildOrgTools } from './org-tools.js';
import type { TokenUsage } from './policy.js';
import { summarizeToolOutput } from './policy.js';
import { resolveRoleProvider } from './provider.js';
import { ensureRoleDeps, roleDepsAudit, waitRoleDeps } from './role-deps.js';
import { resolveRoleGitEnforcement, roleAuthorityMask } from './role-sandbox.js';
import { effectiveRoleRuntime } from './runner-resolve.js';
import { BUDGET_STOP_SUBTYPE, INTERRUPTED_SUBTYPE, USD_STOP_SUBTYPE } from './runner-usage.js'; // #550: a runner's budget stop
import { type FaultRestarts, ProcessFaultError } from './sandbox-fault.js';
import { sandboxStubPaths, sandboxStubs } from './sandbox-stubs.js';
import { beginFullAccessSession, endFullAccessSession } from './session-full-access.js';
import { resolveModel } from './session-prompt.js';
import { openSessionStream, sessionRunArgs } from './session-stream.js';
import type { SessionOpts } from './session-types.js';
import {
  addTo,
  emitUsage,
  newResponseUsage,
  resultBreakdown,
  settleResultTokens,
  totalTokens,
  turnBreakdown,
} from './session-usage.js';
import { StateDetector } from './state-detector.js';
import { linkAbort } from './task-cancel.js';
import type { ToolResultEventData } from './types.js';
import { assertWriterBoundary } from './writer-boundary.js';

const CONTEXT_LIMIT_RE = /context.window.limit|context.length.exceeded|maximum.context/i;

/** One bounded SDK session for a role; resolves with the SDK's session_id (for
 *  resuming on restart) and whether it ended by hitting the turn limit (so the
 *  caller can push a continuation) when the stream ends (mailbox closed or
 *  maxTurns reached). */
export async function runOneSession(
  opts: SessionOpts,
  resume?: string,
  costTotals?: CumulativeMeter<{ usd: number }>,
  progress?: { replied: boolean },
  tokenTotals?: CumulativeMeter<TokenUsage>,
  streamOpts?: StreamOptions,
  faultWatch?: ReturnType<FaultRestarts['watch']>,
  cancelled?: AbortSignal,
): Promise<{ sessionId?: string; hitTurnLimit?: boolean }> {
  const { org, bus, policy, mailbox, cwd } = opts;
  // Spec 6.12: the same effective policy the role's engine runs on (effective-role-policy.ts).
  const role = effectiveRole(opts.def, opts.role, { orgRoot: opts.orgRoot, workdir: cwd });
  // Each call starts a new runner process, whose cumulative totals may or may
  // not continue the previous one's (cumulative-meter.ts).
  costTotals?.newProcess();
  tokenTotals?.newProcess();
  // Read lastMessageId live from opts instead of capturing at session start
  // This ensures chat responses link to the most recent message delivered
  const getLastMessageId = () => (opts.lastMessageId ? opts.lastMessageId() : undefined);

  // Resolve runner. Precedence: explicit runner > queryFn-wrapped > default.
  // queryFn stays supported so daemon.ts / test-loop.ts need no changes.
  const runner: AgentRunner =
    opts.runner ?? (opts.queryFn ? new ClaudeAgentRunner(opts.queryFn) : defaultClaudeRunner);
  policy.budgetFloorGated = runner.budgetFloorGated === true; // #550 (budget-closure.ts)

  const tools = buildOrgTools(opts);
  // M1: provider tools are listed per session start, so a hot-reloaded
  // tool_providers block takes effect at the role's next session.
  const providerSet = opts.buildProviderTools ? await opts.buildProviderTools() : undefined;
  if (providerSet) tools.push(...providerSet.tools);

  // Named-provider resolution (`adapter_config.provider`): explicit role
  // provider wins, else the named entry from `monomind providers configure`.
  // The named provider's default model fills in adapter_config.model when the
  // role didn't pin one.
  const prov = resolveRoleProvider(role, opts.orgRoot ?? opts.cwd);
  // ADR-O001 D8: the role's cost tier, when the org declares one. Resolved
  // here — the single choke point where a role's model is decided — so the
  // documented precedence holds in exactly one place:
  //   explicit adapter_config.model > tier > named-provider default > runtime
  // The tier's EFFORT is applied even when the model came from an explicit
  // pin: which model to run and how hard to think are separate axes, and
  // silently dropping the effort because a model was pinned would be the
  // "silent downgrade" this decision exists to prevent.
  // Throws (fails the session) rather than guessing when the tier has no
  // entry for this role's provider — daemon.ts validates the whole roster
  // up front so that is normally caught before any token is spent.
  const tier = resolveRoleCostTier({
    role,
    def: opts.def,
    vendor: role.provider?.vendor ?? prov.cfg?.vendor,
  });
  const model =
    role.adapter_config?.model ??
    tier?.model ??
    prov.defaultModel ??
    resolveModel(role, role.runtime, role.provider?.vendor ?? prov.cfg?.vendor);

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  // #365: the ONLY place that decides whether this session actually runs
  // with full access — role.policy.access alone is never trusted below this
  // point. Absent opts.def (a handful of low-level tests construct
  // SessionOpts directly with no org def), a role can only ever be scoped.
  // #567: the runtime whose runner hosts this role (provider.kind included),
  // so full access, the sandbox choice and the audit name the one that runs.
  const runtimeKey = effectiveRoleRuntime(role.runtime, opts.def?.runtime, role.provider?.kind);
  const fullAccessSession = beginFullAccessSession(bus, role, opts.def, runtimeKey);
  const { resolvedAccess } = fullAccessSession;
  let fullAccessToolCalls = 0;

  let sessionId: string | undefined = resume;
  policy.noteSessionId(resume);
  let hitTurnLimit = false;
  let contextLimitFired = false;
  // #budget-realtime: real tokens already accounted for the message CURRENTLY
  // in flight, via the per-assistant-turn accounting below — reset to 0 each
  // time a 'result' message ends one mailbox message and the next one starts.
  // Exists purely so the 'result' branch never re-adds what this branch
  // already added (see there for why it can't just always add).
  let messageTurnTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  // Set when the runner reports a USD budget stop; the SDK then throws as its
  // CLI exits, which is the end of a budget-closed session, not a crash.
  let usdStopped = false;
  // #597: largest usage seen per API response id, so a response split across
  // several assistant messages is metered once (see newResponseUsage).
  const responseUsage = new Map<string, TokenUsage>();
  // Per-call context logging (context-log.ts): one record per model call.
  const sessionStartedAt = Date.now();
  let contextCalls = 0;
  // Abort hook for the runner (AgentRunArgs.signal): the silent-stream
  // abort below used to call iterator.return() only, which queues behind a
  // subprocess runner blocked in `for await (child.stdout)` — the child was
  // never killed, so every supervisor retry stacked another live CLI.
  //
  // Per attempt, linked one way to the caller's externalAbort (#256): the
  // silent-stream abort used to fire the daemon's slot controller itself,
  // permanently. Every retry then started on an already-aborted signal (a
  // runner honoring it kills its child at once) and the daemon's crash
  // backoff, which races that controller to notice an org stop, resolved
  // immediately - the role burned its retries and crashed. An org stop still
  // aborts the attempt; the attempt's own abort stays its own.
  const abort = new AbortController();
  const external = opts.externalAbort?.signal;
  const onExternalAbort = (): void => abort.abort(external?.reason);
  if (external?.aborted) onExternalAbort();
  else external?.addEventListener('abort', onExternalAbort, { once: true });
  // org_task_cancel for this process's task: end it the same way (task-cancel.ts).
  // Already aborted when it landed during the setup awaits above.
  const unlinkCancelled = linkAbort(cancelled, abort);
  // #365: `~/.monomind/logs/agent-exec-full-access.log` gets one line per
  // full-access session run regardless of how it ends — set from every exit
  // path (the try block's return, or a caught error rethrown after).
  let sessionExitCode = 1;
  try {
    // #258: policy.git enforced where git runs, not only by Bash text
    // classification — guard env for every runtime, OS sandbox + file-tool
    // deny rules for Claude. Throws (session fails) when the role requires
    // the sandbox and it can't start.
    // #559: the role cannot write ~/.monomind/deps, so the host installs what
    // it may need there first. Nothing to install: no await, no yield. An
    // org stop or a slow install does not hold the session start.
    let deps = (opts.ensureRoleDeps ?? ensureRoleDeps)(runtimeKey);
    if (deps instanceof Promise) deps = await waitRoleDeps(deps, abort.signal);
    const depsAudit = roleDepsAudit(deps);
    if (depsAudit) bus.emit({ type: 'audit', from: role.id, ...depsAudit });
    // Before the sandbox is built: it can only mask directories that exist.
    ensureAuthorityDirs(homedir(), process.env);
    // #502 review: and the operator-protected paths a role must not plant.
    ensureOperatorProtectedPaths({ home: homedir(), env: process.env, orgRoot: opts.orgRoot });
    // #365: an ACTIVE full-access role gets none of policy.git's layers —
    // "removes the remaining PolicyEngine checks too" — so it never calls
    // resolveRoleGitEnforcement/roleAuthorityMask at all, regardless of its
    // own (irrelevant) policy.git value. Every other role's enforcement is
    // built exactly as before this issue.
    // GA rows R2 to R5: what a sections org withholds from this role's runner.
    const protection = sectionsRoleProtection({
      def: opts.def,
      orgDir: opts.orgDir,
      roleId: role.id,
      runtime: runtimeKey,
      home: homedir(),
      env: process.env,
    });
    const gitEnforcement =
      resolvedAccess.access === 'full'
        ? { env: {} as Record<string, string> }
        : resolveRoleGitEnforcement({
            org,
            role,
            cwd,
            orgRoot: opts.orgRoot,
            orgDir: opts.orgDir,
            denyReadDirs: protection.denyReadDirs,
            denyWriteDirs: protection.denyWriteDirs,
            run: opts.run,
            bus,
            claudeRuntime: runner instanceof ClaudeAgentRunner,
            runtime: runtimeKey,
            // The sandbox's mount-point stubs, created once and kept until the run
            // ends, so no other role's process deletes one mid-bind (sandbox-stubs.ts).
            // Held before the deny list is built, which keeps a denied cwd read-only
            // when all of them are in place (sandbox-deny-write.ts).
            holdStubs: (writableRoots) => {
              const paths = sandboxStubPaths({
                cwd,
                home: homedir(),
                writableRoots,
                env: process.env,
              });
              sandboxStubs.hold(`${org}:${opts.run ?? ''}`, paths);
              return sandboxStubs.missing(paths);
            },
          });
    // What this session really got, not what the config asked for (policy-git.ts).
    policy.setOsSandboxed(!!gitEnforcement.claudeRestrictions?.sandbox);
    assertWriterBoundary({
      def: opts.def,
      role,
      cwd,
      orgRoot: opts.orgRoot,
      bus,
      restrictions: gitEnforcement.claudeRestrictions,
      claudeRuntime: runner instanceof ClaudeAgentRunner && resolvedAccess.access !== 'full',
    });
    const authorityMask =
      resolvedAccess.access === 'full'
        ? undefined
        : roleExecMask({
            bus,
            roleId: role.id,
            denyExec: role.policy?.sandbox?.denyExec,
            denyRead: role.policy?.sandbox?.denyRead,
            bestEffortDenyRead: protection.bestEffortDenyRead,
            bestEffortReadOnly: protection.bestEffortReadOnly,
            bestEffortBinds: protection.bestEffortBinds,
            homeWriteAllow: role.policy?.sandbox?.homeWriteAllow,
            writableRoots: [
              cwd,
              opts.orgRoot,
              tmpdir(),
              process.env.TMPDIR,
              ...(role.policy?.sandbox?.allowWrite ?? []),
            ],
            home: homedir(),
            env: process.env,
            authorityMask: roleAuthorityMask({
              bus,
              roleId: role.id,
              inSdkSandbox: !!gitEnforcement.claudeRestrictions?.sandbox,
              // vercel runs in-process with no shell; its file tools go through the policy engine.
              inProcess: runtimeKey === 'vercel',
              cwd,
              orgRoot: opts.orgRoot,
              fileWrite: role.policy?.fileWrite,
              allowWrite: role.policy?.sandbox?.allowWrite,
            }),
          });
    const stream = runner.run(
      sessionRunArgs(opts, {
        runner,
        tools,
        streamOpts,
        gitEnforcement,
        model,
        tier,
        prov,
        resume,
        authorityMask,
        abort,
        resolvedAccess,
        runtimeEnv: protection.runtimeEnv,
      }),
    );

    const detector = new StateDetector();
    const rest = await openSessionStream(opts, stream, abort);

    for await (const m of rest) {
      if (process.env.MONOMIND_DEBUG) {
        console.error(
          `[orgrt:${org}/${role.id}] runner message type=${m.type} subtype=${String(m.subtype ?? '-')}`,
        );
      }
      if (cancelled?.aborted) throw cancelled.reason;
      mailbox.observeTurn(m.type); // the prompt stream outlives a live turn (#331)
      // #365: feeds ONLY 'tool_use'/'tool_result' — a no-op for every other
      // message type and, when this session isn't running with active full
      // access, a no-op entirely (fullAccessSession.tracker is unset).
      fullAccessSession.tracker?.onMessage(m);
      if (fullAccessSession.tracker && m.type === 'tool_result') fullAccessToolCalls++;
      if (m.session_id) {
        sessionId = m.session_id;
        policy.noteSessionId(sessionId);
        // P2-13: propagate the session ID back to the daemon so checkpoints
        // can resume the SDK session after a crash/restart.
        opts.onSessionId?.(sessionId);
      }
      const prevState = detector.current();
      const textForDetect = m.type === 'assistant' ? m.text || '' : undefined;
      const newState = detector.onMessage(m.type, m.subtype, textForDetect);
      if (newState !== prevState) {
        bus.emit({
          type: 'status',
          from: role.id,
          reason: 'state-change',
          msg: `${prevState} → ${newState}`,
          data: { from: prevState, to: newState },
        });
      }
      if (m.type === 'assistant') {
        if (progress) progress.replied = true;
        const text = m.text || '';
        if (text.trim()) {
          opts.onOutput?.(text);
          bus.emit({ type: 'chat', from: role.id, msg: text, parentId: getLastMessageId() });
          if (opts.onContextLimit && !contextLimitFired && CONTEXT_LIMIT_RE.test(text)) {
            contextLimitFired = true;
            bus.emit({
              type: 'audit',
              from: role.id,
              reason: 'boss-context-limit',
              msg: 'coordinator context window exhausted — requesting whole-org restart with fresh sessions',
            });
            opts.onContextLimit();
          }
        }
        // #budget-realtime (HIGH): the SDK's 'result' message arrives once per
        // WHOLE mailbox message in streaming-input mode — with
        // max_turns_per_message defaulting to 100,000, a single message can
        // internally loop through hundreds/thousands of tool-use turns before
        // that 'result' ever arrives, during which policy.used never moved and
        // policy.decide() allowed every one of those turns' tool calls
        // regardless of real spend (the overspend was already done by the time
        // overBudget could ever trip). Each 'assistant' SDK message DOES carry
        // that ONE model turn's real usage (agent-runner.ts reads it off
        // BetaMessage.usage) — accumulate it as turns actually happen and
        // enforce the budget immediately, so overBudget can close the mailbox
        // DURING a runaway message instead of only once it finally completes.
        // (USD budget can't get the same real-time treatment: the SDK only
        // exposes cost as a cumulative total on 'result', not per-turn on
        // 'assistant' — verified against this project's Claude Agent SDK
        // .d.ts, which puts `usage`/token counts on BetaMessage but cost only
        // on SDKResultSuccess.total_cost_usd/modelUsage. overBudgetUsd is
        // still checked below, once per message, same as before this fix.)
        //
        // ADR-O001 D1: the sum must include BOTH cache fields. They are
        // siblings of input_tokens in the Anthropic API, not subsets of it —
        // `input_tokens` is the uncached remainder — and both are billable
        // (~0.1x and ~1.25x input). Omitting them meant the better the cache
        // worked the less the meter saw: on one measured run, 2,765M tokens
        // billed against 8.1M recorded, with input_tokens at 0.0M.
        // A new response id is a new model call (split messages of one call repeat it).
        if (!m.response_id || !responseUsage.has(m.response_id)) {
          const full = turnBreakdown(m);
          const context = full.input + full.cacheRead + full.cacheCreation;
          appendContextCall(bus.dir, {
            ts: Date.now(),
            role: role.id,
            task_key: opts.contextKey ?? '_role',
            ...((m.session_id ?? sessionId) ? { session_id: m.session_id ?? sessionId } : {}),
            resumed: resume !== undefined,
            call_index: contextCalls,
            session_age_ms: Date.now() - sessionStartedAt,
            first_call: contextCalls === 0,
            parent: Boolean(m.parent_tool_use_id),
            ...(m.response_id ? { response_id: m.response_id } : {}),
            context_tokens: context,
            input: full.input,
            cache_read: full.cacheRead,
            cache_creation: full.cacheCreation,
            output: full.output,
            cache_hit_ratio: context ? full.cacheRead / context : 0,
          });
          contextCalls++;
        }
        const turn = newResponseUsage(responseUsage, m);
        // The session cap counts the main session only; a native child has its own history.
        if (!m.parent_tool_use_id) opts.sessionCap?.addTokens(totalTokens(turn));
        const turnTokens = totalTokens(turn);
        if (turnTokens > 0) {
          addTo(messageTurnTokens, turn);
          policy.addTokenUsage(turn);
          if (policy.overBudget) {
            bus.emit({
              type: 'status',
              from: role.id,
              reason: 'budget-exhausted',
              msg: 'token budget exhausted - closing session',
            });
            mailbox.close('token-budget');
          }
        }
      } else if (m.type === 'tool_result') {
        // #289: the tool call's outcome. Until this event existed, a Bash
        // running a test suite looked identical on the bus whether the suite
        // passed, failed, or the binary was missing — one 'allow' at the moment
        // it started — so every consumer inferred success from the agent's own
        // narration. `call_id` joins this back to that invocation event; the
        // body is redacted and capped (policy.ts) so a megabyte of output, or a
        // credential echoed by a command, never lands in bus.jsonl.
        const body = summarizeToolOutput(m.text ?? '');
        const data: ToolResultEventData = {
          ...(m.tool_use_id ? { call_id: m.tool_use_id } : {}),
          ok: m.is_error !== true,
          ...(typeof m.duration_ms === 'number' ? { duration_ms: m.duration_ms } : {}),
          output: body.output,
          ...(body.truncated ? { truncated: true } : {}),
          output_chars: body.output_chars,
        };
        bus.emit({
          type: 'tool_result',
          from: role.id,
          ...(m.tool ? { tool: m.tool } : {}),
          data: data as unknown as Record<string, unknown>,
        });
        faultWatch?.observe(m, sessionId);
      } else if (m.type === 'result') {
        // ADR-O001 D1: prefer the SDK's `modelUsage` over `usage`. The SDK
        // documents `usage` as "MAIN AGENT LOOP ONLY — excludes Task
        // subagent, sidechain, and auxiliary model calls ... Prefer
        // modelUsage for token/cost accounting"; the measured run made 46
        // subagent calls this counter never saw. modelUsage is CUMULATIVE per
        // session (same lifecycle as total_cost_usd, per its own type doc),
        // so it is converted to a delta here rather than added, exactly as
        // cost is below. A runner that reports no modelUsage falls back to
        // the per-turn `usage` fields, which keep their old semantics.
        // Missing usage is visible, never counted as zero (session-cap.ts).
        if (totalTokens(messageTurnTokens) === 0) opts.sessionCap?.usageMissing();
        const resultTokens = resultBreakdown(m, tokenTotals, m.session_id ?? sessionId ?? '');
        const messageTokens = settleResultTokens(policy, resultTokens, messageTurnTokens);
        messageTurnTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
        // Convert the SDK's cumulative total_cost_usd into a per-result
        // delta before emitting - downstream sums usage events. A new session
        // id counts in full; a same-process dip (rounding, a provider-side
        // correction) floors at 0 rather than re-adding the cumulative cost,
        // which feeds USD budget enforcement (ORG-7). A resume in a new
        // process is judged by the meter (cumulative-meter.ts).
        let costDelta = m.cost_usd;
        if (costTotals && typeof m.cost_usd === 'number' && Number.isFinite(m.cost_usd)) {
          const sid = m.session_id ?? sessionId ?? '';
          costDelta = costTotals.delta(sid, { usd: m.cost_usd }).usd;
        }
        // ORG-7: accumulate real USD cost so policy.overBudgetUsd (role.budget_usd) is enforceable.
        if (typeof costDelta === 'number' && Number.isFinite(costDelta))
          policy.addUsageUsd(costDelta);
        emitUsage(bus, role.id, messageTokens, costDelta, m.subtype);
        if (
          m.subtype &&
          m.subtype !== 'success' &&
          m.subtype !== BUDGET_STOP_SUBTYPE &&
          m.subtype !== USD_STOP_SUBTYPE &&
          m.subtype !== INTERRUPTED_SUBTYPE
        ) {
          if (m.subtype === 'error_max_turns') hitTurnLimit = true;
          bus.emit({
            type: 'audit',
            from: role.id,
            reason: 'session-result-error',
            msg: `turn ended with subtype "${m.subtype}"${m.is_error ? ' (is_error)' : ''} - the role produced no usable output`,
          });
          if (opts.circuitBreaker && m.subtype !== 'error_max_turns') {
            const cb = opts.circuitBreaker;
            cb.state.failures++;
            if (cb.state.failures >= cb.threshold) {
              cb.state.tripped = true;
              bus.emit({
                type: 'audit',
                from: role.id,
                reason: 'circuit-breaker-tripped',
                msg: `circuit breaker tripped after ${cb.state.failures} consecutive failures — closing role`,
                data: { failures: cb.state.failures, threshold: cb.threshold },
              });
              mailbox.close();
            }
          }
        } else if (m.subtype === 'success' && !m.is_error && opts.circuitBreaker) {
          opts.circuitBreaker.state.failures = 0;
        }
        if (policy.overBudget || m.subtype === BUDGET_STOP_SUBTYPE) {
          bus.emit({
            type: 'status',
            from: role.id,
            reason: 'budget-exhausted',
            msg: 'token budget exhausted - closing session',
          });
          // #205: tag WHY the mailbox closed. A budget-exhausted boss is
          // recoverable (raise the budget, resume) — the idle watchdog reads
          // this to stop reporting it as generic "unreachable" (crash-like).
          mailbox.close('token-budget');
        }
        // A turn the API ended with an error ("API Error: Server error
        // mid-response") arrives as subtype 'success' with is_error. The Claude
        // CLI can outlive it for the API timeout (600 s observed, run
        // run-20261004195437-tzfx) and the SDK throws only when it exits, so
        // the role sat idle that long before its restart. End the session now:
        // the daemon's restart path takes it from here.
        if (m.subtype === 'success' && m.is_error === true) {
          const text = m.text ?? 'no error text';
          bus.emit({
            type: 'audit',
            from: role.id,
            reason: 'session-result-error',
            msg: `turn ended with an error result - ending the session: ${text}`,
          });
          throw new Error(`Claude Code returned an error result: ${text}`);
        }
        // ORG-7: parallel USD-budget enforcement, same pattern as the token check above.
        if (m.subtype === USD_STOP_SUBTYPE) usdStopped = true;
        if (policy.overBudgetUsd || m.subtype === USD_STOP_SUBTYPE) {
          bus.emit({
            type: 'status',
            from: role.id,
            reason: 'budget-exhausted',
            msg: 'USD budget exhausted - closing session',
          });
          mailbox.close('usd-budget');
        }
        // The turn is over: whatever tool calls it was going to make, it has
        // made. What the role left open is knowable here (decisions.ts's
        // nudgeOpenTasksAtTurnEnd) instead of only to the idle watchdog.
        opts.onTurnEnd?.();
      }
    }
    if (cancelled?.aborted) throw cancelled.reason;
    bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
    sessionExitCode = 0;
    return { sessionId, hitTurnLimit };
  } catch (err) {
    if (usdStopped && mailbox.closeReason === 'usd-budget') {
      bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
      sessionExitCode = 0;
      return { sessionId, hitTurnLimit };
    }
    sessionExitCode = 1;
    // The turn in flight never got its 'result', so its metered turns (already
    // in policy) have no usage event yet. Cost is only on 'result': unknown.
    if (totalTokens(messageTurnTokens) > 0)
      emitUsage(bus, role.id, messageTurnTokens, undefined, 'aborted');
    // Ending the process was the point; sandbox-fault.ts already audited it.
    if (err instanceof ProcessFaultError) throw err;
    if (cancelled?.aborted) throw cancelled.reason;
    // org_complete / org stop close the mailbox and abort every session: a
    // normal stop, not a failure. The daemon still classifies it.
    const message = err instanceof Error ? err.message : String(err);
    if (
      (mailbox.isClosed || (external?.aborted ?? false)) &&
      ((err as { name?: string } | null)?.name === 'AbortError' || /\baborted\b/i.test(message))
    ) {
      bus.emit({
        type: 'status',
        from: role.id,
        reason: 'session-stopped',
        msg: 'session stopped',
      });
      throw err;
    }
    // #304: the daemon's role loop catches this same error one step later and
    // emits the authoritative CLASSIFIED status — crashed / stopped with the
    // org / terminated by stop — carrying the real error text when it is a
    // genuine crash (daemon.ts's 'agent-session-crash' audit). This
    // breadcrumb must not pre-empt that with the raw SDK string: on a
    // planned stop it announced "Claude Code process aborted by user" about
    // a stop nobody requested. It deliberately does NOT classify —
    // session.ts relays, the daemon decides — and it carries a `reason` so
    // it is filterable; its absence is why every #304/#251 test was
    // structurally unable to see this event.
    bus.emit({
      type: 'status',
      from: role.id,
      reason: 'session-error',
      msg: 'session ended with an error — see the classified status that follows',
    });
    throw err;
  } finally {
    // Unlink so a long-lived role doesn't pile a listener per attempt onto the
    // slot controller. Aborting the finished attempt keeps a runner abandoned
    // mid-stream by a throw from outliving it now that an org stop can no
    // longer reach it.
    external?.removeEventListener('abort', onExternalAbort);
    unlinkCancelled();
    abort.abort();
    providerSet?.close();
    endFullAccessSession(fullAccessSession, {
      org,
      role: role.id,
      cwd,
      runtime: runtimeKey,
      sessionId,
      exitCode: sessionExitCode,
      toolCalls: fullAccessToolCalls,
    });
  }
}
