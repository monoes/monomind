// packages/@monomind/cli/src/orgrt/session-stream.ts
// Extracted from session-run.ts — opening one role session's runner stream:
// the AgentRunner.run() arguments and the silent-first-pull guard.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedAccess } from './access-grant.js';
import { fullAccessCanUseTool } from './agent-exec-access.js';
import type { AgentMessage, AgentRunner, OrgToolDef } from './agent-runner.js';
import { ClaudeAgentRunner } from './agent-runner.js';
import {
  CLAUDE_SANDBOX_CWD_ENV,
  claudeBashTimeoutEnv,
  claudeSandboxCwdNote,
} from './bash-timeout.js';
import { contextSurface } from './context-surface.js';
import type { resolveRoleCostTier } from './cost-tier.js';
import type { StreamOptions } from './mailbox.js';
import { NOTES_BUDGET, readNotes, selectNotes } from './notes.js';
import { toolchainRoleEnv } from './operator-toolchain-paths.js';
import {
  MAX_PACKET_CHARS,
  mapFirst,
  messageText,
  recordGeneration,
  withMessageText,
} from './packet.js';
import { resolveProviderEnv, type resolveRoleProvider } from './provider.js';
import type { resolveRoleGitEnforcement, roleAuthorityMask } from './role-sandbox.js';
import { roleTmpEnv } from './role-tmpdir.js';
import { INTERRUPT_GRACE_MS } from './runner-usage.js';
import { gatedCanUseTool } from './session-gate.js';
import { rolePromptFor } from './session-prompt.js';
import type { SessionOpts } from './session-types.js';
import { sessionTokenBudget, sessionUsdBudget } from './session-usage.js';

/** How long an SDK stream may stay open with zero messages before we say so.
 *  Comfortably longer than a slow first turn, shorter than the idle watchdog's
 *  10-minute window so the specific cause is reported before the generic
 *  "boss appears hung". */
const SILENT_SESSION_MS = 4 * 60_000;

/** The AgentRunner.run() arguments for one session, built by runOneSession. */
export function sessionRunArgs(
  opts: SessionOpts,
  s: {
    runner: AgentRunner;
    tools: OrgToolDef[];
    streamOpts: StreamOptions | undefined;
    gitEnforcement: ReturnType<typeof resolveRoleGitEnforcement>;
    model: string;
    tier: ReturnType<typeof resolveRoleCostTier>;
    prov: ReturnType<typeof resolveRoleProvider>;
    resume: string | undefined;
    authorityMask: ReturnType<typeof roleAuthorityMask>;
    abort: AbortController;
    /** #365: resolved by session-run.ts's resolveRoleAccess before this
     *  session's git enforcement/authority mask are built. Absent/`'scoped'`
     *  reproduces every field below byte-for-byte. */
    resolvedAccess?: ResolvedAccess;
  },
): Parameters<AgentRunner['run']>[0] {
  const { org, role, policy, mailbox, cwd } = opts;
  const {
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
  } = s;
  const fullAccess = resolvedAccess?.access === 'full';
  return {
    tools,
    // No options = the pre-D3 stream, exactly. An org on the Phase 2 context
    // surface also records the first message of each fresh SDK session
    // (packet.ts) and, with notes: true, starts it with the role's notes
    // (notes.ts); a resumed session is left alone.
    prompt: ((): AsyncIterable<unknown> => {
      const raw = streamOpts ? mailbox.stream('', streamOpts) : mailbox.stream();
      const surface = contextSurface(opts.def);
      if (resume !== undefined || !surface.enabled) return raw;
      return mapFirst(raw, (m) => {
        const original = messageText(m);
        let text = original;
        let notes: { entries: number; omitted: number; block: string } | undefined;
        if (surface.notes && opts.orgDir) {
          // The notes share the 12,000-character limit on a first message's variable parts.
          const room = Math.min(NOTES_BUDGET, MAX_PACKET_CHARS - original.length - 2);
          const sel = selectNotes(readNotes(opts.orgDir, role.id), room);
          if (sel.block) text = `${sel.block}\n\n${original}`;
          notes = { entries: sel.included.length, omitted: sel.omitted, block: sel.block };
        }
        recordGeneration(opts.bus.dir, {
          role: role.id,
          task_key: opts.contextKey ?? '_role',
          first: text,
          notes,
        });
        return text === original ? m : withMessageText(m, text);
      });
    })() as never,
    systemPrompt: gitEnforcement.claudeRestrictions?.sandbox
      ? `${rolePromptFor(opts)}\n\n${claudeSandboxCwdNote(cwd)}`
      : rolePromptFor(opts),
    model,
    cwd,
    effort: tier?.effort,
    env: {
      ...resolveProviderEnv(prov.cfg),
      // #480: the session's private TMPDIR. Right after the inherited env so
      // any overlay below that sets TMPDIR itself keeps its explicit value.
      ...roleTmpEnv(opts.roleTmpdir),
      // #527: the pnpm home is read-only to roles, and pnpm keeps its store
      // there by default: a role's store goes beside it, and pnpm does not
      // self-install into it.
      ...toolchainRoleEnv(homedir(), process.env),
      // D8: how a NON-Claude provider expresses the tier's effort level.
      // Empty for Claude (handled natively by ClaudeAgentRunner) and for a
      // provider that declares no mechanism — which simply ignores effort.
      ...(tier?.env ?? {}),
      // Claude Code's 2-minute Bash default is too short for org work.
      ...(runner instanceof ClaudeAgentRunner
        ? claudeBashTimeoutEnv(opts.def?.run_config?.bash_timeout_ms)
        : {}),
      // Custom-endpoint providers (named-provider path): pin the engine's
      // model env so background/haiku tasks also route to the endpoint's
      // model instead of erroring on an Anthropic-only default.
      ...(prov.cfg?.authToken ? { ANTHROPIC_MODEL: model, ANTHROPIC_SMALL_FAST_MODEL: model } : {}),
      ...gitEnforcement.env,
      ...(gitEnforcement.claudeRestrictions?.sandbox ? CLAUDE_SANDBOX_CWD_ENV : {}),
      // No MONOMIND_HOOK_QUIET / MONOMIND_GRAPH_GATE / MONOMIND_SDK_AGENT
      // here (#249): every CLI hands this env to its shell tool, so they
      // reached every command the role ran and silently muted monomind's
      // own hooks, graph gate and tests inside the role. ClaudeAgentRunner
      // loads no filesystem hooks (settingSources: []). The codex/kimi/
      // opencode hook bridges generated by `monomind init` read the
      // MONOMIND_ORG_ROLE marker below and set the quieting vars on the
      // hook-handler process they spawn — hooks stay quiet, commands don't.
      //
      // Per-role scoping for runners that persist state under the org dir
      // (VercelAgentRunner session files). Without these, session files would
      // land in args.cwd (project root for workspace:'repo') under the literal
      // 'default' roleId, polluting the repo and making files unattributable.
      MONOMIND_ORG_DIR: opts.orgDir ?? opts.cwd,
      MONOMIND_ROLE_ID: role.id,
      // M1: attribution for anything the role runs (C-16).
      MONOMIND_ORG_NAME: org,
      MONOMIND_ORG_ROLE: role.id,
      ...(opts.run ? { MONOMIND_ORG_RUN: opts.run } : {}),
      ...(opts.orgRoot ? { MONOMIND_ORG_ROOT: opts.orgRoot } : {}),
    },
    maxTurns: opts.maxTurns ?? 30,
    maxToolRounds: role.max_tool_rounds ?? opts.def?.run_config?.max_tool_rounds,
    resume,
    claudeRestrictions: gitEnforcement.claudeRestrictions,
    authorityMask,
    // ADR-O001 D2: tool results are 76% of a role's context mass and nothing
    // bounded them. Under the ORG STATE dir (never the workspace cwd, which
    // may be the repo), and under orgRoot — which file-roots.ts already
    // makes readable to the role's file tools and role-sandbox.ts already
    // makes readable to Bash — so the path in the digest actually resolves
    // when the role decides it needs the full text.
    toolSpillDir: join(
      opts.orgDir ?? opts.cwd,
      'tool-results',
      role.id.replace(/[^a-zA-Z0-9_.-]/g, '_'),
    ),
    // #365: a role whose access resolved to 'full' this session gets the
    // SAME canUseTool agent-exec.ts's `--access full` uses — every call is
    // allowed (still observed: coverEveryToolCall/ToolActivityTracker below
    // both read the message stream, not this function). Every other role's
    // canUseTool is byte-identical to before this issue.
    canUseTool: fullAccess
      ? fullAccessCanUseTool
      : gatedCanUseTool(
          policy,
          opts.beforeTool,
          role.id,
          opts.fence,
          opts.onDecision
            ? (toolName, _input, decision, kind) =>
                opts.onDecision?.(role.id, toolName, decision.message ?? 'denied', kind)
            : undefined,
          opts.hasPendingGate,
        ),
    // test seam forwarded through extras: lets the scripted fake SDK
    // (test-loop.ts) drive org_send and tool calls through the real
    // deliver/policy paths; the real SDK ignores it. #365 additionally asks
    // ClaudeAgentRunner for the rich 'tool_use' start event (agent-runner-
    // claude.ts's `emitToolUse`) so a full-access role's tool_activity bus
    // events (session-run.ts) get real start/end pairs, without opting a
    // scoped role into anything.
    extras:
      opts.runner && !fullAccess
        ? undefined
        : {
            ...(opts.runner
              ? undefined
              : {
                  _orgTest: {
                    deliver: (to: string, subject: string, body: string) =>
                      opts.deliver(role.id, to, subject, body),
                    callTool: (name: string, input: Record<string, unknown>) =>
                      policy.decide(name, input),
                  },
                }),
            ...(fullAccess ? { includeToolUseEvents: true } : {}),
          },
    signal: abort.signal,
    tokenBudget: () => sessionTokenBudget(policy, mailbox), // #550
    usdBudget: () => sessionUsdBudget(policy, mailbox),
    interruptGraceMs: INTERRUPT_GRACE_MS,
    // VercelAgentRunner-only fields — ignored by other runners.
    vendor: role.provider?.vendor,
    providerConfig: role.provider,
    ...(fullAccess ? { access: 'full' as const } : {}),
    ...(fullAccess && role.policy?.settings?.length
      ? { settingSources: role.policy.settings }
      : {}),
  } as any;
}

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
export async function openSessionStream(
  opts: SessionOpts,
  stream: AsyncIterable<AgentMessage>,
  abort: AbortController,
): Promise<AsyncGenerator<AgentMessage>> {
  const { org, role, bus } = opts;
  const openedAt = Date.now();
  const iterator = stream[Symbol.asyncIterator]();
  const SILENT = Symbol('silent');
  let silentTimer: ReturnType<typeof setTimeout> | undefined;
  const silentMs = opts.silentSessionMs ?? SILENT_SESSION_MS;
  const firstPull = await Promise.race([
    iterator.next(),
    new Promise<typeof SILENT>((resolve) => {
      silentTimer = setTimeout(() => resolve(SILENT), silentMs);
      (silentTimer as { unref?: () => void }).unref?.();
    }),
  ]);
  clearTimeout(silentTimer);
  if (firstPull === SILENT) {
    bus.emit({
      type: 'audit',
      from: role.id,
      reason: 'session-silent',
      msg: `SDK stream open ${Math.round((Date.now() - openedAt) / 1000)}s with zero messages - aborting this attempt and retrying. Set MONOMIND_DEBUG=1 to log raw message types.`,
    });
    // Kill the runner's subprocess FIRST: iterator.return() below cannot
    // reach a runner blocked in its stdout loop, and the retry would
    // otherwise spawn a second CLI next to the still-running first one.
    abort.abort();
    try {
      await Promise.race([
        iterator.return?.(undefined) ?? Promise.resolve(),
        new Promise<void>((r) => {
          const t = setTimeout(() => r(), 2_000);
          (t as { unref?: () => void }).unref?.();
        }),
      ]);
    } catch {
      /* best-effort */
    }
    throw new Error(
      `org "${org}" role "${role.id}": SDK stream silent for ${Math.round(silentMs / 1000)}s with zero messages`,
    );
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
  return rest();
}
