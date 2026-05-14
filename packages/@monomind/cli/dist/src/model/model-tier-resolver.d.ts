/**
 * Resolves the concrete model tier for a given agent + task combination.
 *
 * Resolution order:
 *   1. Orchestrator override (explicit)
 *   2. Complexity-based automatic selection
 *   3. Agent preference default
 *   4. Fallback to sonnet
 */
import type { ModelSettings, ModelPreference } from './model-settings.js';
export interface ResolvedModelSettings extends ModelSettings {
    complexityScore: number;
    resolutionReason: string;
}
/**
 * Determine the best model tier for a task.
 *
 * @param agentSlug            - The agent that will execute the task.
 * @param taskDescription      - Free-text task description.
 * @param agentPreference      - Optional per-agent preference.
 * @param orchestratorOverride - Optional hard override from the orchestrator.
 */
export declare function resolveModelTier(agentSlug: string, taskDescription: string, agentPreference?: ModelPreference, orchestratorOverride?: Partial<ModelSettings>): ResolvedModelSettings;
//# sourceMappingURL=model-tier-resolver.d.ts.map