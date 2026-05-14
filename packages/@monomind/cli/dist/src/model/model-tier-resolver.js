/**
 * Resolves the concrete model tier for a given agent + task combination.
 *
 * Resolution order:
 *   1. Orchestrator override (explicit)
 *   2. Complexity-based automatic selection
 *   3. Agent preference default
 *   4. Fallback to sonnet
 */
import { TIER_DEFAULTS } from './model-settings.js';
import { scoreComplexity, HIGH_COMPLEXITY_AGENTS } from './complexity-scorer.js';
// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------
/**
 * Determine the best model tier for a task.
 *
 * @param agentSlug            - The agent that will execute the task.
 * @param taskDescription      - Free-text task description.
 * @param agentPreference      - Optional per-agent preference.
 * @param orchestratorOverride - Optional hard override from the orchestrator.
 */
export function resolveModelTier(agentSlug, taskDescription, agentPreference, orchestratorOverride) {
    const complexity = scoreComplexity(taskDescription, agentSlug);
    // ----- 1. Orchestrator override ------------------------------------------
    if (orchestratorOverride?.model) {
        return buildResult(orchestratorOverride.model, complexity, 'orchestrator_override', agentPreference);
    }
    // ----- 2. Complexity-based selection -------------------------------------
    const preferredDefault = agentPreference?.default ?? 'sonnet';
    let tier;
    let reason;
    if (complexity < 30 && preferredDefault !== 'opus') {
        tier = 'haiku';
        reason = 'low_complexity';
    }
    else if (complexity >= 70 || HIGH_COMPLEXITY_AGENTS.has(agentSlug)) {
        tier = 'opus';
        reason = complexity >= 70 ? 'high_complexity' : 'high_complexity_agent';
    }
    else {
        tier = preferredDefault;
        reason = 'default_preference';
    }
    return buildResult(tier, complexity, reason, agentPreference);
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildResult(tier, complexityScore, resolutionReason, preference) {
    const base = { ...TIER_DEFAULTS[tier] };
    // Propagate preference overrides
    if (preference?.maxCostUsd !== undefined) {
        base.maxCostUsd = preference.maxCostUsd;
    }
    if (preference?.extendedThinking !== undefined) {
        base.extendedThinking = preference.extendedThinking;
    }
    return {
        ...base,
        complexityScore,
        resolutionReason,
    };
}
//# sourceMappingURL=model-tier-resolver.js.map