// packages/@monomind/cli/src/orgrt/role-incarnation.ts
// Extracted from daemon.ts — building one role incarnation and its supervised
// crash-retry loop.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type RoleCheckpoint, restoredRoleStatus, restoreMailboxQueue } from './checkpoint.js';
import { OrgDaemon } from './daemon.js';
import type { AgentRuntime, RunningOrg } from './daemon-types.js';
import { ScrollbackBuffer } from './daemon-types.js';
import { sectionRoleCap } from './documents/section-budget-wire.js';
import { effectiveRolePolicy } from './effective-role-policy.js';
import { fileToolRoots } from './file-roots.js';
import { resolveLoadout, sessionLoadoutFor } from './loadouts.js';
import { isRecoverableCloseReason, Mailbox } from './mailbox.js';
import { PolicyEngine } from './policy.js';
import { buildRoleSessionOpts } from './role-session-opts.js';
import { computeReplacementBudget } from './role-slot.js';
import { runAgentSession } from './session.js';
import { effectiveToolProviders } from './skill-library.js';
import { TaskProcesses } from './task-cancel.js';
import { roleProviderPrefixes } from './tool-providers.js';
import { ORG_DIR, type OrgRole } from './types.js';
import { WriterPolicyEngine } from './writer-engine.js';

/** Build one role incarnation: mailbox, policy, AgentRuntime, sessionOpts,
 *  and the supervised crash-retry loop. Used by BOTH the startup lazy-spawn
 *  path (generation 0, via the `spawnRole` closure inside startOrgInner)
 *  and respawnRole() (generation N+1). Does not touch running.agents or
 *  running.roleSlots — callers publish the result themselves. */
export function spawnRoleIncarnation(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  role: OrgRole,
  generation: number,
  opts: {
    roleCheckpoint?: RoleCheckpoint;
    abort?: AbortController;
    budgetTokensOverride?: number;
  } = {},
): { runtime: AgentRuntime; abort: AbortController } {
  const { roleCheckpoint } = opts;
  const abort = opts.abort ?? new AbortController();
  const { def, bus } = running;
  const cwd = running.workdir!;
  const ws = daemon.workspaceSetting(def);
  const perRoleBudget = opts.budgetTokensOverride ?? computeReplacementBudget(def, role.id);
  let roleCwd = cwd;
  const existingSlot = running.roleSlots.get(role.id);
  if (ws === 'worktree-per-role' && role.id !== running.bossRoleId) {
    const wtPath = join(daemon.root, ORG_DIR, name, `worktree-${role.id}`);
    if (existingSlot?.runtime?.worktreePath === wtPath && existsSync(wtPath)) {
      // A replacement (generation > 0) reuses the SAME worktree path —
      // recreating it here would delete any uncommitted work the old
      // incarnation left behind (design constraint #5).
      roleCwd = wtPath;
    } else {
      try {
        // Q7: top-level `import { execFileSync }` replaces the inlined
        // `require('node:child_process')` that broke ESM at runtime —
        // vitest's CJS shim masked it in tests but the built package
        // threw "require is not defined" in real Node ESM execution.
        // SEC-5: argv-array form, no shell.
        if (existsSync(wtPath)) {
          try {
            execFileSync('git', ['worktree', 'remove', '--force', wtPath], {
              cwd: daemon.root,
              stdio: 'ignore',
              timeout: 30_000,
            });
          } catch {
            /* best-effort */
          }
        }
        execFileSync('git', ['worktree', 'add', wtPath, 'HEAD', '--detach'], {
          cwd: daemon.root,
          stdio: 'ignore',
          timeout: 30_000,
        });
        roleCwd = wtPath;
      } catch {
        /* fallback to shared cwd if git worktree fails */
      }
    }
  }
  const mailbox = new Mailbox();
  if (roleCheckpoint?.mailboxQueue?.length) {
    restoreMailboxQueue({ mailbox } as any, roleCheckpoint.mailboxQueue);
  }
  // A recoverable close (budget exhaustion) is left open on resume — see
  // isRecoverableCloseReason's doc comment. Re-closing it here would
  // make the idle watchdog's "raise the budget and resume" remedy a
  // no-op, since nothing in this codebase ever reopens a closed mailbox.
  if (
    roleCheckpoint?.mailboxClosed &&
    !isRecoverableCloseReason(roleCheckpoint.mailboxCloseReason)
  ) {
    mailbox.close(roleCheckpoint.mailboxCloseReason);
  }
  const sectionCap = sectionRoleCap(def, role.id); // P4.5: the one resolver, only with section budgets
  // Spec 6.12: the policy the engine and the sandbox layer share (effective-role-policy.ts); it is
  // `role.policy` itself unless the org has a single writer.
  const rolePolicy = effectiveRolePolicy(def, role, { orgRoot: daemon.root, workdir: roleCwd });
  const engineArgs = [
    role.id,
    {
      maxTokens: role.budget_tokens ?? perRoleBudget,
      // ADR-O001 D1: which basis that ceiling is enforced on. Defaults to
      // the historical uncached basis so the honest (cache-aware) meter
      // introduced alongside it cannot exhaust an existing budget_tokens —
      // including the schema's 1M default — roughly 100x early.
      maxTokensBasis: def.run_config.budget_tokens_basis ?? 'uncached',
      maxUsd: role.budget_usd,
      ...(rolePolicy ?? {}),
      ...(sectionCap !== undefined ? { maxUsd: sectionCap } : {}),
    },
    bus,
    roleCwd,
    // #303: the file tools (Read/Write/Edit/Glob/Grep) get the same extra
    // roots the Bash sandbox already treats as writable (role-sandbox.ts) —
    // $TMPDIR, the org root, and any policy.sandbox.allowWrite entries.
    // $HOME is deliberately excluded; see file-roots.ts.
    fileToolRoots({ cwd: roleCwd, orgRoot: daemon.root }, rolePolicy?.sandbox),
    daemon.root,
  ] as const;
  const policy =
    rolePolicy === role.policy
      ? new PolicyEngine(...engineArgs)
      : new WriterPolicyEngine(...engineArgs, def);
  policy.setToolContext({
    providerPrefixes: () =>
      roleProviderPrefixes({ tool_providers: effectiveToolProviders(role, daemon.root) }),
    trace: () => daemon.roleTrace(name, role.id),
  });
  // ADR-O001 D1: prefer the persisted four-quantity breakdown; a checkpoint
  // written before it existed still resumes via the scalar, on the uncached
  // basis it was recorded on.
  if (roleCheckpoint?.tokenUsage) {
    policy.setTokenUsage(roleCheckpoint.tokenUsage);
  } else if (roleCheckpoint?.tokensUsed) {
    policy.setUsage(roleCheckpoint.tokensUsed);
  }
  // ORG-7: restore accumulated USD spend across resume so a stop/resume
  // cycle can't reset a role's USD budget back to zero.
  if (roleCheckpoint?.costUsd) {
    policy.setUsageUsd(roleCheckpoint.costUsd);
  }
  // ADR-O001 D7: the loadout this incarnation's session is built with, fixed
  // for its life. A checkpointed role keeps what it had (its SDK session was
  // built with it); a replacement keeps its predecessor's; a new role takes
  // the loadout of the first ready task it is being spawned for.
  const loadoutName = roleCheckpoint
    ? roleCheckpoint.loadout
    : (existingSlot?.runtime?.loadout ?? sessionLoadoutFor(running.taskDag, role.id));
  let loadout: ReturnType<typeof resolveLoadout> | undefined;
  if (loadoutName) {
    try {
      loadout = resolveLoadout(def, loadoutName, daemon.root);
    } catch (err) {
      // Validated at start, so only a config hot-reload or a deleted
      // instructions_file lands here. Spawn without it, loudly: a role that
      // fails to spawn would strand its task, which is worse.
      bus.emit({
        type: 'audit',
        from: role.id,
        reason: 'loadout-unresolvable',
        msg: `role "${role.id}" spawned without loadout "${loadoutName}": ${err instanceof Error ? err.message : err}`,
        data: { loadout: loadoutName },
      });
    }
  }
  const runtime: AgentRuntime = {
    mailbox,
    policy,
    status: restoredRoleStatus(roleCheckpoint),
    done: Promise.resolve(),
    metrics: { tokens: roleCheckpoint?.tokensUsed ?? 0, costUsd: roleCheckpoint?.costUsd ?? null },
    lastMessageId: roleCheckpoint?.lastMessageId,
    error: roleCheckpoint?.error,
    sessionId: roleCheckpoint?.sessionId,
    worktreePath: roleCwd !== cwd ? roleCwd : undefined,
    scrollback: new ScrollbackBuffer(),
    ...(loadout ? { loadout: loadout.name } : {}),
    taskProcesses: new TaskProcesses(),
  };
  if (roleCheckpoint?.scrollback?.length) {
    for (const line of roleCheckpoint.scrollback) runtime.scrollback.push(line);
  }
  if (roleCheckpoint?.turns && !running.turns?.has(role.id)) {
    (running.turns ??= new Map()).set(role.id, roleCheckpoint.turns);
  }
  const sessionOpts = buildRoleSessionOpts(
    daemon,
    name,
    running,
    role,
    roleCwd,
    runtime,
    abort,
    loadout,
    policy,
    mailbox,
    roleCheckpoint,
  );
  // Supervised session: transient crashes (provider blips, network) restart
  // with backoff; a crash with the mailbox already closed, or one that
  // exhausts the retry budget, is terminal. runAgentSession already emits a
  // 'status' event for the raw error; the terminal 'audit' event is for
  // dashboards/alerts that filter on actionable failures (not routine
  // status chatter) so a dead agent surfaces instead of a run that
  // silently never progresses.
  const BACKOFFS_MS = daemon.opts.crashBackoffsMs ?? [1000, 5000, 15000];
  const myGeneration = generation;
  const isStaleGeneration = (): boolean =>
    (running.roleSlots.get(role.id)?.generation ?? 0) !== myGeneration;
  if (!mailbox.isClosed && runtime.status !== 'crashed') {
    runtime.done = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await runAgentSession(sessionOpts);
          runtime.status = 'ended';
          return;
        } catch (err) {
          // A deliberate respawn (see respawnRole) bumps the slot's
          // generation and force-stops this incarnation via its
          // externalAbort - that abort makes runAgentSession reject here
          // exactly like a real crash would. Recognize supersession
          // FIRST: this generation's retry loop must never restart,
          // never run terminal crash handling, and never notify the
          // boss - the replacement (a new generation, spawned
          // separately) already owns this role id.
          if (isStaleGeneration()) return;
          // Drop the crashed session's stale waker immediately: a push()
          // during the backoff window must queue for the NEXT session, not
          // wake the dead generator to swallow it.
          mailbox.detach();
          // #203: if the crashed session's mailbox generator was abandoned
          // mid-yield (message already shift()ed for it, turn never
          // finished), put that message back on the queue — otherwise the
          // replacement session's stream() finds an empty queue and parks
          // forever, since the "delivered" message is gone for good.
          mailbox.reclaimInFlight();
          const message = err instanceof Error ? err.message : String(err);
          const isTurnLimit = /Reached maximum number of turns|error_max_turns/i.test(message);
          // Bounded like every other recovery: attempt counts every pass
          // through this loop, so a role that keeps surfacing max-turns
          // errors here (session.ts already swallows the normal ones)
          // falls through to crash handling instead of looping forever.
          if (isTurnLimit && !mailbox.isClosed && attempt < BACKOFFS_MS.length) {
            sessionOpts.resumeSessionId = undefined;
            mailbox.push(
              `${Mailbox.CONTINUE_PREFIX} You reached the turn limit on your task. Continue your in-progress work from where you left off; if finished, end your turn.`,
            );
            bus.emit({
              type: 'status',
              from: role.id,
              reason: 'turn-limit-recover',
              msg: `agent "${role.id}" hit turn limit error — continuing with fresh session`,
            });
            continue;
          }
          // Exit 143 = SIGTERM. If the mailbox is already closed, we
          // sent the signal ourselves during stop — not a crash.
          const killedByStop = mailbox.isClosed && /exit(?:ed)? with code 143/.test(message);
          // #251: the org's own stop/complete (finishStop) removes this run
          // from this.orgs, closes every mailbox and aborts every session —
          // an idle one then rejects with the abort ("Operation aborted",
          // "Claude Code process aborted by user"). That is a shutdown, not a
          // crash. A non-abort error surfacing during the stop, or a crash
          // already backing off when the stop landed, stays a crash.
          const abortedByStop =
            mailbox.isClosed &&
            daemon.orgs.get(name) !== running &&
            ((err as { name?: string } | null)?.name === 'AbortError' ||
              /\baborted\b/i.test(message));
          const crash = (): void => {
            if (killedByStop) {
              runtime.status = 'ended';
              bus.emit({
                type: 'status',
                from: role.id,
                msg: `agent "${role.id}" terminated by stop (was still working when drain window expired)`,
                reason: 'terminated-by-stop',
              });
              return;
            }
            if (abortedByStop) {
              runtime.status = 'ended';
              // #304: `message` here is always an abort string (see abortedByStop
              // above) — either "Operation aborted" or the SDK's "Claude Code
              // process aborted by user". Echoing it made a planned stop read as
              // a human interruption, and made roles of the same run read
              // differently. Report WHY the org stopped instead; the raw string
              // stays in `data` for debugging.
              const why = running.closedBy === 'org-complete' ? 'org_complete' : 'stop requested';
              bus.emit({
                type: 'status',
                from: role.id,
                msg: `agent "${role.id}" stopped with the org (${why})`,
                reason: 'agent-stopped',
                data: { agentId: role.id, error: message },
              });
              return;
            }
            runtime.status = 'crashed';
            runtime.error = message;
            // Close the mailbox so deliver()/receiveRemote() report a real
            // error instead of pushing into a queue no session will read
            // (and returning a false "delivered" receipt to the sender).
            mailbox.close();
            const isContextLimit = OrgDaemon.CONTEXT_LIMIT_RE.test(message);
            bus.emit({
              type: 'audit',
              from: role.id,
              msg: `agent "${role.id}" crashed: ${message}`,
              reason: isContextLimit ? 'agent-context-limit' : 'agent-session-crash',
              data: {
                agentId: role.id,
                error: message,
                restarts: attempt,
                contextLimit: isContextLimit,
              },
            });
            if (role.id !== running.bossRoleId) {
              // #2/#3: a worker is gone for the rest of this run. Without this
              // notice the coordinator keeps messaging a corpse (observed: four
              // unanswered org_send calls to a developer that had crashed on a
              // context-window limit). Tell the boss to reassign — and if the
              // crash was a context overflow, tell it to chunk smaller, since
              // re-dispatching the same task verbatim fails the same way.
              const bossRt = running.agents.get(running.bossRoleId);
              if (bossRt && !bossRt.mailbox.isClosed) {
                const guidance = isContextLimit
                  ? ' This was a context-window overflow — re-dispatching the same task verbatim will fail identically. Break the work into smaller pieces (one file or section at a time) and do not paste large file contents in a single message.'
                  : '';
                bossRt.mailbox.push(
                  `[system] Worker "${role.id}" crashed and will not recover this run (${message}). It can no longer receive messages — stop messaging it. Reassign its outstanding work to another agent or take it on yourself.${guidance}`,
                );
                bus.emit({
                  type: 'audit',
                  from: running.bossRoleId,
                  reason: 'worker-crashed',
                  msg: `worker "${role.id}" crashed (contextLimit=${isContextLimit}); coordinator notified to reassign`,
                });
              }
            } else {
              // #4: the coordinator itself died. Don't go silent and wait for a
              // human — attempt a bounded whole-org restart with fresh sessions
              // (which also sheds whatever bloated context caused the crash).
              daemon.scheduleBossRestart(name);
            }
          };
          // Fatal errors (provider auth/quota/billing — tagged with
          // err.fatal by the runner) can NEVER be fixed by a restart: the
          // same call fails identically or hangs. Skip the backoff loop
          // and go straight to terminal crash handling instead of burning
          // the retry budget and wall-clock on a guaranteed failure.
          const fatal = (err as { fatal?: boolean } | null)?.fatal === true;
          if (fatal) {
            bus.emit({
              type: 'status',
              from: role.id,
              reason: 'agent-fatal',
              msg: `agent "${role.id}" hit a fatal (non-retryable) error — not restarting`,
            });
            crash();
            return;
          }
          if (mailbox.isClosed || attempt >= BACKOFFS_MS.length) {
            crash();
            return;
          }
          bus.emit({
            type: 'status',
            from: role.id,
            reason: 'agent-restart',
            msg: `agent "${role.id}" crashed (${message}) — restarting in ${BACKOFFS_MS[attempt]}ms (attempt ${attempt + 1}/${BACKOFFS_MS.length})`,
          });
          await new Promise<void>((r) => {
            const t = setTimeout(r, BACKOFFS_MS[attempt]);
            (t as { unref?: () => void }).unref?.();
            // Org stop (finishStop) aborts every active slot's controller —
            // without racing it here, this wait wouldn't notice for up to
            // BACKOFFS_MS[attempt] (default up to 15s), well past finishStop's
            // own bounded drain window. That let this loop's crash() —
            // and the bus.emit() it triggers — fire AFTER finishStop had
            // already declared the org stopped and returned, capable of
            // recreating files in a run directory a caller was already
            // deleting.
            if (abort.signal.aborted) {
              clearTimeout(t);
              r();
              return;
            }
            abort.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                r();
              },
              { once: true },
            );
          });
          if (isStaleGeneration()) return; // superseded during the backoff wait
          if (mailbox.isClosed) {
            crash();
            return;
          } // org stopped during backoff — never recovered
          // #247: continue the crashed conversation (briefing, task context,
          // finished work) instead of starting cold. runAgentSession falls
          // back to one fresh session if this id can't be resumed.
          sessionOpts.resumeSessionId = runtime.sessionId;
        }
      }
    })();
  }
  return { runtime, abort };
}
