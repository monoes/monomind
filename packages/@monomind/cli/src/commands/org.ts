// packages/@monomind/cli/src/commands/org.ts
import { readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { OrgDaemon } from '../orgrt/daemon.js';
import { resolveModel } from '../orgrt/session.js';
import { startOrgServer } from '../orgrt/server.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import { migrateOrgFile } from '../orgrt/migrate.js';
import { readHistory, readRunEvents, summarizeRun } from '../orgrt/reporting.js';
import { MODEL_PRICING } from '../pricing/model-pricing.js';

const log = (text: string): void => { console.log(text); };

/** Org names are used to build filesystem paths under .monomind/orgs — reject
 * anything that isn't a plain identifier to prevent path traversal (e.g.
 * `monomind org stop '../../../../tmp/x'`). */
const ORG_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function validateOrgName(name: string | undefined): { ok: true; name: string } | { ok: false; result: CommandResult } {
  if (!name) return { ok: false, result: { success: false, message: 'org name required' } };
  if (!ORG_NAME_RE.test(name)) {
    log(output.error(`Invalid org name: ${name}`));
    return { ok: false, result: { success: false, message: 'invalid org name' } };
  }
  return { ok: true, name };
}

/** Suffixes of org-internal artifact files (state/goals/threads/etc) that
 * share the `<org>.json`/`.jsonl` naming pattern with the org's own config
 * file. Single source of truth for both listOrgConfigFiles() (which must
 * exclude them when discovering real org configs) and deleteAction (which
 * must remove all of them when deleting an org). */
const ORG_ARTIFACT_SUFFIXES = [
  '-state', '-goals', '-threads', '-activity', '-approvals', '-members', '-secrets', '-budgets',
  '-routines', '-issues', '-projects', '-workspaces', '-worktrees', '-environments',
  '-plugins', '-adapters', '-join-requests', '-bootstrap', '-project-workspaces',
  '-approval-comments', '-skills',
];
export function listOrgConfigFiles(orgsDir: string): string[] {
  // endsWith, not includes: substring matching hid legitimate orgs whose NAME
  // merely contains an artifact suffix anywhere (e.g. "state-machine.json",
  // "issues-triage.json") — and anything hidden here is also invisible to
  // run/list/serve while `org delete <sibling>` would still remove its files.
  return readdirSync(orgsDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('._') && !f.endsWith('.v1.json')
      && !ORG_ARTIFACT_SUFFIXES.some(suf => f.endsWith(`${suf}.json`)));
}

/** Remove a lingering stopfile so a fresh `org run` doesn't self-terminate. */
export const clearStopfile = (cwd: string, name: string): void => {
  rmSync(join(cwd, ORG_DIR, name, 'stop'), { force: true });
};

/** True when a pause sentinel exists for an org. */
export const isOrgPaused = (cwd: string, name: string): boolean =>
  existsSync(join(cwd, ORG_DIR, name, 'pause'));

const clearPausefile = (cwd: string, name: string): void => {
  rmSync(join(cwd, ORG_DIR, name, 'pause'), { force: true });
};

/** PID of a live `org serve` daemon for this project, or null.
 *
 *  The heartbeat file is written every 30s and removed on clean exit, but a
 *  SIGKILLed daemon leaves it behind — so liveness is confirmed against the pid
 *  itself, not the file's presence. A stale heartbeat must not make `org run`
 *  post a runfile nobody will ever read. */
function liveServeDaemonPid(cwd: string): number | null {
  try {
    const hb = JSON.parse(readFileSync(join(cwd, '.monomind', 'serve-heartbeat.json'), 'utf8')) as { pid?: number; updatedAt?: string };
    if (typeof hb.pid !== 'number' || hb.pid === process.pid) return null;
    // Freshness as well as liveness. The daemon beats every 30s, so a stamp
    // older than a few beats means it is gone or wedged — and a pid alone can
    // be recycled onto an unrelated process, which would send the runfile to
    // something that will never read it.
    const age = Date.now() - Date.parse(hb.updatedAt ?? '');
    if (!Number.isFinite(age) || age > 3 * 60_000) return null;
    process.kill(hb.pid, 0); // throws if the process is gone
    return hb.pid;
  } catch { return null; }
}

const runAction = async (ctx: CommandContext): Promise<CommandResult> => {
  if (!ctx.args[0]) return { success: false, message: 'org name required: monomind org run <name> [--task "..."]' };
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  // A repeated --task flag is promoted to an array by the parser (deliberate,
  // documented behavior elsewhere — repeats never silently drop a value); a
  // plain `as string` cast would let that array flow straight into the org's
  // goal and get stringified as "a,b" with no warning. Checked before any
  // side effects (starting the xdeliver listener) run.
  const taskFlag = ctx.flags['task'];
  if (Array.isArray(taskFlag)) return { success: false, message: '--task was passed more than once — pass it exactly once' };
  // Fail before any side effects (inbox server) when the org doesn't exist.
  const orgsDir = join(ctx.cwd, ORG_DIR);
  if (!existsSync(join(orgsDir, `${name}.json`))) {
    const known = existsSync(orgsDir) ? listOrgConfigFiles(orgsDir).map(f => f.replace(/\.json$/, '')) : [];
    log(output.error(`Org not found: ${name}${known.length ? ` — available: ${known.join(', ')}` : ' — create one with /mastermind:createorg'}`));
    return { success: false, message: 'org not found' };
  }
  if (ctx.flags['dryRun'] === true) {
    // Validate + preview each role's actual briefing without spawning sessions.
    try {
      const def = OrgDefSchema.parse(JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')));
      const { buildRolePrompt } = await import('../orgrt/session.js');
      const roster = def.roles.map(r => r.id);
      const perRole = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
      // Same KG entity glossary the live daemon injects — the preview must
      // match what sessions actually receive.
      const glossary = await (async () => {
        try {
          const kg = await import('../memory/memory-kg.js');
          return await kg.kgGlossary({ dbPath: join(process.cwd(), '.monomind', 'org-memory') });
        } catch { return []; }
      })();
      log(output.info(`DRY RUN — org ${name}: ${def.roles.length} roles, ${perRole} tokens each, goal: ${taskFlag ?? def.goal}`));
      for (const role of def.roles) {
        log(output.info(`\n─── ${role.id} (${role.title || role.type})${role.adapter_config?.model ? ` [${role.adapter_config.model}]` : ''} ───`));
        log(buildRolePrompt(role, { name: def.name, goal: (taskFlag as string | undefined) ?? def.goal }, roster, glossary));
      }
      return { success: true, message: 'dry run complete — no sessions started' };
    } catch (err) {
      log(output.error(`Config invalid: ${err instanceof Error ? err.message : String(err)}`));
      return { success: false, message: 'invalid org config' };
    }
  }
  // A live `org serve` daemon already owns this project's orgs. Starting our
  // own here would put two processes on one runtime.json and one broker lease,
  // so hand the request to the daemon via its runfile instead of racing it.
  const serveOwner = liveServeDaemonPid(ctx.cwd);
  if (serveOwner != null) {
    mkdirSync(join(orgsDir, name), { recursive: true });
    // The task rides along in the runfile. Dropping it here would have made
    // `org run <name> --task "..."` silently start a generic cycle — the flag
    // accepted, the instruction discarded.
    const runfile = join(orgsDir, name, 'run');
    writeFileSync(runfile, JSON.stringify({ ts: Date.now(), task: taskFlag ?? null }), 'utf8');
    // Ack: the serve daemon's runfile poll consumes (deletes) the file within
    // one tick (~2s). The liveness check above is racy — a pid can die or be
    // recycled between the check and the poll, leaving a runfile nobody reads
    // while we report success. Verify consumption; on timeout, retract the
    // runfile and fail loudly instead of losing the run.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && existsSync(runfile)) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (existsSync(runfile)) {
      rmSync(runfile, { force: true });
      log(output.error(`org ${name}: serve daemon (pid ${serveOwner}) did not pick up the run within 15s — it is dead or wedged.`));
      log(output.info(`Remove the stale heartbeat (.monomind/serve-heartbeat.json) and retry, or start a fresh daemon with: monomind org serve`));
      return { success: false, message: 'serve daemon did not acknowledge the run request' };
    }
    log(output.info(`org ${name}: start requested from the serve daemon (pid ${serveOwner}) — acknowledged`));
    log(output.dim(`  watch it with: monomind org logs ${name} --follow`));
    return { success: true, message: 'start requested' };
  }

  const crossProcess = ctx.flags['crossProcess'] !== false;

  // P1-1: v1 deprecation warning. Detect v1-shaped configs and warn.
  // Gate on MONOMIND_V1_LEGACY=off to refuse v1 orgs entirely (patch-versioning-
  // compliant mechanism — no minor bump needed).
  const V1_ORG_KEYS = ['topology', 'consensus', 'strategy', 'board_id', 'todo_col_id', 'doing_col_id', 'done_col_id', 'loop'];
  try {
    const rawCfg = JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')) as Record<string, unknown>;
    const isV1 = V1_ORG_KEYS.some(k => k in rawCfg);
    if (isV1) {
      const v1Legacy = process.env.MONOMIND_V1_LEGACY;
      if (v1Legacy === 'off') {
        log(output.error(`Org "${name}" uses the v1 config format, but MONOMIND_V1_LEGACY=off.`));
        log(output.info(`Run "monomind org migrate ${name}" to upgrade to v2, or unset MONOMIND_V1_LEGACY to proceed anyway.`));
        return { success: false, message: 'v1 org blocked by MONOMIND_V1_LEGACY=off' };
      }
      log(output.warning(`Org "${name}" uses the v1 config format (deprecated). It will be auto-migrated in-memory.`));
      log(output.dim(`  To silence: run "monomind org migrate ${name}". To block v1 orgs: set MONOMIND_V1_LEGACY=off.`));
    }
  } catch { /* config parse errors surface below in cost estimate or daemon.startOrg */ }

  // P0-17: Upfront cost estimate. `org run` and `/mastermind:autodev` spend real
  // provider tokens. Print an estimate before sessions start; honor --budget-usd
  // as a hard stop and --yes to skip the confirmation prompt. Rates are defaults
  // (per 1M tokens, blended estimate, Aug 2026); override via the model id.
  //
  // No provider Usage API is queried (that needs Admin/Org API credentials most
  // users won't have configured) — rates are derived from the canonical
  // MODEL_PRICING table (src/pricing/model-pricing.ts), using each model's
  // output-token price as the blended per-1M estimate (output tokens dominate
  // role-turn cost). Models not yet tracked in that table (third-party/non-
  // Anthropic providers) fall back to the manually maintained EXTRA table
  // below. A user-editable ~/.monomind/rates.json override, when present,
  // takes precedence over both. Either way this is static data, not a live
  // query, so a "stale rates" warning is always shown to make that
  // limitation visible rather than implying live pricing.
  const DERIVED_RATE_PER_1M: Record<string, number> = Object.fromEntries(
    Object.entries(MODEL_PRICING).map(([model, price]) => [model, price.out * 1_000_000]),
  );
  // Models absent from MODEL_PRICING (not yet in the canonical pricing table).
  const EXTRA_MODEL_RATE_PER_1M: Record<string, number> = {
    'gpt-4': 10,
    'glm-5.2': 2, 'glm-4': 2,
    'kimi-latest': 3, 'kimi-k2': 3, 'kimi-code/k3': 3, 'kimi-code/k3-256k': 3,
    'gemini-3.1-pro': 8, 'gemini-3.6-flash-high': 1,
    'gpt-5.6-terra': 10, 'gpt-5.5': 10,
  };
  const MODEL_RATE_PER_1M: Record<string, number> = { ...EXTRA_MODEL_RATE_PER_1M, ...DERIVED_RATE_PER_1M };
  const DEFAULT_RATE_PER_1M = 10;
  const AVG_TOKENS_PER_TURN = 2000;
  const budgetUsd = ctx.flags['budgetUsd'] as number | undefined;
  const skipConfirm = ctx.flags['yes'] === true;

  // User-editable rate overrides: ~/.monomind/rates.json, e.g.
  //   { "claude-opus-5": 90, "my-custom-model": 5 }
  const ratesPath = join(homedir(), '.monomind', 'rates.json');
  let userRates: Record<string, number> = {};
  let ratesFileUsed = false;
  try {
    const parsed = JSON.parse(readFileSync(ratesPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number') userRates[k] = v;
      }
      ratesFileUsed = Object.keys(userRates).length > 0;
    }
  } catch { /* no rates.json (or invalid) — hardcoded defaults only */ }

  try {
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')));
    const defaultMaxTurns = def.run_config.max_turns_per_message ?? 30;
    // Estimate against a realistic planning ceiling, NOT the runtime limit —
    // the schema default is effectively unlimited (DEFAULT_MAX_TURNS_PER_MESSAGE),
    // which would balloon the upfront figure into meaninglessness.
    const ESTIMATE_TURNS_CAP = 30;
    let totalTokens = 0;
    const perRoleRows = def.roles.map((r) => {
      // Mirror the actual runtime's model resolution (session.ts resolveModel)
      // instead of a hardcoded 'claude-sonnet-5' fallback — otherwise every
      // role without an explicit adapter_config.model (kimicode, antigravity,
      // vercel roles relying on their runtime default) is mislabeled here.
      const model = String(r.adapter_config?.model ?? resolveModel(r, r.runtime ?? def.runtime, r.provider?.vendor));
      const rate = userRates[model] ?? MODEL_RATE_PER_1M[model] ?? DEFAULT_RATE_PER_1M;
      const roleTurns = Math.min(r.max_turns_per_message ?? defaultMaxTurns, ESTIMATE_TURNS_CAP);
      const tokens = roleTurns * AVG_TOKENS_PER_TURN;
      totalTokens += tokens;
      return { id: r.id, model, tokens, cost: (tokens * rate) / 1_000_000 };
    });
    const estimate = perRoleRows.reduce((s, r) => s + r.cost, 0);
    log(output.bold('\nCost estimate'));
    log(output.dim(`  (roles × max_turns × ~${AVG_TOKENS_PER_TURN} tokens/turn × model rate; estimated at ≤${ESTIMATE_TURNS_CAP} turns/message — the runtime default is effectively unlimited; ${ratesFileUsed ? `rates.json overrides + ` : ''}static defaults, will vary with real usage)`));
    log(output.warning(`  ⚠ stale rates: no live provider pricing lookup — ${ratesFileUsed ? `using ~/.monomind/rates.json + ` : ''}hardcoded table (edit ~/.monomind/rates.json to override)`));
    for (const r of perRoleRows) {
      log(`    ${r.id.padEnd(20)} ${r.model.padEnd(22)} ~$${r.cost.toFixed(2)}`);
    }
    log(`  ${output.bold('Total estimate:'.padEnd(28))} ~$${estimate.toFixed(2)}`);
    if (budgetUsd != null && estimate > budgetUsd) {
      log(output.error(`Estimate $${estimate.toFixed(2)} exceeds --budget-usd $${budgetUsd}. Aborting before any tokens are spent.`));
      return { success: false, message: 'cost estimate exceeded --budget-usd' };
    }
    if (!skipConfirm && process.stdin.isTTY) {
      const { confirm } = await import('../prompt.js');
      const ok = await confirm({ message: `Start ${def.roles.length}-role org? This will spend real provider tokens.`, default: true });
      if (!ok) {
        log(output.dim('Aborted — no tokens spent.'));
        return { success: false, message: 'user declined cost-estimate prompt' };
      }
    }
  } catch (err) {
    // If the config can't be parsed here, daemon.startOrg below will surface a
    // proper error. Don't double-report — just skip the estimate.
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
      log(output.dim(`(cost estimate skipped: ${err instanceof Error ? err.message : String(err)})`));
    }
  }

  const resumeFlag = ctx.flags['resume'] === true;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.credential);
  }
  let running: Awaited<ReturnType<typeof daemon.startOrg>>;
  try {
    running = await daemon.startOrg(name, taskFlag as string | undefined, { resume: resumeFlag });
  } catch (err) {
    // Don't leave the inbox server holding the event loop open on a failed start.
    srv?.close();
    await daemon.stopAll().catch(() => { /* nothing started */ });
    const detail = err instanceof Error ? err.message : String(err);
    const hint = err instanceof Error && err.name === 'ZodError'
      ? ` — run "monomind org validate ${name}" for details` : '';
    log(output.error(`Could not start org ${name}: ${detail}${hint}`));
    return { success: false, message: 'org start failed' };
  }
  log(output.info(`org ${name} running (${running.def.roles.length} agents, run ${running.run}) — Ctrl-C or "monomind org stop ${name}" to stop`));

  // P1-12: Print the dashboard URL so CLI users know where to look.
  // The dashboard is normally spawned by a Claude Code SessionStart hook
  // (.claude/helpers/control-start.cjs) — but `org run` doesn't require
  // Claude Code, and even when the hook exists it only fires once at
  // session start, not per org run. If control.json is stale (points at a
  // dead pid, a server rooted in a different project, or one that no longer
  // accepts our dashboard-token — the exact case control-start.cjs's own
  // "already running" check now self-heals, see its staleAuth handling),
  // `org run` used to just print whatever URL was on file with zero
  // verification. Actively (re)run the same control-start.cjs the hook
  // uses, from this project's own .claude/helpers/ if it's been set up
  // (monomind init), so a stale/dead/mismatched dashboard gets healed on
  // every org run instead of silently trusting old state.
  const controlPath = join(ctx.cwd, '.monomind', 'control.json');
  const controlStartPath = join(ctx.cwd, '.claude', 'helpers', 'control-start.cjs');
  if (existsSync(controlStartPath)) {
    try {
      const { spawnSync } = await import('node:child_process');
      spawnSync(process.execPath, [controlStartPath], {
        cwd: ctx.cwd,
        env: { ...process.env, CLAUDE_PROJECT_DIR: ctx.cwd, MONOMIND_HOOK_QUIET: '1' },
        timeout: 5000,
        stdio: 'ignore',
      });
    } catch { /* best-effort — fall through to whatever control.json already has */ }
  }
  if (existsSync(controlPath)) {
    try {
      const ctl = JSON.parse(readFileSync(controlPath, 'utf8')) as { port?: number; url?: string };
      const dashUrl = ctl.url || (ctl.port ? `http://localhost:${ctl.port}` : 'http://localhost:4242');
      log(output.dim(`  Dashboard: ${dashUrl}`));
    } catch { /* non-critical */ }
  } else if (existsSync(controlStartPath)) {
    // control-start.cjs ran above (spawnSync'd synchronously with a 5s cap)
    // but control.json still doesn't exist — its own confirm-mode child is
    // still working in the background (npx cold-resolve etc., #142/#144)
    // rather than having failed outright. Point at the default port; the
    // confirm process will correct control.json once it lands.
    log(output.dim('  Dashboard: http://localhost:4242 (starting — check back in a few seconds if unreachable)'));
  } else {
    log(output.dim('  Dashboard: run `monomind init` to set up .claude/helpers/, then re-run to launch it automatically'));
  }

  // stopfile poll lets `org stop` work from another terminal; the daemon can
  // also stop the org itself (boss called org_complete, or the idle watchdog
  // fired) — detect that via getOrg() so the CLI exits instead of polling a
  // stopfile forever after a finished run. Clear any stale stopfile from a
  // previous run before polling.
  clearStopfile(ctx.cwd, name);
  const stopfile = join(ctx.cwd, ORG_DIR, name, 'stop');
  // #206: a human explicitly running `monomind org stop` is a deliberate,
  // successful action regardless of how the run itself ended — capture that
  // BEFORE clearStopfile() below wipes the file, so it isn't lost.
  let stoppedManually = false;
  await new Promise<void>(resolvePromise => {
    const iv = setInterval(() => {
      if (existsSync(stopfile)) { stoppedManually = true; clearInterval(iv); resolvePromise(); }
      else if (!daemon.getOrg(name)) { clearInterval(iv); resolvePromise(); }
    }, 2000);
    process.once('SIGINT', () => { clearInterval(iv); resolvePromise(); });
    process.once('SIGTERM', () => { clearInterval(iv); resolvePromise(); });
  });
  clearStopfile(ctx.cwd, name);
  await daemon.stopAll();
  srv?.close();

  if (stoppedManually) return { success: true, message: `org ${name} stopped` };

  // #206: 'org run' used to exit 0 unconditionally here — a crashed or
  // watchdog-stopped run was indistinguishable from a completed one to any
  // script or supervisor (launchd/systemd) driving off the exit code. Re-read
  // the daemon's final record (same runtime.json pattern isOrgRunning/
  // statusAction already use below) and only report success for a run that
  // actually finished its goal via org_complete.
  let final: RunTerminalState = {};
  try {
    final = JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, name, 'runtime.json'), 'utf8'));
  } catch { /* best-effort — falls through to the non-clean-stop case below */ }

  return runOutcomeResult(name, final);
};

/** Just the fields determineRunOutcome needs from runtime.json. */
type RunTerminalState = { status?: string; closedBy?: string; error?: string };

/** Decides `org run`'s exit-code-bearing CommandResult from the run's final
 *  recorded state. Extracted (matching resolvedIdleNudgeCount's precedent for
 *  the idle watchdog) so this decision is unit-testable without spinning up a
 *  real daemon/org. Exit 0 ONLY for a clean, goal-driven end (closedBy:
 *  'org-complete', set by daemon.ts's org-complete auto-stop path) — every
 *  other outcome (idle-watchdog stop, boss-restart-exhausted, a process-level
 *  crash) exits 1 so scripts/supervisors can tell success from failure. */
export function runOutcomeResult(name: string, final: RunTerminalState): CommandResult {
  if (final.closedBy === 'org-complete') {
    return { success: true, message: `org ${name} completed` };
  }
  if (final.status === 'crashed') {
    return { success: false, message: `org ${name} crashed: ${final.error ?? 'unknown error'}`, exitCode: 1 };
  }
  return {
    success: false,
    message: `org ${name} stopped without completing (not via org_complete) — check 'monomind org status ${name}' or the run history for the reason`,
    exitCode: 1,
  };
}

/** True when runtime.json records a running org whose recorded pid is still alive. */
const isOrgRunning = (cwd: string, name: string): boolean => {
  try {
    const rt = JSON.parse(readFileSync(join(cwd, ORG_DIR, name, 'runtime.json'), 'utf8')) as
      { status?: string; pid?: number };
    if (rt.status !== 'running' || !rt.pid) return false;
    process.kill(rt.pid, 0); // throws if the pid is gone (crashed daemon left a stale file)
    return true;
  } catch {
    return false;
  }
};

const stopAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  if (!existsSync(join(ctx.cwd, ORG_DIR, `${name}.json`))) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
  // The stopfile is only meaningful to a process that polls it (`org run` and, since
  // this fix, `org serve`). Writing it for an org that nothing is running was a silent
  // no-op that still reported "daemon exits within 2s" — say what's actually true.
  let rt: { status?: string; run?: string; pid?: number } | undefined;
  try { rt = JSON.parse(readFileSync(join(ctx.cwd, ORG_DIR, name, 'runtime.json'), 'utf8')); } catch { /* never run */ }
  if (rt?.status !== 'running') {
    log(output.warning(`Org "${name}" is not running (runtime state: ${rt?.status ?? 'never run'}) — nothing to stop.`));
    return { success: false, message: 'org not running' };
  }
  if (rt.pid) {
    let alive = true;
    try { process.kill(rt.pid, 0); } catch { alive = false; }
    if (!alive) {
      log(output.warning(`Org "${name}" is not running — runtime.json says running but pid ${rt.pid} is gone (crashed daemon).`));
      log(output.info(`Clear the stale record with: monomind org mark-complete ${name}`));
      return { success: false, message: 'org crashed — use mark-complete' };
    }
  }
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'stop'), new Date().toISOString());
  log(output.info(`Stop requested for "${name}" (pid ${rt.pid}) — the daemon picks it up within ~2s.`));
  return { success: true, message: `stop requested for ${name} (daemon exits within 2s)` };
};

const pauseAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  if (!existsSync(join(ctx.cwd, ORG_DIR, `${name}.json`))) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
  if (isOrgPaused(ctx.cwd, name)) {
    log(output.warning(`Org "${name}" is already paused.`));
    return { success: true, message: 'already paused' };
  }
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'pause'), new Date().toISOString());
  log(output.info(`Org "${name}" paused — current turns will finish, no new cycles will start. Resume with: monomind org resume ${name}`));
  return { success: true, message: `org ${name} paused` };
};

const resumeAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  if (!isOrgPaused(ctx.cwd, name)) {
    log(output.warning(`Org "${name}" is not paused.`));
    return { success: true, message: 'not paused' };
  }
  clearPausefile(ctx.cwd, name);
  log(output.info(`Org "${name}" resumed — next scheduled tick will start a cycle.`));
  return { success: true, message: `org ${name} resumed` };
};

const reloadAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  // The reload signal is a file the running daemon polls — same pattern as stop/pause.
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'reload'), new Date().toISOString());
  log(output.info(`Reload requested for "${name}" — the daemon picks it up within ~2s.`));
  return { success: true, message: `reload requested for ${name}` };
};

const statusAction = async (ctx: CommandContext): Promise<CommandResult> => {
  let name: string | undefined;
  if (ctx.args[0]) {
    const validated = validateOrgName(ctx.args[0]);
    if (!validated.ok) return validated.result;
    name = validated.name;
    // A named org that doesn't exist must error, not report "never run" with exit 0.
    if (!existsSync(join(ctx.cwd, ORG_DIR, `${name}.json`))) {
      log(output.error(`Org not found: ${name}`));
      return { success: false, message: 'org not found' };
    }
  }
  const orgDir = join(ctx.cwd, ORG_DIR);
  const targets = name ? [name] : (existsSync(orgDir)
    ? listOrgConfigFiles(orgDir).map(f => f.replace(/\.json$/, ''))
    : []);
  for (const t of targets) {
    const rt = join(orgDir, t, 'runtime.json');
    let state: { status: string; run?: string; pid?: number; abandonedRoles?: string[] } = { status: 'never run' };
    if (existsSync(rt)) {
      try {
        state = JSON.parse(readFileSync(rt, 'utf8'));
      } catch (err) {
        log(output.warning(`${t}: could not read runtime.json (${err instanceof Error ? err.message : 'corrupt/truncated file'})`));
        continue;
      }
    }
    // A "running" record whose pid is gone means the daemon died without its
    // stopOrg cleanup — surface that instead of reporting it as still running.
    if ((state.status === 'running' || state.status === 'crashed') && state.pid) {
      const pidGone = state.status === 'crashed' || (() => {
        try { process.kill(state.pid!, 0); return false; }
        catch { return true; }
      })();
      if (pidGone) {
        let heartbeatHint = '';
        try {
          const hb = JSON.parse(readFileSync(join(ctx.cwd, '.monomind', 'serve-heartbeat.json'), 'utf8'));
          heartbeatHint = ` (last heartbeat: ${hb.updatedAt})`;
        } catch { /* no heartbeat file — daemon predates this change or was already cleaned up */ }
        const closedBy = (state as { closedBy?: string }).closedBy;
        const label = closedBy === 'crash-handler' ? 'crashed (caught by crash handler)' : `crashed (runtime.json says ${state.status} but pid ${state.pid} is gone)`;
        log(output.warning(`${t}: ${label}${heartbeatHint}${state.run ? ` — run ${state.run}` : ''} — close it out with "monomind org mark-complete ${t}"`));
        continue;
      }
    }
    const paused = isOrgPaused(ctx.cwd, t);
    const statusLabel = paused && state.status === 'running' ? 'running (PAUSED)' : state.status;
    const line = `${t}: ${statusLabel}${state.run ? ` (run ${state.run}, pid ${state.pid})` : ''}`;
    // A role that never spawned is a silent capability hole — an org with no
    // tester still reports a clean "running". Say it on the status line.
    if (state.abandonedRoles?.length) {
      log(output.warning(`${line} — DEGRADED: ${state.abandonedRoles.length} role(s) never spawned: ${state.abandonedRoles.join(', ')}`));
    } else {
      log(output.info(line));
    }

    // Enriched progress for running orgs
    if (state.status === 'running' && state.run) {
      const events = readRunEvents(ctx.cwd, t, state.run);
      if (events.length) {
        const summary = summarizeRun(events);
        const elapsed = summary.startedAt ? Date.now() - summary.startedAt : null;
        const elapsedStr = elapsed !== null ? fmtDuration(elapsed) : '?';
        const lastTs = events[events.length - 1].ts;
        const quietMs = Date.now() - lastTs;
        const quietStr = fmtDuration(quietMs);
        const toolCalls = Object.values(summary.roles).reduce((a, r) => a + r.toolsAllowed + r.toolsDenied, 0);
        const rolesUp = Object.keys(summary.roles).filter(r => r !== '(system)').length;

        log(`  elapsed: ${elapsedStr} | events: ${summary.events} | messages: ${summary.messages} | tools: ${toolCalls}`);
        log(`  roles active: ${rolesUp} | tokens: ${fmtNum(summary.totalTokens)} | cost: $${summary.totalCostUsd.toFixed(2)}`);
        log(`  quiet since: ${new Date(lastTs).toISOString().slice(11, 19)} (${quietStr} ago)`);
        if (summary.crashes.length) log(output.warning(`  crashes: ${summary.crashes.join(', ')}`));
      }

      // Previous cycle comparison from history
      const history = readHistory(ctx.cwd, t);
      const prev = history.filter(h => h.run !== state.run).at(-1);
      if (prev) {
        const dur = prev.durationMs !== null ? fmtDuration(prev.durationMs) : '?';
        const outcome = prev.outcome?.status ?? (prev.crashes.length ? 'crashed' : 'completed');
        log(`  prev cycle: ${dur}, ${outcome}, ${prev.events} events, ${fmtNum(prev.totalTokens)} tokens`);
      }
    }
  }
  return { success: true };
};

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** One pass of the `org serve` stopfile poll.
 *
 * `monomind org stop <name>` writes `.monomind/orgs/<name>/stop`. `org run` has always
 * polled that file; `org serve` did not — so against a serve daemon `org stop` was a
 * silent no-op that still printed "daemon exits within 2s" and exited 0 while the org
 * kept running. Stops every running org whose stopfile is present, then clears the
 * stopfile so the next scheduled iteration isn't killed on sight.
 *
 * Returns the names it stopped (awaited), so callers/tests don't have to guess. */
export const pollStopfiles = async (cwd: string, daemon: OrgDaemon): Promise<string[]> => {
  const stopped: string[] = [];
  for (const name of daemon.listRunning()) {
    if (!existsSync(join(cwd, ORG_DIR, name, 'stop'))) continue;
    log(output.info(`org ${name}: stop requested — shutting it down`));
    try {
      await daemon.stopOrg(name);
      stopped.push(name);
    } catch (err) {
      console.error(`org ${name}: stop failed:`, err);
    } finally {
      clearStopfile(cwd, name);
    }
  }
  return stopped;
};

export const pollReloadfiles = async (cwd: string, daemon: OrgDaemon): Promise<string[]> => {
  const reloaded: string[] = [];
  for (const name of daemon.listRunning()) {
    const reloadFile = join(cwd, ORG_DIR, name, 'reload');
    if (!existsSync(reloadFile)) continue;
    try { unlinkSync(reloadFile); } catch { /* already gone */ }
    try {
      const result = daemon.reloadOrgDef(name);
      const parts: string[] = [];
      if (result.changed.length) parts.push(`${result.changed.length} fields updated`);
      if (result.newRoles.length) parts.push(`${result.newRoles.length} new roles: ${result.newRoles.join(', ')}`);
      if (result.removedRoles.length) parts.push(`${result.removedRoles.length} roles removed: ${result.removedRoles.join(', ')}`);
      log(output.info(`org ${name}: reloaded — ${parts.join('; ') || 'no changes'}`));
      reloaded.push(name);
    } catch (err) {
      log(output.warning(`org ${name}: reload failed — ${err instanceof Error ? err.message : 'unknown'}`));
    }
  }
  return reloaded;
};

/** One pass of the `org serve` runfile poll — the mirror of pollStopfiles.
 *
 * A serve daemon owns its orgs, and nothing could ask it to start one off-cycle:
 * a scheduled org simply waited for its next tick, and `org run` against a
 * served org would spawn a second daemon competing for the same runtime.json
 * and broker lease. "Run it now" therefore meant killing and restarting the
 * daemon, which resets the schedule and drops any in-flight work.
 *
 * `.monomind/orgs/<name>/run` is the request. Consumed (deleted) before the
 * start, so a crash mid-run cannot wedge the org into a restart loop, and an
 * already-running org just clears it — "start now" on something already started
 * is satisfied, not an error.
 *
 * Returns the names it started, so callers/tests don't have to guess. */
export const pollRunfiles = async (cwd: string, daemon: OrgDaemon): Promise<string[]> => {
  const started: string[] = [];
  const orgDir = join(cwd, ORG_DIR);
  if (!existsSync(orgDir)) return started;
  for (const f of listOrgConfigFiles(orgDir)) {
    const name = f.replace(/\.json$/, '');
    const runfile = join(orgDir, name, 'run');
    if (!existsSync(runfile)) continue;
    // Read before consuming. Pre-runfile writers (and a hand-touched file) left
    // a bare timestamp or nothing at all, so an unparseable body is a plain
    // "start it" request, not an error.
    let task: string | undefined;
    try {
      const body = JSON.parse(readFileSync(runfile, 'utf8')) as { task?: string | null };
      if (typeof body.task === 'string' && body.task.trim()) task = body.task;
    } catch { /* bare/empty runfile — start with the org's own goal */ }
    try { unlinkSync(runfile); } catch { /* already gone */ }
    if (daemon.listRunning().includes(name)) continue; // already running — request satisfied
    log(output.info(`org ${name}: run requested — starting now${task ? ' (with task)' : ''}`));
    try {
      await daemon.startOrg(name, task);
      started.push(name);
    } catch (err) {
      console.error(`org ${name}: requested start failed:`, err);
    }
  }
  return started;
};

/**
 * Emit a supervisor unit for `org serve`.
 *
 * Why this is an EXTERNAL supervisor and not an `--supervise` flag: the daemon
 * already logs every death it can observe — signals, uncaught exceptions,
 * unhandled rejections, and the event loop draining. The one death it cannot
 * observe is SIGKILL, which is what the OOM killer sends, and which is the
 * suspected cause of the reported disappearance (its org logs showed repeated
 * low-memory warnings). No in-process handler survives SIGKILL, so a daemon
 * that restarts itself is theatre for exactly the case that matters. Only
 * something outside the process can bring it back.
 *
 * launchd and systemd both already do this well, so this generates a correct
 * unit rather than reimplementing them.
 */
const supervisorAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const cwd = resolve(ctx.cwd || process.cwd());
  const requested = String(ctx.flags.format ?? '').trim().toLowerCase();
  const format = requested || (process.platform === 'darwin' ? 'launchd' : 'systemd');
  if (format !== 'launchd' && format !== 'systemd') {
    log(output.error(`Unknown --format "${requested}" — expected launchd or systemd.`));
    return { success: false, message: 'unknown supervisor format' };
  }

  // argv[1] is this CLI's entry point — the same resolution `init` uses when it
  // spawns a watcher. A supervisor must not depend on PATH or npx resolving to
  // the same version later.
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : 'monomind';
  const node = process.execPath;
  // Per-project identity. The unit bakes in a WorkingDirectory, so a constant
  // Label and filename meant `--install` from a second project silently
  // OVERWROTE the first project's unit — one file, the first daemon left
  // unsupervised, no warning. Verified before fixing: installing from projA
  // then projB left a single unit pointing at projB.
  //
  // The hash keeps it unique for two directories with the same basename; the
  // basename keeps it recognisable in `launchctl list` / `systemctl --user`.
  const slug = `${(cwd.split(/[\\/]/).pop() || 'org').replace(/[^A-Za-z0-9._-]/g, '-')}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
  const label = `com.monomind.org-serve.${slug}`;
  const logPath = join(cwd, '.monomind', 'org-serve.log');

  const unit = format === 'launchd'
    ? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cliEntry}</string>
    <string>org</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <!-- KeepAlive restarts the daemon however it died, including SIGKILL. -->
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`
    : `[Unit]
Description=monomind org serve (${cwd})
After=network.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${node} ${cliEntry} org serve
# Restart however it died, including an OOM kill.
Restart=always
RestartSec=5
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;

  const target = format === 'launchd'
    ? `~/Library/LaunchAgents/${label}.plist`
    : `~/.config/systemd/user/monomind-org-serve-${slug}.service`;

  if (ctx.flags.install === true) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) {
      log(output.error('Cannot resolve a home directory to install into — write the unit manually.'));
      return { success: false, message: 'no home directory' };
    }
    const dest = format === 'launchd'
      ? join(home, 'Library', 'LaunchAgents', `${label}.plist`)
      : join(home, '.config', 'systemd', 'user', `monomind-org-serve-${slug}.service`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, unit);
    log(output.success(`Wrote ${dest}`));
    log(output.info(
      format === 'launchd'
        ? `Load it with: launchctl load -w ${dest}`
        : `Load it with: systemctl --user daemon-reload && systemctl --user enable --now monomind-org-serve-${slug}`,
    ));
    return { success: true, message: `supervisor unit written to ${dest}` };
  }

  log(unit);
  log(output.info(`Write this to ${target}, or re-run with --install to do it for you.`));
  log(output.info(
    'Why a supervisor: the daemon logs every death it can observe, but an OOM kill is SIGKILL — ' +
    'uncatchable by design, so nothing in-process can restart after one.',
  ));
  return { success: true, message: `${format} unit emitted` };
};

const serveAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const crossProcess = ctx.flags['crossProcess'] !== false;
  const daemon = new OrgDaemon(ctx.cwd, { crossProcess });
  let srv: Awaited<ReturnType<typeof startOrgServer>> | undefined;
  if (crossProcess) {
    srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.credential);
  }

  // Crash handlers: log the reason and persist crashed state so `org status`
  // shows what happened instead of a silent "pid is gone".
  const crashExit = (label: string, err: unknown): void => {
    try { console.error(`[org serve] ${label}:`, err); } catch { /* stderr gone */ }
    daemon.persistCrashStateAll();
    daemon.clearHeartbeat();
    process.exitCode = 1;
  };
  process.on('uncaughtException', (err) => { crashExit('uncaughtException', err); process.exit(1); });
  process.on('unhandledRejection', (err) => { crashExit('unhandledRejection', err); process.exit(1); });

  // Termination diagnostics (#45). The two handlers above only cover errors
  // raised *inside* the daemon. A report of the daemon vanishing after hours
  // had a log holding nothing but its startup lines, because the ways a daemon
  // usually dies were all unhandled:
  //
  //   - a signal (SIGTERM from a supervisor/OS, SIGHUP when a terminal closes)
  //   - the event loop simply draining, which exits 0 and says nothing at all
  //
  // Both now announce themselves. Note what this deliberately cannot cover:
  // SIGKILL, which is what the OOM killer sends, is uncatchable by design — no
  // in-process handler can ever log it. That case is instead made *inferable*:
  // every shutdown path below prints a terminal line, so a log that starts and
  // then stops with no such line means the process was killed from outside
  // (OOM being the usual culprit, and the reporter's org logs did show memory
  // pressure). Absence of a shutdown line is now evidence, not ambiguity.
  let shuttingDown = false;
  const announceExit = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { console.error(`[org serve] shutting down: ${reason}`); } catch { /* stderr gone */ }
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      announceExit(`received ${sig}`);
      try { daemon.persistCrashStateAll(); daemon.clearHeartbeat(); } catch { /* best effort */ }
      // A daemon holds ref'd timers, so it will not drain on its own; an
      // explicit exit is required here and is the intended signal semantics.
      process.exit(sig === 'SIGTERM' || sig === 'SIGINT' ? 0 : 1);
    });
  }
  process.on('exit', (code) => {
    // Last word on the way out. Reached for the "event loop drained" case,
    // which previously produced a completely silent disappearance.
    announceExit(`process exiting with code ${code}`);
  });

  // Heartbeat: write every 30s so `org status` can tell "alive but busy" from
  // "daemon gone" without relying on pid liveness alone.
  daemon.writeHeartbeat();
  const heartbeatInterval = setInterval(() => { daemon.writeHeartbeat(); }, 30_000);
  heartbeatInterval.unref?.();

  log(output.info('org daemon serving — Ctrl-C to stop'));

  // schedule orgs whose definition declares an interval (e.g. "15m", "2h")
  const { OrgScheduler, parseSchedule } = await import('../orgrt/scheduler.js');
  const sched = new OrgScheduler(async (name, intervalMs) => {
    if (isOrgPaused(ctx.cwd, name)) return;
    // Run precondition checks before starting a scheduled run
    try {
      const defPath = join(ctx.cwd, ORG_DIR, `${name}.json`);
      if (existsSync(defPath)) {
        const rawDef = JSON.parse(readFileSync(defPath, 'utf8'));
        const checks = rawDef?.run_config?.prechecks;
        if (Array.isArray(checks) && checks.length > 0) {
          const { runPrechecks } = await import('../orgrt/prechecks.js');
          const { ok, results } = await runPrechecks(checks, ctx.cwd);
          if (!ok) {
            const failed = results.find(r => !r.passed);
            log(output.warning(`org ${name}: precheck "${failed?.name}" failed — skipping scheduled run`));
            if (failed?.output) log(output.warning(`  ${failed.output.slice(0, 200)}`));
            return;
          }
        }
      }
    } catch (err) {
      log(output.warning(`org ${name}: precheck evaluation error — ${err instanceof Error ? err.message : 'unknown'}`));
    }
    // Only ever stop a run THIS tick started. The runfile poll can start an org
    // out-of-band, and the scheduler has no visibility into that — so a tick
    // landing on an already-running org threw "already running", fell into the
    // finally, and stopped a healthy run that had nothing to do with it. The
    // tick's job in that case is simply to yield.
    let startedHere = false;
    try {
      await daemon.startOrg(name);
      startedHere = true;
      // Scheduled iterations are time-bounded: agents' `done` promises only
      // resolve after stopOrg closes the mailboxes, so waiting on them alone
      // deadlocks. Race against a max-run timeout, then ALWAYS stopOrg
      // (idempotent — it resolves `done` and flushes).
      const org = daemon.getOrg(name);
      const allDone = org
        ? Promise.allSettled([...org.agents.values()].map(a => a.done))
        : Promise.resolve([]);
      const maxRun = (org?.def as { run_config?: { max_run?: string | number } } | undefined)?.run_config?.max_run;
      // Default to the full interval. The old `min(interval, 10min)` clamp
      // silently guillotined every org that didn't set max_run: real cycles
      // here run 75-93 minutes, so a 2h-scheduled org was being force-stopped
      // a twelfth of the way in, every time, with nothing saying so. Ten
      // minutes was never a considered bound for agent work — it only looked
      // safe because overrunning the interval used to cost a whole idle
      // period. Now that a missed tick catches up the moment a run ends
      // (OrgScheduler.pending), a run may safely use its whole interval.
      // Set run_config.max_run to bound it tighter — or looser.
      const maxMs = parseSchedule(maxRun) ?? intervalMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([allDone, new Promise<void>(r => {
        timer = setTimeout(r, maxMs);
        timer.unref?.();
      })]);
      if (timer) clearTimeout(timer);
    } catch (err) {
      console.error(`org ${name}: scheduled run failed:`, err);
    } finally {
      // A deadline stop still lands on agents mid-tool-call. The 15s abort
      // bound threw that work away; a minute is enough to finish an edit or a
      // test run and flush, and still well inside any sane interval.
      if (startedHere) {
        await daemon.stopOrg(name, { drainMs: 60_000 }).catch(err => console.error(`org ${name}: stop failed:`, err));
      }
    }
  });
  const orgDir = join(ctx.cwd, ORG_DIR);
  if (existsSync(orgDir)) {
    for (const f of listOrgConfigFiles(orgDir)) {
      try {
        const def = JSON.parse(readFileSync(join(orgDir, f), 'utf8'));
        const ms = parseSchedule(def.schedule);
        if (ms) {
          // register by filename stem — that's what startOrg loads
          const stem = f.replace(/\.json$/, '');
          if (def.name && def.name !== stem) log(output.warning(`org file ${f}: def.name "${def.name}" differs from filename — scheduling as "${stem}"`));
          // Due = never run, or last run ended longer ago than the interval.
          // Without this, starting the daemon meant waiting a full period
          // before anything happened at all; gating on due-ness means a
          // restart doesn't stampede every scheduled org back into a run.
          const lastEnded = readHistory(ctx.cwd, stem).at(-1)?.endedAt ?? 0;
          const since = lastEnded ? Date.now() - lastEnded : undefined;
          const due = (since ?? Infinity) >= ms;
          sched.add(stem, ms, due, since);
          const waitMin = due ? 0 : Math.round((ms - (since ?? 0)) / 60_000);
          log(output.info(`scheduled org ${stem} every ${Math.round(ms / 60_000)}m${due ? ' — due now, starting first run' : ` — next run in ~${waitMin}m`}`));
        }
      } catch (err) {
        log(output.warning(`org file ${f}: could not parse — skipping (${err instanceof Error ? err.message : 'invalid JSON'})`));
      }
    }
  }

  const stopPoll = setInterval(() => { void pollStopfiles(ctx.cwd, daemon); }, 2000);
  stopPoll.unref?.();
  const runPoll = setInterval(() => { void pollRunfiles(ctx.cwd, daemon); }, 2000);
  runPoll.unref?.();
  const reloadPoll = setInterval(() => { void pollReloadfiles(ctx.cwd, daemon); }, 2000);
  reloadPoll.unref?.();

  await new Promise<void>(r => { process.once('SIGINT', () => r()); process.once('SIGTERM', () => r()); });
  clearInterval(stopPoll);
  clearInterval(runPoll);
  clearInterval(reloadPoll);
  clearInterval(heartbeatInterval);
  sched.stop();
  await daemon.stopAll();
  daemon.clearHeartbeat();
  srv?.close();
  return { success: true };
};

const testLoopAction = async (ctx: CommandContext): Promise<CommandResult> => {
  // non-literal specifier: test-loop.ts lands in a later task; keeps tsc clean until then
  const testLoopModule = '../orgrt/test-loop.js';
  const { runTestLoop } = await import(testLoopModule) as
    { runTestLoop: (cwd: string, times: number, scenarioFile?: string) => Promise<{ summary: string; failed: number }> };
  const n = Number(ctx.flags['times'] ?? ctx.flags['n'] ?? 5);
  const scenario = typeof ctx.flags['scenario'] === 'string' ? ctx.flags['scenario'] : undefined;
  const report = await runTestLoop(ctx.cwd, n, scenario);
  log(output.info(report.summary));
  return { success: report.failed === 0, message: report.summary };
};

// ---- legacy management subcommands (list / delete / mark-complete) ----

const listAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgsDir = join(ctx.cwd || process.cwd(), ORG_DIR);
  if (!existsSync(orgsDir)) {
    log(output.info('No orgs directory found. Create an org first with /mastermind:createorg'));
    return { success: true };
  }
  const configs = listOrgConfigFiles(orgsDir);
  if (!configs.length) {
    log(output.info('No orgs found.'));
    return { success: true };
  }
  log(output.info(`Found ${configs.length} org(s):`));
  for (const f of configs) {
    const stem = f.replace(/\.json$/, '');
    let detail = '';
    try {
      const def = JSON.parse(readFileSync(join(orgsDir, f), 'utf8')) as
        { goal?: string; schedule?: string | number | null; roles?: unknown[] };
      const roles = Array.isArray(def.roles) ? def.roles.length : 0;
      const sched = def.schedule ? `every ${def.schedule}` : 'manual';
      let status = 'never run';
      try {
        const rt = JSON.parse(readFileSync(join(orgsDir, stem, 'runtime.json'), 'utf8')) as { status?: string; pid?: number };
        status = rt.status ?? status;
        // Same liveness rule as `org status`: a 'running' record with a dead
        // pid is a crashed daemon, not a running org — list must not disagree.
        if (status === 'running' && rt.pid) {
          try { process.kill(rt.pid, 0); } catch { status = 'crashed'; }
        }
      } catch { /* no runtime state yet */ }
      const goal = typeof def.goal === 'string' && def.goal
        ? ` — ${def.goal.length > 60 ? `${def.goal.slice(0, 57)}...` : def.goal}` : '';
      detail = `  (${roles} role${roles === 1 ? '' : 's'}, ${sched}, ${status})${goal}`;
    } catch {
      detail = '  (unreadable config — run `monomind org validate`)';
    }
    log(output.info(`  • ${stem}${detail}`));
  }
  return { success: true };
};

const deleteAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgName = ctx.args[0];
  if (!orgName) {
    log(output.error('Usage: monomind org delete <name>'));
    return { success: false, message: 'org name required' };
  }
  if (!ORG_NAME_RE.test(orgName)) {
    log(output.error(`Invalid org name: ${orgName}`));
    return { success: false, message: 'invalid org name' };
  }
  const confirmed = ctx.flags['yes'] === true || ctx.args.includes('--yes') || ctx.args.includes('-y');
  if (!confirmed) {
    log(output.warning(`This will permanently delete org "${orgName}" and all its data.`));
    log(output.warning('Pass --yes to confirm.'));
    return { success: false, message: 'confirmation required' };
  }
  const cwd = resolve(ctx.cwd || process.cwd());
  const orgsDir = join(cwd, ORG_DIR);
  const configFile = join(orgsDir, `${orgName}.json`);
  if (!existsSync(configFile)) {
    log(output.error(`Org not found: ${orgName}`));
    return { success: false, message: 'org not found' };
  }
  if (isOrgRunning(cwd, orgName) && ctx.flags['force'] !== true) {
    log(output.error(`Org "${orgName}" is currently running — stop it first (monomind org stop ${orgName}) or pass --force.`));
    return { success: false, message: 'org is running' };
  }
  let removed = 0;
  for (const suf of ['', ...ORG_ARTIFACT_SUFFIXES]) {
    for (const ext of ['.json', '.jsonl']) {
      const f = join(orgsDir, `${orgName}${suf}${ext}`);
      try { if (existsSync(f)) { unlinkSync(f); removed++; } } catch { /* ignore */ }
    }
  }
  try { unlinkSync(join(orgsDir, '.stops', `${orgName}.stop`)); } catch { /* ignore */ }
  const orgSubDir = join(orgsDir, orgName);
  try { if (existsSync(orgSubDir)) rmSync(orgSubDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { unlinkSync(join(cwd, '.monomind', 'loops', `${orgName}.md`)); } catch { /* ignore */ }
  try { unlinkSync(join(orgsDir, `${orgName}-run.md`)); } catch { /* ignore */ }
  log(output.success(`Org "${orgName}" deleted (${removed} file(s) removed).`));
  return { success: true };
};

/** Clear a stale `running` record from runtime.json. This is the state `org status`
 *  reads, so mark-complete MUST touch it — the dashboard's run:complete event alone
 *  left `org status` reporting the same "crashed" line it had just told the user to
 *  fix with this exact command. Refuses when the recorded pid is still alive: a live
 *  daemon would just rewrite the file, and `org stop` is the right command there. */
const clearStaleRuntime = (cwd: string, name: string):
  { cleared: true; run?: string } | { cleared: false; reason: 'absent' | 'not-running' | 'alive' | 'unreadable'; detail?: string } => {
  const rtPath = join(cwd, ORG_DIR, name, 'runtime.json');
  if (!existsSync(rtPath)) return { cleared: false, reason: 'absent' };
  let rt: { status?: string; run?: string; pid?: number };
  try {
    rt = JSON.parse(readFileSync(rtPath, 'utf8'));
  } catch (err) {
    return { cleared: false, reason: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
  if (rt.status !== 'running' && rt.status !== 'crashed') return { cleared: false, reason: 'not-running' };
  if (rt.status === 'running' && rt.pid) {
    try { process.kill(rt.pid, 0); return { cleared: false, reason: 'alive', detail: String(rt.pid) }; }
    catch { /* pid is gone — this is exactly the stale case mark-complete exists for */ }
  }
  // Same shape stopOrg's persistState() writes, so every reader (org status,
  // isOrgRunning, the mastermind-org* skills' jq checks) sees a stopped org.
  writeFileSync(rtPath, JSON.stringify(
    { status: 'stopped', run: rt.run, pid: rt.pid, updated: new Date().toISOString(), closedBy: 'mark-complete' },
    null, 2));
  return { cleared: true, run: rt.run };
};

const markCompleteAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgName = ctx.args[0];
  if (!orgName || !ORG_NAME_RE.test(orgName)) {
    log(output.error('Usage: monomind org mark-complete <name>'));
    return { success: false, message: 'valid org name required' };
  }
  const cwd = resolve(ctx.cwd || process.cwd());

  // Reject an org that does not exist, using the same check as runAction. Without
  // it `org mark-complete nosuchorg` printed "local state was cleared" and exited
  // 0 — a typo looked like a successful cleanup.
  const orgsDir = join(cwd, ORG_DIR);
  if (!existsSync(join(orgsDir, `${orgName}.json`))) {
    const known = existsSync(orgsDir) ? listOrgConfigFiles(orgsDir).map(f => f.replace(/\.json$/, '')) : [];
    log(output.error(`Org not found: ${orgName}${known.length ? ` — available: ${known.join(', ')}` : ''}`));
    return { success: false, message: 'org not found' };
  }

  // 1) Local runtime.json — the state `org status` actually reads. Done first and
  //    independently of the dashboard so the recommended remedy works with no server.
  const local = clearStaleRuntime(cwd, orgName);
  if (!local.cleared && local.reason === 'alive') {
    log(output.error(`Org "${orgName}" is still running (pid ${local.detail}) — stop it with "monomind org stop ${orgName}" instead.`));
    return { success: false, message: 'org is running' };
  }
  if (local.cleared) log(output.success(`Cleared stale runtime state for "${orgName}"${local.run ? ` (run ${local.run})` : ''}.`));
  else if (local.reason === 'unreadable') log(output.warning(`runtime.json for "${orgName}" is unreadable (${local.detail}) — left untouched.`));
  else log(output.info(`No stale runtime state for "${orgName}" (runtime.json ${local.reason === 'absent' ? 'absent' : 'already not running'}).`));

  // 2) Dashboard run:complete event — best effort. A missing/unauthorized dashboard
  //    must not make the command fail after the local state was already cleared.
  let ctrlUrl = 'http://localhost:4242';
  try {
    const ctl = JSON.parse(readFileSync(join(cwd, '.monomind', 'control.json'), 'utf8'));
    if (ctl.url) ctrlUrl = ctl.url;
  } catch { /* default */ }
  try {
    // All dashboard /api routes are auth-gated — attach the local session token.
    let auth = '';
    try { auth = readFileSync(join(cwd, '.monomind', 'dashboard-token'), 'utf8').trim(); } catch { /* server may be pre-auth */ }
    // Bounded. Updating the dashboard is best-effort — the local state has
    // already been cleared by this point — but the fetch had no timeout, so a
    // dashboard that holds the port without answering (a wedged build from an
    // earlier session; see the stale-dashboard issue) hung `mark-complete`
    // indefinitely. "Unreachable" and "not answering" must cost the same.
    const res = await fetch(`${ctrlUrl}/api/orgs/${encodeURIComponent(orgName)}/mark-complete`, {
      method: 'POST',
      headers: auth ? { 'x-monomind-token': auth } : {},
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(output.warning(`Dashboard not updated (${res.status}: ${(body as { error?: string }).error || 'unknown error'}) — ${local.cleared ? 'local state was cleared' : 'there was no local state to clear'}.`));
    } else {
      const runId = (body as { runId?: string }).runId;
      log(output.success(`Dashboard run marked complete for "${orgName}"${runId ? ` (run ${runId})` : ''}.`));
    }
  } catch (err) {
    log(output.warning(`Dashboard unreachable at ${ctrlUrl} (${err instanceof Error ? err.message : 'error'}) — ${local.cleared ? 'local state was cleared' : 'there was no local state to clear'}.`));
  }
  return local.cleared
    ? { success: true, message: `run marked complete for ${orgName}` }
    : { success: true, message: `nothing to clear for ${orgName}` };
};

const migrateAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  const cwd = ctx.cwd;
  const cfgPath = join(cwd, ORG_DIR, `${name}.json`);
  if (!existsSync(cfgPath)) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
  if (isOrgRunning(cwd, name)) {
    log(output.error(`Org "${name}" is currently running — stop it first, then migrate.`));
    return { success: false, message: 'org is running' };
  }
  try {
    const outcome = migrateOrgFile(cfgPath, join(cwd, ORG_DIR, `${name}.v1.json`));
    if (outcome.status === 'already-v2') {
      log(output.info(`${name}: already v2 — nothing to migrate.`));
      return { success: true, message: 'already v2' };
    }
    log(output.success(`${name}: migrated to v2 (backup: ${name}.v1.json)`));
    for (const d of outcome.dropped) log(output.info(`  dropped v1 field: ${d}`));
    for (const n of outcome.notes) log(output.info(`  ${n}`));
    log(output.info(`  run it with: monomind org run ${name}`));
    return { success: true, message: `migrated ${name}` };
  } catch (err) {
    log(output.error(`Cannot migrate ${name}: ${err instanceof Error ? err.message : String(err)}`));
    return { success: false, message: 'migration produced an invalid config' };
  }
};

export const orgCommand: Command = {
  name: 'org',
  description: 'SDK-based org runtime — run agent organizations as a controlled daemon',
  subcommands: [
    {
      name: 'run', description: 'Start an org (foreground daemon)',
      options: [
        { name: 'task', description: 'Override the org goal for this run', type: 'string' },
        { name: 'resume', description: 'Resume an org run from its persisted checkpoint instead of starting fresh', type: 'boolean' },
        { name: 'cross-process', description: 'Discover and message orgs hosted by other monomind processes on this machine (default true)', type: 'boolean', default: true },
        { name: 'dry-run', description: 'Validate and print each role\'s briefing without starting any agent sessions', type: 'boolean' },
        { name: 'budget-usd', description: 'Hard-stop the run if the upfront cost estimate exceeds this USD value (e.g. --budget-usd 5)', type: 'number' },
        { name: 'yes', short: 'y', description: 'Skip the interactive cost-estimate confirmation prompt', type: 'boolean' },
      ],
      examples: [{ command: 'monomind org run growth --task "weekly report"', description: 'Run the growth org once with a task' }],
      action: runAction,
    },
    { name: 'stop', description: 'Request a running org daemon to stop', action: stopAction },
    { name: 'pause', description: 'Pause an org — current turns finish, no new cycles start', action: pauseAction },
    { name: 'resume', description: 'Resume a paused org', action: resumeAction },
    { name: 'reload', description: 'Hot-reload an org definition without stopping sessions', action: reloadAction },
    { name: 'status', description: 'Show runtime state of orgs', action: statusAction },
    {
      name: 'serve', description: 'Start the daemon server only (hosts scheduled orgs)',
      options: [
        { name: 'cross-process', description: 'Discover and message orgs hosted by other monomind processes on this machine (default true)', type: 'boolean', default: true },
      ],
      action: serveAction,
    },
    {
      name: 'supervisor',
      description: 'Print (or --install) a launchd/systemd unit that keeps `org serve` running',
      options: [
        { name: 'format', description: 'launchd or systemd (default: platform)', type: 'string' },
        { name: 'install', description: 'Write the unit into the per-user location', type: 'boolean' },
      ],
      action: supervisorAction,
    },
    {
      name: 'test-loop', description: 'Run the org e2e verification loop N times',
      options: [
        { name: 'times', short: 'n', description: 'Iterations', type: 'number', default: 5 },
        { name: 'scenario', description: 'Run a declarative scenario file (.monomind/scenarios/<file>) instead of the built-in fixture — structural dry-run only', type: 'string' },
      ],
      action: testLoopAction,
    },
    {
      name: 'logs', description: 'Show (or follow) the formatted event log of an org run',
      options: [
        { name: 'run', description: 'Run id (default: latest)', type: 'string' },
        { name: 'role', description: 'Only events from/to this role', type: 'string' },
        { name: 'filter-tool', description: 'Filter events by tool name (e.g., Write, Edit)', type: 'string' },
        { name: 'filter-role', description: 'Filter events by role ID', type: 'string' },
        { name: 'tools-only', description: 'Show only tool events (exclude messages/status/audit)', type: 'boolean' },
        { name: 'audit-filter', description: 'Filter audit events by decision (allow|deny)', type: 'string' },
        { name: 'follow', short: 'f', description: 'Keep tailing until Ctrl-C', type: 'boolean' },
      ],
      examples: [
        { command: 'monomind org logs growth --follow', description: 'Live-tail the latest run' },
        { command: 'monomind org logs growth --tools-only', description: 'Show only tool call events' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { logsAction } = await import('./org-observe.js');
        return logsAction(ctx, v.name);
      },
    },
    {
      name: 'watch', description: 'Live-tail one role\'s assistant chat text (any runtime) — a filtered, friendlier `logs --follow`',
      options: [
        { name: 'run', description: 'Run id (default: latest)', type: 'string' },
        { name: 'follow', description: 'Set --follow=false to print current output once and exit instead of live-tailing', type: 'boolean', default: true },
        { name: 'verbose', description: 'Also interleave status events (restart/crash/state-change) into the transcript', type: 'boolean' },
        { name: 'stats', description: 'Print a running token/cost line as usage events arrive', type: 'boolean' },
      ],
      examples: [
        { command: 'monomind org watch growth researcher', description: 'Watch the researcher role\'s live output' },
        { command: 'monomind org watch growth researcher --verbose --stats', description: 'Also show restarts/crashes and a running token/cost total' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { watchAction } = await import('./org-observe.js');
        return watchAction(ctx, v.name);
      },
    },
    {
      name: 'report', description: 'Summarize an org run: outcome, per-role activity, tokens, assets, crashes',
      options: [
        { name: 'run', description: 'Run id (default: latest)', type: 'string' },
        { name: 'all', description: 'List all recorded runs from history', type: 'boolean' },
        { name: 'by-role', description: 'Show per-role cost breakdown', type: 'boolean' },
        { name: 'audit', description: 'Show tool audit trail', type: 'boolean' },
        { name: 'tool', description: 'Filter tool audit by tool name (with --audit)', type: 'string' },
        { name: 'format', description: 'Output format (mermaid for flowchart)', type: 'string' },
      ],
      examples: [{ command: 'monomind org report growth', description: 'Report on the latest run' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { reportAction } = await import('./org-observe.js');
        return reportAction(ctx, v.name);
      },
    },
    {
      name: 'memory', description: 'Inspect an org\'s cross-run memory and knowledge graph (stats | search <query> | rules | rollback <run-ref>)',
      examples: [
        { command: 'monomind org memory growth stats', description: 'KG size and namespaces' },
        { command: 'monomind org memory growth search "launch checklist"', description: 'Search org memory + KG' },
        { command: 'monomind org memory growth rollback run:m4x2', description: 'Delete everything one run wrote to the KG' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const sub = String(ctx.args[1] ?? 'stats');
        const { join } = await import('node:path');
        const dbPath = join(process.cwd(), '.monomind', 'org-memory');
        const kg = await import('../memory/memory-kg.js');
        const bridge = await import('../memory/memory-bridge.js');
        try {
          if (sub === 'stats') {
            const [stats, glossary, backend] = await Promise.all([
              kg.kgStats({ dbPath }), kg.kgGlossary({ dbPath, limit: 15 }), bridge.bridgeGetBackendStats(dbPath),
            ]);
            log(output.info(`Knowledge graph: ${stats.nodes} entities, ${stats.edges} relations, ${stats.rules} rules`));
            if (glossary.length) log(output.info(`Top entities: ${glossary.join(', ')}`));
            const byNs = backend?.entriesByNamespace ?? {};
            for (const [ns, count] of Object.entries(byNs)) log(output.info(`  ${ns}: ${count} entries`));
            return { success: true, message: 'org memory stats', data: { ...stats, namespaces: byNs } };
          }
          if (sub === 'search') {
            const q = ctx.args.slice(2).join(' ');
            if (!q) return { success: false, message: 'usage: org memory <org> search <query>' };
            const [mem, graph] = await Promise.all([
              bridge.bridgeSearchEntries({ query: q, namespace: `org:${v.name}`, limit: 5, dbPath }),
              kg.kgSearch({ query: q, dbPath, limit: 8 }),
            ]);
            for (const r of mem?.results ?? []) log(output.info(`[${r.score.toFixed(2)}] ${r.key}: ${r.content.slice(0, 160)}`));
            if (graph.context) log(output.info(`\nKnowledge graph:\n${graph.context}`));
            return { success: true, message: `${(mem?.results ?? []).length} memories, ${graph.triplets.length} triplets` };
          }
          if (sub === 'rules') {
            const rules = await kg.kgListRules({ dbPath, limit: 50 });
            for (const r of rules) log(output.info(`- ${r.rule.slice(0, 200)}`));
            return { success: true, message: `${rules.length} rules`, data: { rules } };
          }
          if (sub === 'rollback') {
            const ref = ctx.args[2];
            if (!ref) return { success: false, message: 'usage: org memory <org> rollback <origin-ref> (e.g. run:m4x2)' };
            const res = await kg.kgRollback({ originRef: ref, dbPath });
            log(output.info(`Rolled back ${ref}: ${res.deleted} deleted, ${res.retained} retained (shared with other origins)`));
            return { success: res.success, message: `rollback ${ref}`, data: res };
          }
          return { success: false, message: `unknown subcommand "${sub}" — use stats | search | rules | rollback` };
        } finally {
          await bridge.shutdownBridge().catch(() => { /* best effort */ });
        }
      },
    },
    {
      name: 'costs', description: 'Show per-role cost tracking from runtime.json',
      options: [
        { name: 'run', description: 'Run ID (defaults to latest)', type: 'string' },
      ],
      examples: [
        { command: 'monomind org costs growth', description: 'Show cost breakdown for latest run' },
        { command: 'monomind org costs growth --run run-20240130-123456', description: 'Show cost breakdown for specific run' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { costsAction } = await import('./org-observe.js');
        return costsAction(ctx, v.name);
      },
    },
    {
      name: 'inbox', description: 'Deliver an inbound cross-org message (live to a running org, queued to inbox.jsonl otherwise) — remote.ts shells out to this over SSH',
      options: [
        { name: 'json', description: 'JSON payload: {"from":"orgA:role","subject":"...","body":"..."}', type: 'string' },
        { name: 'to', description: 'Target role (default: the org\'s coordinator)', type: 'string' },
        { name: 'from', description: 'Sender, qualified "org:role" (alternative to --json)', type: 'string' },
        { name: 'subject', description: 'Subject (alternative to --json)', type: 'string' },
        { name: 'body', description: 'Body (alternative to --json)', type: 'string' },
      ],
      examples: [{ command: 'monomind org inbox growth --json \'{"from":"sales:boss","subject":"leads","body":"..."}\'', description: 'Deliver a message to the growth org' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { inboxAction } = await import('./org-observe.js');
        return inboxAction(ctx, v.name);
      },
    },
    {
      name: 'flow', description: 'Export org flow as Mermaid diagram',
      options: [{ name: 'run', description: 'Run ID (defaults to latest)', type: 'string' }],
      examples: [{ command: 'monomind org flow growth --run run-20250130120000', description: 'Export Mermaid flowchart' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { flowAction } = await import('./org-observe.js');
        return flowAction(ctx, v.name);
      },
    },
    {
      name: 'questions', description: 'List pending ask_human questions from an org\'s agents',
      options: [{ name: 'all', description: 'Include answered questions', type: 'boolean' }],
      examples: [{ command: 'monomind org questions growth', description: 'Show unanswered questions' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { questionsAction } = await import('./org-observe.js');
        return questionsAction(ctx, v.name);
      },
    },
    {
      name: 'answer', description: 'Answer a pending ask_human question (live if the org is running, queued otherwise)',
      examples: [{ command: 'monomind org answer growth q-123-ab "yes, ship it"', description: 'Answer question q-123-ab' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { answerAction } = await import('./org-observe.js');
        return answerAction(ctx, v.name);
      },
    },
    {
      name: 'approve', description: 'Approve a pending tool/action approval',
      examples: [{ command: 'monomind org approve growth coder "Bash"', description: 'Approve Bash tool for coder role' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { approveAction } = await import('./org-observe.js');
        return approveAction(ctx, v.name);
      },
    },
    {
      name: 'deny', description: 'Deny a pending tool/action approval',
      examples: [{ command: 'monomind org deny growth coder "Bash"', description: 'Deny Bash tool for coder role' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { denyAction } = await import('./org-observe.js');
        return denyAction(ctx, v.name);
      },
    },
    {
      name: 'gates', description: 'List decision gates from an org\'s agents',
      options: [{ name: 'all', description: 'Include resolved gates', type: 'boolean' }],
      examples: [
        { command: 'monomind org gates growth', description: 'Show pending gates' },
        { command: 'monomind org gates growth --all', description: 'Show all gates' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { gatesAction } = await import('./org-observe.js');
        return gatesAction(ctx, v.name);
      },
    },
    {
      name: 'gate-approve', description: 'Approve a pending decision gate',
      examples: [{ command: 'monomind org gate-approve growth gate-123-ab "ship it"', description: 'Approve gate with resolution' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { gateResolveAction } = await import('./org-observe.js');
        return gateResolveAction(ctx, v.name, true);
      },
    },
    {
      name: 'gate-reject', description: 'Reject a pending decision gate',
      examples: [{ command: 'monomind org gate-reject growth gate-123-ab "not ready"', description: 'Reject gate with reason' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { gateResolveAction } = await import('./org-observe.js');
        return gateResolveAction(ctx, v.name, false);
      },
    },
    {
      name: 'replay', description: 'Time-travel debugging: replay a run\'s bus events (does not resume live execution — use "org run --resume" for that)',
      examples: [{ command: 'monomind org replay growth run-20250130120000-abc', description: 'Replay a checkpoint\'s events for inspection' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { replayAction } = await import('./org-observe.js');
        return replayAction(ctx, v.name);
      },
    },
    {
      name: 'resume-from', description: 'Resume live execution from the org\'s persisted checkpoint (restores mailbox/policy/session state; subject to TTL and checksum validation)',
      examples: [{ command: 'monomind org resume-from growth', description: 'Resume growth from its last checkpoint' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { resumeFromAction } = await import('./org-observe.js');
        return resumeFromAction(ctx, v.name);
      },
    },
    {
      name: 'branch', description: "Snapshot a run's event log for replay",
      examples: [{ command: 'monomind org branch growth run-20250130 abc-branch', description: "Snapshot a run's checkpoint into a new run for replay" }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { branchAction } = await import('./org-observe.js');
        return branchAction(ctx, v.name);
      },
    },
    {
      name: 'decisions', description: 'Show Rifft-style decision traces',
      examples: [{ command: 'monomind org decisions growth --run run-20250130', description: 'Show decision traces' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { decisionsAction } = await import('./org-observe.js');
        return decisionsAction(ctx, v.name);
      },
    },
    {
      name: 'create', description: 'Scaffold an org config from a starter template',
      options: [
        { name: 'template', description: 'content-team | dev-team | research-pod | kg-extraction | advisor-orchestrator', type: 'string' },
        { name: 'goal', description: 'Org goal (defaults to the template\'s placeholder)', type: 'string' },
        { name: 'schedule', description: 'Daemon schedule, e.g. 30m or 2h', type: 'string' },
        { name: 'force', description: 'Overwrite an existing org config', type: 'boolean' },
        { name: 'yes', short: 'y', description: 'Skip the per-role model confirmation prompt (TTY only)', type: 'boolean' },
      ],
      examples: [{ command: 'monomind org create blog --template content-team --goal "3 posts/week"', description: 'Create a content org' }],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const v = validateOrgName(ctx.args[0]);
        if (!v.ok) return v.result;
        const { createAction } = await import('./org-observe.js');
        return createAction(ctx, v.name);
      },
    },
    {
      name: 'validate', description: 'Validate org config(s) against the runtime schema and structural invariants',
      examples: [
        { command: 'monomind org validate growth', description: 'Validate one org config' },
        { command: 'monomind org validate', description: 'Validate every org config in the project' },
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const { validateAction } = await import('./org-observe.js');
        return validateAction(ctx);
      },
    },
    {
      name: 'migrate', description: 'Convert a v1 org config (topology/board/loop) to the v2 daemon shape',
      examples: [{ command: 'monomind org migrate growth', description: 'Migrate one org; original saved as growth.v1.json' }],
      action: migrateAction,
    },
    { name: 'list', description: 'List all orgs in the current project', action: listAction },
    {
      name: 'delete', description: 'Delete an org and all its data',
      options: [
        { name: 'yes', short: 'y', description: 'Skip confirmation', type: 'boolean' },
        { name: 'force', description: 'Delete even if the org appears to be running', type: 'boolean' },
      ],
      action: deleteAction,
    },
    { name: 'mark-complete', description: 'Manually close a stale/crashed run', action: markCompleteAction },
  ],
  examples: [{ command: 'monomind org run my-org', description: 'Run an org under full daemon control' }],
  action: async (): Promise<CommandResult> => {
    // index.ts's dispatcher never prints result.message on a failed action —
    // it only exits with result.exitCode — so this must log itself or bare
    // `monomind org` exits silently with code 1 and zero output.
    const message = 'usage: monomind org <run|stop|status|serve|test-loop|logs|report|costs|inbox|questions|answer|approve|deny|replay|resume-from|branch|decisions|create|validate|migrate|list|delete|mark-complete>';
    log(output.error(message));
    return { success: false, message };
  },
};

export default orgCommand;
