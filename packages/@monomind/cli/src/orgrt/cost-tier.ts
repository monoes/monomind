// packages/@monomind/cli/src/orgrt/cost-tier.ts
/**
 * ADR-O001 D8 — cost tiers: a named cost level that sets BOTH the model AND
 * the reasoning/thinking effort for a role, on whatever provider that role
 * runs on.
 *
 * Measured on one real org run, holding volume constant: all-Opus $1,744,
 * as-run blended $1,050, all-Sonnet $698, all-Haiku $349. Tiering is roughly
 * a 3x win and is independent of every other D-decision.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DO NOT TIER A DELIBERATIVE ROLE INTO A WEAK VOICE.
 *
 * ADR-O001, "What this does NOT apply to — deliberation and debate":
 *
 *     "do not tier a debate participant into a weak voice. Tier by
 *      *difficulty of the judgement*, not by role label. A cheap model in a
 *      debate produces cheap arguments and the synthesiser cannot tell."
 *
 * Tier by how hard the judgement is, not by what the role is called. A role
 * whose value is the quality of its disagreement — a design reviewer, a
 * red-teamer, a debate participant, a synthesiser reading every position —
 * belongs at `"exempt"` (see EXEMPT_TIER), which opts it out of tiering
 * entirely and leaves its model exactly as it was. Control its cost with a
 * budget (D1), not with a cheaper model.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Three properties this deliberately has:
 *
 *  - **Defaulted off.** An org that declares no `cost_tiers` resolves to
 *    `undefined` here and behaves byte-identically to before. Asserted by
 *    org-cost-tier.test.ts, not merely promised by this comment.
 *
 *  - **Provider-agnostic.** A tier is a table keyed by *provider key* — a
 *    Vercel vendor slug (`glm`, `openai`, …) when the role has one, else the
 *    role's runtime id (`codex`, `kimicode`, `claude`, …). The built-in
 *    catalog covers Claude only (the default and the only provider whose
 *    model ids and effort mechanism this repo can verify); every other
 *    provider — including one this code has never heard of — is declared in
 *    the org config with no code change.
 *
 *  - **Never a silent downgrade.** If a tier has no entry for a role's
 *    provider, resolution THROWS (and `validateCostTiers` reports it at org
 *    start, before a token is spent) rather than quietly picking something.
 *
 * Effort is abstract here (`off | low | medium | high | xhigh | max`, the
 * Claude Agent SDK's own vocabulary plus an explicit `off`). Each provider
 * expresses it its own way:
 *   - Claude: natively — session.ts hands it to the runner, which sets the
 *     SDK's `effort` option (or `thinking: {type:'disabled'}` for `off`).
 *   - Any other provider: whatever env vars the org declares under
 *     `cost_tiers.providers.<key>.effort_env.<level>`, merged into the
 *     session env. Providers that encode effort in the model id instead
 *     (e.g. `gemini-3.6-flash-high`) need nothing extra — name the model
 *     you want per tier.
 *   - A provider with no mechanism at all simply ignores the level.
 */

import type { OrgDef, OrgRole } from './types.js';

/** Abstract reasoning-effort level. Mirrors the Claude Agent SDK's
 *  `EffortLevel` ('low' | 'medium' | 'high' | 'xhigh' | 'max') plus an
 *  explicit 'off' meaning "no extended thinking at all". */
export const ORG_EFFORT_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OrgEffortLevel = (typeof ORG_EFFORT_LEVELS)[number];

/** Reserved tier name: this role is not tiered at all. See the header. */
export const EXEMPT_TIER = 'exempt';

/** What one tier resolves to for one provider. */
export interface CostTierEntry {
  model: string;
  effort?: OrgEffortLevel;
}

/** A tier: provider key → entry. */
export type CostTierDef = Record<string, CostTierEntry>;

/** How one provider expresses an effort level, when it can. */
export interface CostTierProviderDef {
  /** Env vars to set for the session, per effort level. */
  effort_env?: Partial<Record<OrgEffortLevel, Record<string, string>>>;
}

/** The org's `cost_tiers` block. */
export interface CostTiersConfig {
  /** Tier applied to every role that has no entry in `roles`. */
  default?: string;
  /** Per-role assignment. A bare string is a tier name (or `"exempt"`);
   *  the object form additionally overrides the tier's effort, which is how
   *  "patrol roles drop effort since they do simpler, more repetitive work"
   *  is expressed without minting a whole extra tier. */
  roles?: Record<string, string | { tier: string; effort?: OrgEffortLevel }>;
  /** User catalog. Merged OVER the built-in catalog per tier, per provider —
   *  so adding `{economy: {codex: …}}` extends built-in `economy` rather than
   *  replacing its `claude` entry. */
  tiers?: Record<string, CostTierDef>;
  /** Per-provider effort expression. */
  providers?: Record<string, CostTierProviderDef>;
}

/** Built-in catalog. Claude only, on purpose: these are the model ids and the
 *  effort mechanism this repo can actually verify. Tiering a role on any other
 *  provider means naming that provider's models in `cost_tiers.tiers` — which
 *  is the honest alternative to inventing model ids and downgrading a role
 *  onto a string nobody checked. */
export const BUILTIN_COST_TIERS: Record<string, CostTierDef> = {
  standard: {
    claude: { model: 'claude-opus-5', effort: 'high' },
    anthropic: { model: 'claude-opus-5', effort: 'high' },
  },
  economy: {
    claude: { model: 'claude-sonnet-5', effort: 'medium' },
    anthropic: { model: 'claude-sonnet-5', effort: 'medium' },
  },
  budget: {
    claude: { model: 'claude-haiku-4-5', effort: 'low' },
    anthropic: { model: 'claude-haiku-4-5', effort: 'low' },
  },
};

/** Thrown when a tier cannot resolve a model for a role's provider, or names
 *  a tier that does not exist. Never swallowed into a default — see header. */
export class CostTierError extends Error {}

/** The provider key a role tiers under: its Vercel vendor slug when it has
 *  one (that is what actually picks the model), else its runtime id, else the
 *  org's runtime, else 'claude'. Mirrors resolveModel()'s own vendor-then-
 *  runtime precedence in session.ts. */
export function costTierProviderKey(
  role: Pick<OrgRole, 'runtime' | 'provider'>,
  orgRuntime?: string,
  vendor?: string,
): string {
  return vendor ?? role.provider?.vendor ?? role.runtime ?? orgRuntime ?? 'claude';
}

/** What a role's tier resolved to. */
export interface ResolvedCostTier {
  tier: string;
  provider: string;
  model: string;
  effort?: OrgEffortLevel;
  /** Env vars expressing `effort` for this provider; `{}` when the provider
   *  has no env mechanism (Claude, which is handled natively, or a provider
   *  with none at all). */
  env: Record<string, string>;
}

function catalogFor(config: CostTiersConfig, tier: string): CostTierDef | undefined {
  const builtin = BUILTIN_COST_TIERS[tier];
  const user = config.tiers?.[tier];
  if (!builtin && !user) return undefined;
  return { ...builtin, ...user };
}

/** The tier name assigned to a role, or undefined when it is untiered. */
function assignmentFor(
  config: CostTiersConfig,
  roleId: string,
): { tier: string; effort?: OrgEffortLevel } | undefined {
  const entry = config.roles?.[roleId];
  if (typeof entry === 'string') return { tier: entry };
  if (entry) return entry;
  return config.default ? { tier: config.default } : undefined;
}

/**
 * Resolve the cost tier for one role. Returns `undefined` when the org
 * declares no tiers, when the role is assigned none, or when it is
 * `"exempt"` — all of which mean "leave this role exactly as it was".
 *
 * Throws CostTierError when a tier IS assigned but cannot be honoured, so a
 * misconfigured tier is a loud failure rather than a silent downgrade.
 */
export function resolveRoleCostTier(args: {
  role: OrgRole;
  def?: Pick<OrgDef, 'runtime' | 'cost_tiers'> & Record<string, unknown>;
  /** Vendor override, when the caller already resolved a named provider's
   *  vendor (session.ts does). */
  vendor?: string;
}): ResolvedCostTier | undefined {
  const config = args.def?.cost_tiers as CostTiersConfig | undefined;
  if (!config) return undefined;

  const assignment = assignmentFor(config, args.role.id);
  if (!assignment || assignment.tier === EXEMPT_TIER) return undefined;

  const tier = catalogFor(config, assignment.tier);
  if (!tier) {
    throw new CostTierError(
      `cost tier "${assignment.tier}" is not defined (built-in tiers: ${Object.keys(
        BUILTIN_COST_TIERS,
      ).join(', ')}; add it under cost_tiers.tiers, or use "${EXEMPT_TIER}" to opt this role out)`,
    );
  }

  const provider = costTierProviderKey(
    args.role,
    args.def?.runtime as string | undefined,
    args.vendor,
  );
  const entry = tier[provider];
  if (!entry) {
    throw new CostTierError(
      `cost tier "${assignment.tier}" has no model for provider "${provider}" ` +
        `(define cost_tiers.tiers.${assignment.tier}.${provider} = { "model": "…", "effort": "…" }, ` +
        `or set this role's tier to "${EXEMPT_TIER}") — refusing to guess a cheaper model`,
    );
  }

  const effort = assignment.effort ?? entry.effort;
  const env = (effort && config.providers?.[provider]?.effort_env?.[effort]) ?? {};
  return { tier: assignment.tier, provider, model: entry.model, effort, env };
}

/**
 * Every cost-tier problem in an org definition, as human-readable lines.
 * Empty for an org that declares no tiers (the upgrade-safe case). Called by
 * the daemon before it spawns anything — a tier that cannot resolve must fail
 * the run at start, not ten minutes and a wrong model later.
 */
export function validateCostTiers(def: OrgDef): string[] {
  const config = (def as { cost_tiers?: CostTiersConfig }).cost_tiers;
  if (!config) return [];
  const errors: string[] = [];

  // A `default` or per-role tier naming a tier nobody defined is an error even
  // if no role happens to reach it — it is always a typo.
  const named = new Set<string>();
  if (config.default) named.add(config.default);
  for (const entry of Object.values(config.roles ?? {})) {
    named.add(typeof entry === 'string' ? entry : entry.tier);
  }
  for (const tier of named) {
    if (tier === EXEMPT_TIER) continue;
    if (!catalogFor(config, tier)) {
      errors.push(
        `cost_tiers: tier "${tier}" is not defined (built-in: ${Object.keys(BUILTIN_COST_TIERS).join(', ')})`,
      );
    }
  }

  for (const role of def.roles ?? []) {
    if (role.kind === 'endpoint') continue; // endpoint roles run no model session
    try {
      resolveRoleCostTier({ role, def });
    } catch (err) {
      if (!(err instanceof CostTierError)) throw err;
      // The "tier not defined" case is already reported once above, by name.
      if (err.message.startsWith('cost tier') && err.message.includes('is not defined')) continue;
      errors.push(`cost_tiers: role "${role.id}" — ${err.message}`);
    }
  }
  return errors;
}
