// packages/@monomind/cli/src/commands/org-run-preview.ts
//
// `monomind org run` — what is printed before any session starts: the
// --dry-run briefing preview, the v1-config warning and the upfront cost
// estimate. Split out of org-run.ts's runAction.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveOrgDefBlueprints } from '../catalog/blueprints.js';
import { roleRunSpec } from '../orgrt/role-run-spec.js';
import { OrgDefSchema } from '../orgrt/types.js';
import { output } from '../output.js';
import { MODEL_PRICING } from '../pricing/model-pricing.js';
import type { CommandResult } from '../types.js';

const log = (text: string): void => {
  console.log(text);
};

/** `org run --dry-run`: validate the org and print each role's actual
 *  briefing without spawning sessions. */
export async function printDryRun(
  cwd: string,
  orgsDir: string,
  name: string,
  taskFlag: unknown,
): Promise<CommandResult> {
  try {
    const parsedDef = OrgDefSchema.parse(
      JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')),
    );
    const bp = resolveOrgDefBlueprints(parsedDef, cwd);
    for (const n of bp.notes) log(output.info(n));
    if (bp.errors.length) throw new Error(bp.errors.join('; '));
    const def = bp.def;
    const { buildRolePrompt, resolveRoleExtraGuidance } = await import('../orgrt/session.js');
    const { agentRoles, endpointBriefingLines } = await import('../orgrt/endpoint-roles.js');
    const { expandRolePromptVars, promptVarsFor } = await import('../orgrt/prompt-vars.js');
    const roster = def.roles.map((r) => r.id);
    // M2: endpoint roles get no session, so no briefing and no budget share.
    const sessionRoles = agentRoles(def.roles);
    const bossId = (
      sessionRoles.find((r) => r.type === 'boss' || r.reports_to === null) ?? sessionRoles[0]
    )?.id;
    const perRole = Math.floor(
      (def.run_config.budget_tokens ?? 1_000_000) / Math.max(1, sessionRoles.length),
    );
    // Same KG entity glossary the live daemon injects — the preview must
    // match what sessions actually receive.
    const glossary = await (async () => {
      try {
        const kg = await import('../memory/memory-kg.js');
        const { orgKgScope } = await import('../orgrt/org-memory.js');
        return await kg.kgGlossary({
          dbPath: join(process.cwd(), '.monomind', 'org-memory'),
          scope: orgKgScope(name),
        });
      } catch {
        return [];
      }
    })();
    log(
      output.info(
        `DRY RUN — org ${name}: ${sessionRoles.length} roles, ${perRole} tokens each, goal: ${taskFlag ?? def.goal}`,
      ),
    );
    for (const role of sessionRoles) {
      const spec = roleRunSpec(def, role);
      log(
        output.info(
          `\n─── ${role.id} (${role.title || role.type}) [${spec.model}${spec.effort ? ` · ${spec.effort}` : ''}] ───`,
        ),
      );
      log(
        buildRolePrompt(
          // Same org root the live daemon uses (new OrgDaemon(ctx.cwd)).
          expandRolePromptVars(role, promptVarsFor(cwd)),
          { name: def.name, goal: (taskFlag as string | undefined) ?? def.goal },
          roster,
          glossary,
          resolveRoleExtraGuidance(role, cwd),
          role.id === bossId ? endpointBriefingLines(def) : undefined,
        ),
      );
    }
    return { success: true, message: 'dry run complete — no sessions started' };
  } catch (err) {
    log(output.error(`Config invalid: ${err instanceof Error ? err.message : String(err)}`));
    return { success: false, message: 'invalid org config' };
  }
}

// P1-1: v1 deprecation warning. Detect v1-shaped configs and warn.
// Gate on MONOMIND_V1_LEGACY=off to refuse v1 orgs entirely (patch-versioning-
// compliant mechanism — no minor bump needed).
const V1_ORG_KEYS = [
  'topology',
  'consensus',
  'strategy',
  'board_id',
  'todo_col_id',
  'doing_col_id',
  'done_col_id',
  'loop',
];

/** Warn about a v1-shaped org config; returns a failure result when
 *  MONOMIND_V1_LEGACY=off refuses it, otherwise undefined. */
export function checkV1Config(orgsDir: string, name: string): CommandResult | undefined {
  try {
    const rawCfg = JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')) as Record<
      string,
      unknown
    >;
    const isV1 = V1_ORG_KEYS.some((k) => k in rawCfg);
    if (isV1) {
      const v1Legacy = process.env.MONOMIND_V1_LEGACY;
      if (v1Legacy === 'off') {
        log(output.error(`Org "${name}" uses the v1 config format, but MONOMIND_V1_LEGACY=off.`));
        log(
          output.info(
            `Run "monomind org migrate ${name}" to upgrade to v2, or unset MONOMIND_V1_LEGACY to proceed anyway.`,
          ),
        );
        return { success: false, message: 'v1 org blocked by MONOMIND_V1_LEGACY=off' };
      }
      log(
        output.warning(
          `Org "${name}" uses the v1 config format (deprecated). It will be auto-migrated in-memory.`,
        ),
      );
      log(
        output.dim(
          `  To silence: run "monomind org migrate ${name}". To block v1 orgs: set MONOMIND_V1_LEGACY=off.`,
        ),
      );
    }
  } catch {
    /* config parse errors surface later in the cost estimate or daemon.startOrg */
  }
  return undefined;
}

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

// Models absent from MODEL_PRICING (not yet in the canonical pricing table).
const EXTRA_MODEL_RATE_PER_1M: Record<string, number> = {
  'gpt-4': 10,
  'glm-5.2': 2,
  'glm-4': 2,
  'kimi-latest': 3,
  'kimi-k2': 3,
  'kimi-code/k3': 3,
  'kimi-code/k3-256k': 3,
  'gemini-3.1-pro': 8,
  'gemini-3.6-flash-high': 1,
  'gpt-5.6-terra': 10,
  'gpt-5.5': 10,
};
const DEFAULT_RATE_PER_1M = 10;
const AVG_TOKENS_PER_TURN = 2000;
// Estimate against a realistic planning ceiling, NOT the runtime limit —
// the schema default is effectively unlimited (DEFAULT_MAX_TURNS_PER_MESSAGE),
// which would balloon the upfront figure into meaninglessness.
const ESTIMATE_TURNS_CAP = 30;

function modelRatesPer1M(): Record<string, number> {
  const DERIVED_RATE_PER_1M: Record<string, number> = Object.fromEntries(
    Object.entries(MODEL_PRICING).map(([model, price]) => [model, price.out * 1_000_000]),
  );
  return { ...EXTRA_MODEL_RATE_PER_1M, ...DERIVED_RATE_PER_1M };
}

/** User-editable rate overrides: ~/.monomind/rates.json, e.g.
 *    { "claude-opus-5": 90, "my-custom-model": 5 } */
function loadUserRates(): { userRates: Record<string, number>; ratesFileUsed: boolean } {
  const ratesPath = join(homedir(), '.monomind', 'rates.json');
  const userRates: Record<string, number> = {};
  let ratesFileUsed = false;
  try {
    const parsed = JSON.parse(readFileSync(ratesPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number') userRates[k] = v;
      }
      ratesFileUsed = Object.keys(userRates).length > 0;
    }
  } catch {
    /* no rates.json (or invalid) — hardcoded defaults only */
  }
  return { userRates, ratesFileUsed };
}

/** Print the upfront cost estimate and apply --budget-usd / the confirmation
 *  prompt. Returns a failure result when the run must not start, otherwise
 *  undefined (including when the config can't be parsed here). */
export async function printCostEstimate(
  orgsDir: string,
  name: string,
  budgetUsd: number | undefined,
  skipConfirm: boolean,
): Promise<CommandResult | undefined> {
  const MODEL_RATE_PER_1M = modelRatesPer1M();
  const { userRates, ratesFileUsed } = loadUserRates();

  try {
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(join(orgsDir, `${name}.json`), 'utf8')));
    const defaultMaxTurns = def.run_config.max_turns_per_message ?? 30;
    let _totalTokens = 0;
    const perRoleRows = def.roles.map((r) => {
      // The model the runtime will really use (roleRunSpec mirrors session-run.ts):
      // explicit pin > cost tier > runtime/vendor default — an estimate that ignored
      // the tier would quote the untiered price of a run that is about to cost ~3x less.
      const { model } = roleRunSpec(def, r);
      const rate = userRates[model] ?? MODEL_RATE_PER_1M[model] ?? DEFAULT_RATE_PER_1M;
      const roleTurns = Math.min(r.max_turns_per_message ?? defaultMaxTurns, ESTIMATE_TURNS_CAP);
      const tokens = roleTurns * AVG_TOKENS_PER_TURN;
      _totalTokens += tokens;
      return { id: r.id, model, tokens, cost: (tokens * rate) / 1_000_000 };
    });
    const estimate = perRoleRows.reduce((s, r) => s + r.cost, 0);
    log(output.bold('\nCost estimate'));
    log(
      output.dim(
        `  (roles × max_turns × ~${AVG_TOKENS_PER_TURN} tokens/turn × model rate; estimated at ≤${ESTIMATE_TURNS_CAP} turns/message — the runtime default is effectively unlimited; ${ratesFileUsed ? `rates.json overrides + ` : ''}static defaults, will vary with real usage)`,
      ),
    );
    log(
      output.warning(
        `  ⚠ stale rates: no live provider pricing lookup — ${ratesFileUsed ? `using ~/.monomind/rates.json + ` : ''}hardcoded table (edit ~/.monomind/rates.json to override)`,
      ),
    );
    for (const r of perRoleRows) {
      log(`    ${r.id.padEnd(20)} ${r.model.padEnd(22)} ~$${r.cost.toFixed(2)}`);
    }
    log(`  ${output.bold('Total estimate:'.padEnd(28))} ~$${estimate.toFixed(2)}`);
    if (budgetUsd != null && estimate > budgetUsd) {
      log(
        output.error(
          `Estimate $${estimate.toFixed(2)} exceeds --budget-usd $${budgetUsd}. Aborting before any tokens are spent.`,
        ),
      );
      return { success: false, message: 'cost estimate exceeded --budget-usd' };
    }
    if (!skipConfirm && process.stdin.isTTY) {
      const { confirm } = await import('../prompt.js');
      const ok = await confirm({
        message: `Start ${def.roles.length}-role org? This will spend real provider tokens.`,
        default: true,
      });
      if (!ok) {
        log(output.dim('Aborted — no tokens spent.'));
        return { success: false, message: 'user declined cost-estimate prompt' };
      }
    }
  } catch (err) {
    // If the config can't be parsed here, daemon.startOrg (in runAction) will surface a
    // proper error. Don't double-report — just skip the estimate.
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
      log(
        output.dim(`(cost estimate skipped: ${err instanceof Error ? err.message : String(err)})`),
      );
    }
  }
  return undefined;
}
