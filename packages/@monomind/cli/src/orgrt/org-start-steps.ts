// packages/@monomind/cli/src/orgrt/org-start-steps.ts
// Extracted from daemon.ts — the self-contained steps of startOrg: preflight
// (definition, run id, workspace, validation), per-role fences, and the
// broker registration + offline-inbox drain that ends it.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOrgDefBlueprints } from '../catalog/blueprints.js';
import { configureResourceLimits, getResourceLimits } from '../utils/resource-governor.js';
// ── Extracted module imports ────────────────────────────────────────────
import * as approvalOps from './approvals.js';
import { BrokerLease, normalizeCredential } from './broker.js';
import {
  isCheckpointExpired,
  migrateCheckpoint,
  type OrgCheckpoint,
  validateCheckpoint,
} from './checkpoint.js';
import * as crossOrg from './cross-org.js';
import type { OrgDaemon } from './daemon.js';
import { activeRoleCount, type RunningOrg } from './daemon-types.js';
import { RUNTIME_SENDER } from './documents/deliver.js';
import { assertEvalGate } from './documents/eval-gate.js';
import { type DocumentsRuntime, openDocumentsRuntime } from './documents/runtime.js';
import { bindSectionBudget } from './documents/section-budget-run.js';
import {
  agentRoles,
  isEndpointRole,
  retryQueuedEndpoints,
  startEndpointRetryLoop,
} from './endpoint-roles.js';
import {
  createFenceForRole,
  loadGlobalFenceConfig,
  mergeFenceConfigs,
  type RoleFence,
} from './fence.js';
import { drainInbox, newMessageId, queueMessage } from './inbox.js';
import { enforceConfinement } from './org-sign-review.js';
import { assertOrgDefSigned, instructionsDigests, pinInstructionDigests } from './org-signature.js';
import { firstLookAudit, plantNotifier, plantWatchFor } from './planted-paths.js';
import { expandOrgPolicyPathVars, promptVarsFor } from './prompt-vars.js';
import * as questionOps from './questions.js';
import { resolveRoleRunner } from './runner-resolve.js';
import { ORG_DIR, type OrgDef, OrgDefSchema } from './types.js';

/** Everything startOrgInner needs before it creates the bus: validates the
 *  definition and roster, picks (or resumes) the run, and prepares its cwd. */
export async function prepareOrgStart(
  daemon: OrgDaemon,
  name: string,
  options?: { resume?: boolean; autoApprove?: string[]; evalGate?: boolean },
): Promise<{
  def: OrgDef;
  run: string;
  checkpoint: OrgCheckpoint | undefined;
  dir: string;
  cwd: string;
  worktreePath: string | undefined;
  /** Section 7.3 advice for the bus; errors have already stopped the start. */
  checklistWarnings: string[];
  /** Org sections (plan P3.6): the run's documents runtime; undefined off the sections surface. */
  documents: DocumentsRuntime | undefined;
}> {
  // #301: the PRIMARY fix — the stop-side backstops below (finishStop,
  // process 'exit') can only run for a run that ends through code we
  // control; a SIGKILL leaves .git/worktrees/<name> metadata behind with
  // nothing left to clean it up, and so did every run that leaked before
  // this fix existed. Pruning here turns "did the last run clean up,
  // however it died?" into "a run always begins clean" — the only thing
  // that recovers both the SIGKILL case and worktrees already orphaned
  // before this daemon process started. Unconditional and best-effort for
  // the same reasons as the stop-side prune (see finishStop): it only
  // drops metadata whose worktree directory is already gone, so it cannot
  // touch a live worktree, including the owner's.
  try {
    execFileSync('git', ['worktree', 'prune'], {
      cwd: daemon.root,
      stdio: 'ignore',
      timeout: 30_000,
    });
  } catch {
    /* best-effort: not a git repo, git missing, or a wedged hook */
  }
  const defPath = join(daemon.root, ORG_DIR, `${name}.json`);
  const rawDef: unknown = JSON.parse(readFileSync(defPath, 'utf8'));
  // #502: every start path (org run, serve's runfile poll and schedule,
  // resume) comes through here — refuse a definition the operator has not
  // signed, checking the very bytes that get parsed below.
  const digests = instructionsDigests(rawDef, daemon.root);
  assertOrgDefSigned(daemon.root, name, rawDef, { digests });
  const parsedDef = OrgDefSchema.parse(rawDef);
  // #571: the blueprint bytes must still be the ones the signature covered.
  const bp = resolveOrgDefBlueprints(parsedDef, daemon.root, digests);
  // {{home}} / {{org_root}} in policy paths, before any root or sandbox sees them.
  const def = expandOrgPolicyPathVars(bp.def, promptVarsFor(daemon.root));
  pinInstructionDigests(def, digests);
  // Sections spec 9.2: a sections org starts only through the eval harness.
  assertEvalGate(def, name, options);
  // #502 review: the single enforcement point for unconfined roles (warn-only
  // until the operator decides whether to refuse them).
  enforceConfinement(def, name);
  // #502 review round 4: quarantine whatever a role planted, including
  // during a run that crashed or was killed, before anything starts.
  const notifier = () => ({
    bus: daemon.orgs.get(name)?.bus,
    askHuman: (r: string, q: string, b?: boolean) => daemon.askHuman(name, r, q, b),
    def,
  });
  const plantWatch = plantWatchFor(daemon.root, name, plantNotifier(name, notifier));
  plantWatch.onFirstLook = firstLookAudit(notifier);
  await plantWatch
    .check()
    .catch((err) => console.warn(`[orgrt] org ${name}: planted-path check failed: ${err}`));
  const autoApproveError = approvalOps.unknownAutoApproveError(
    options?.autoApprove ?? [],
    def.roles,
  );
  if (autoApproveError) throw new Error(autoApproveError);

  let run: string;
  let checkpoint: OrgCheckpoint | undefined;
  if (options?.resume) {
    const rtPath = join(daemon.root, ORG_DIR, name, 'runtime.json');
    if (!existsSync(rtPath)) throw new Error(`cannot resume org "${name}": runtime.json not found`);
    const rt = JSON.parse(readFileSync(rtPath, 'utf8'));
    if (!rt?.run || !rt?.checkpoint)
      throw new Error(`cannot resume org "${name}": no valid checkpoint found`);
    if (isCheckpointExpired(rt.checkpoint))
      throw new Error(`cannot resume org "${name}": checkpoint expired`);
    // Migrate an older-schema checkpoint (verifying ITS OWN stored checksum
    // first) before validating it against CHECKPOINT_VERSION — see
    // migrateCheckpoint's doc comment in checkpoint.ts.
    const migrated = migrateCheckpoint(rt.checkpoint);
    if (!migrated || !validateCheckpoint(migrated))
      throw new Error(`cannot resume org "${name}": checkpoint validation failed`);
    rt.checkpoint = migrated;
    run = rt.run;
    checkpoint = rt.checkpoint;
    if (rt.abandonedRoles) {
      daemon.abandoned.set(name, new Set(rt.abandonedRoles));
    }
  } else {
    daemon.abandoned.delete(name); // a previous run's missing roles say nothing about this one
    daemon.memoryErrors.delete(name); // nor does its memory-store failure (#293)
    approvalOps.clearApprovalsForFreshStart(daemon, name); // a previous run's approvals are moot for this one
    questionOps.clearQuestionsForFreshStart(daemon, name); // nor do its unanswered questions (#248)
    // random suffix: second-precision stamps collide across processes (two CLI
    // invocations in the same second would share a run dir and its bus.jsonl)
    run = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const dir = join(daemon.root, ORG_DIR, name, run);
  mkdirSync(dir, { recursive: true });
  // Role sessions run at the project root by default. They used to run in an
  // empty scratch dir under .monomind/orgs/<name>/workspace, which the policy
  // engine's workdir check ("path escapes org workdir") then confined every
  // path to — so a development org could not Read or Edit a single file of
  // the project it was created to work on. Roles fell back to Bash, which is
  // not path-scoped, meaning the sandbox blocked the safe tools and let the
  // unrestricted one through. Opt back in with run_config.workspace:
  // 'isolated', or pin an absolute path.
  const ws = daemon.workspaceSetting(def);
  let cwd: string;
  let worktreePath: string | undefined;
  if (ws === 'worktree') {
    worktreePath = join(daemon.root, ORG_DIR, name, 'worktree');
    const { execFileSync } = await import('node:child_process');
    try {
      // Remove stale worktree from a previous run
      if (existsSync(worktreePath)) {
        // R4: bound the call — a wedged git hook (git-lfs, gc lock, gpg sign
        // prompt) would otherwise hang the whole daemon indefinitely.
        // SEC-5: execFileSync + argv — no shell interpolation of worktreePath.
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: daemon.root,
          stdio: 'ignore',
          timeout: 30_000,
        });
      }
    } catch {
      /* best-effort cleanup */
    }
    execFileSync('git', ['worktree', 'add', worktreePath, 'HEAD', '--detach'], {
      cwd: daemon.root,
      stdio: 'ignore',
      timeout: 30_000,
    });
    cwd = worktreePath;
  } else {
    cwd =
      ws === 'repo'
        ? daemon.root
        : ws === 'isolated'
          ? join(daemon.root, ORG_DIR, name, 'workspace')
          : ws;
  }
  mkdirSync(cwd, { recursive: true });

  // An org must be able to seat its whole roster. maxSdkProcesses is sized for
  // the machine (cpus - 2), so any org with more roles than that had its tail
  // roles deferred forever — a 7-role org on an 8-core box permanently lost
  // its 7th, and the work that role owned simply never happened. Raise the
  // ceiling to the role count. An explicit MONOMIND_MAX_SDK_PROCS still wins:
  // if the operator named a number, that number is the answer.
  //
  // Runner process model (relevant for sizing): ClaudeAgentRunner and
  // VercelAgentRunner are in-process (no subprocess per role). KimiCodeAgentRunner,
  // OpencodeAgentRunner, and CodexAgentRunner each spawn one subprocess per role.
  // The current sizing (def.roles.length) is therefore safe — it over-provisions
  // for in-process runners but never under-provisions for subprocess runners.
  const sessionRoleCount = agentRoles(def.roles).length;
  if (
    !process.env.MONOMIND_MAX_SDK_PROCS &&
    getResourceLimits().maxSdkProcesses < sessionRoleCount
  ) {
    configureResourceLimits({ maxSdkProcesses: sessionRoleCount });
  }

  // ADR-O001 D8: a cost tier that can't resolve a model for a role's
  // provider must stop the run here. The alternative — resolving it at
  // session start — would either crash one role ten minutes in or, worse,
  // quietly leave that role on a different model than the tier claimed.
  const { validateCostTiers } = await import('./cost-tier.js');
  const tierErrors = validateCostTiers(def);
  if (tierErrors.length) {
    throw new Error(`org ${name}: ${tierErrors.join('; ')}`);
  }
  // ADR-O001 D7: an oversized or unresolvable loadout catalog stops the run
  // here, for the same reason — not ten minutes in, at some role's spawn.
  const { validateLoadouts } = await import('./loadouts.js');
  const loadoutErrors = validateLoadouts(def, daemon.root).errors;
  if (loadoutErrors.length) {
    throw new Error(`org ${name}: ${loadoutErrors.join('; ')}`);
  }
  const { validateRoleSkills } = await import('./skill-library.js');
  const skillErrors = [
    ...bp.errors,
    ...def.roles.flatMap((r) => validateRoleSkills(r, daemon.root)),
  ];
  if (skillErrors.length) {
    throw new Error(`org ${name}: ${skillErrors.join('; ')}`);
  }
  // Org sections spec 7.3: the same checklist `org validate` runs. Errors
  // stop the start; advice is recorded on the bus below.
  const { checklistFindings } = await import('./validate-checklist.js');
  const checklist = checklistFindings(def);
  if (checklist.errors.length) {
    throw new Error(`org ${name}: ${checklist.errors.join('; ')}`);
  }

  // Validate per-role providers before spawning anything (fail-fast: a
  // missing env var discovered 10 minutes into a run wastes the entire run).
  const { resolveProviderEnv: validateProvider, resolveRoleProvider } = await import(
    './provider.js'
  );
  for (const role of def.roles) {
    try {
      if (role.provider) {
        validateProvider(role.provider);
      } else if (role.adapter_config?.provider) {
        // Named provider (`monomind providers configure`): resolve now so a
        // missing/misconfigured entry fails the run at start, not mid-flight.
        resolveRoleProvider(role, daemon.root);
      }
    } catch (err) {
      throw new Error(
        `org ${name}: role "${role.id}" provider validation failed — ${err instanceof Error ? err.message : err}`,
      );
    }
    // provider.kind 'gemini'/'openai' only sets env vars (GEMINI_API_KEY /
    // OPENAI_API_KEY — see provider.ts) for a CLI that never reads them:
    // autoRuntimeFromProvider has no case for either kind, so
    // resolveRoleRunner falls through to `undefined` and session.ts spawns
    // the default ClaudeAgentRunner. The role silently runs on Claude while
    // its config claims gemini/openai — surface that loudly at start time
    // instead of leaving it to be discovered mid-run.
    const kind = role.provider?.kind;
    if (
      (kind === 'gemini' || kind === 'openai') &&
      !resolveRoleRunner(role.runtime, def.runtime, kind, undefined, role.provider)
    ) {
      console.error(
        `org ${name}: role "${role.id}" sets provider.kind="${kind}" but no runtime honors it — ` +
          `this role will actually run on the Claude Agent SDK, not ${kind}. ` +
          `Set role.runtime (or the org's runtime) explicitly, or use provider.kind="vercel-api-key" ` +
          `with vendor="${kind === 'gemini' ? 'google' : 'openai'}" to route through a real ${kind} model.`,
      );
    }
  }
  // Org sections (plan P3.6): opened last, so a start that fails above leaves no docs directory behind.
  const documents = openDocumentsRuntime({ def, orgDir: join(daemon.root, ORG_DIR, name), run });
  return {
    def,
    run,
    checkpoint,
    dir,
    cwd,
    worktreePath,
    checklistWarnings: checklist.warnings,
    documents,
  };
}

export async function createRoleFences(
  daemon: OrgDaemon,
  def: OrgDef,
): Promise<Map<string, RoleFence>> {
  // ── MonoFence guardrail: pre-create per-role instances ────────────────
  const globalFence = loadGlobalFenceConfig(daemon.root);
  const orgFence = (def as Record<string, unknown>).fence as Record<string, unknown> | undefined;
  const roleFences = new Map<string, RoleFence>();
  for (const role of def.roles) {
    const roleFenceCfg = (role.policy as Record<string, unknown> | undefined)?.fence as
      | Record<string, unknown>
      | undefined;
    const merged = mergeFenceConfigs(
      globalFence ?? undefined,
      orgFence as any,
      roleFenceCfg as any,
    );
    if (merged.enabled === false) continue;
    if (!globalFence && !orgFence && !roleFenceCfg) continue;
    try {
      const instance = await createFenceForRole(merged);
      if (instance) {
        roleFences.set(role.id, {
          instance,
          abortThreshold: typeof merged.abortThreshold === 'number' ? merged.abortThreshold : 0.8,
          scanMessages: merged.scanMessages !== false,
        });
      }
    } catch {
      /* monofence-ai not installed — skip silently */
    }
  }
  return roleFences;
}

export async function startInboxAndDrain(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
): Promise<void> {
  const { def, bus } = running;
  if (daemon.opts.crossProcess && daemon.opts.inboxUrl) {
    const operatorCred = normalizeCredential(daemon.opts.operatorCredential);
    const lease = new BrokerLease(
      name,
      daemon.opts.inboxUrl,
      daemon.opts.brokerDir,
      undefined,
      running.credential,
      operatorCred ? { credential: operatorCred, dir: daemon.opts.operatorDir } : undefined,
      daemon.root,
    );
    lease.start();
    daemon.leases.set(name, lease);
  }

  // Drain any messages that arrived while the org was offline
  const queued = drainInbox(daemon.root, name);
  // M2: messages for endpoint roles are delivered by POST, not into a mailbox —
  // put them back (flagged) and let the endpoint retry path send them.
  const endpointQueued = new Set<string>();
  for (const msg of queued) {
    if (!isEndpointRole(def.roles.find((r) => r.id === msg.toRole))) continue;
    const messageId = msg.messageId ?? newMessageId();
    endpointQueued.add(messageId);
    queueMessage(daemon.root, name, { ...msg, messageId, endpoint: true });
  }
  startEndpointRetryLoop(daemon, name);
  if (endpointQueued.size > 0)
    void retryQueuedEndpoints(daemon, name, (m) => endpointQueued.has(m.messageId ?? '')).catch(
      () => {
        /* stays queued — the periodic sweep retries */
      },
    );
  for (const msg of queued) {
    if (isEndpointRole(def.roles.find((r) => r.id === msg.toRole))) continue;
    // Spawn a lazy target before delivering. These messages were queued while
    // the org was offline — a human's answer, or another org's request — and
    // the whole point of draining is that they arrive. Skipping a role merely
    // because it has not spawned yet discarded them permanently, after
    // queueMessage had already reported them accepted.
    if (!running.agents.has(msg.toRole) && running.pendingRoles?.has(msg.toRole)) {
      const pending = running.pendingRoles.get(msg.toRole)!;
      // Bug 4: don't spawn past run_config.max_concurrent_agents. Requeue
      // this message (queueMessage, not a silent drop) and defer the spawn
      // the same way a concurrency-gated lazy spawn defers elsewhere.
      const concurrencyLimit = def.run_config.max_concurrent_agents;
      if (concurrencyLimit != null && activeRoleCount(running) >= concurrencyLimit) {
        running.pendingRoles.delete(msg.toRole);
        queueMessage(daemon.root, name, msg);
        daemon.scheduleConcurrencyDeferredSpawn(name, running, pending, running.spawnRole!);
      } else {
        running.pendingRoles.delete(msg.toRole);
        running.spawnRole?.(pending);
      }
    }
    const agent = running.agents.get(msg.toRole);
    if (agent && !agent.mailbox.isClosed) {
      bus.emit({
        type: 'xorg',
        from: msg.fromQualified,
        to: `${name}:${msg.toRole}`,
        subject: msg.subject,
        msg: msg.body,
        data: { messageId: msg.messageId ?? newMessageId() },
      });
      await crossOrg.pushMessage(
        daemon,
        name,
        running,
        msg.toRole,
        msg.fromQualified,
        msg.subject,
        msg.body,
        `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`,
      );
    }
  }
  if (queued.length)
    bus.emit({ type: 'status', msg: `drained ${queued.length} queued message(s) from inbox` });
}

/** Org sections (plan P3.8): attach the document runtime's notice engine to this org's real deliver path. It
 *  sends the publication notices, and on a resume re-sends what was never delivered or never acted on. An org
 *  without the sections surface has no documents runtime, so nothing happens. */
export function startDocumentNotices(daemon: OrgDaemon, name: string, running: RunningOrg): void {
  running.documents?.notices?.start({
    deliver: (to, subject, body) => daemon.deliver(name, RUNTIME_SENDER, to, subject, body),
    queued: (to, subject) =>
      !!running.agents
        .get(to)
        ?.mailbox.serialize()
        .queue.some((m) => m.includes(`subject: ${subject}\n`)),
    emit: (e) => running.bus.emit({ type: 'audit', from: RUNTIME_SENDER, ...e }),
  });
  bindSectionBudget(daemon, name, running); // P4.6: section budget notices and soft closure
}
