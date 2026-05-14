/**
 * PromptExperimentRouter - A/B traffic splitting for prompt versions
 *
 * Checks for an active experiment on the given agent slug and probabilistically
 * routes to the candidate or control version. Falls back to the active version
 * when no experiment is running.
 *
 * @module @monomind/cli/agents/prompt-experiment
 */
type PromptVersionStore = any;
export interface ResolvedPrompt {
    prompt: string;
    version: string;
    isCandidate: boolean;
    agentSlug: string;
}
export declare class PromptExperimentRouter {
    private readonly store;
    constructor(store: PromptVersionStore);
    resolvePromptForSpawn(agentSlug: string): ResolvedPrompt;
}
export {};
//# sourceMappingURL=prompt-experiment.d.ts.map