/**
 * PromptExperimentRouter - A/B traffic splitting for prompt versions
 *
 * Checks for an active experiment on the given agent slug and probabilistically
 * routes to the candidate or control version. Falls back to the active version
 * when no experiment is running.
 *
 * @module @monomind/cli/agents/prompt-experiment
 */
export class PromptExperimentRouter {
    store;
    constructor(store) {
        this.store = store;
    }
    resolvePromptForSpawn(agentSlug) {
        const experiment = this.store.getExperiment(agentSlug);
        if (experiment) {
            const useCandidate = Math.random() < experiment.trafficPct;
            const targetVersion = useCandidate ? experiment.candidate : experiment.control;
            const versions = this.store.listVersions(agentSlug);
            const found = versions.find((v) => v.version === targetVersion);
            if (found) {
                return {
                    prompt: found.prompt,
                    version: found.version,
                    isCandidate: useCandidate,
                    agentSlug,
                };
            }
        }
        // Fallback to active version
        const active = this.store.getActive(agentSlug);
        if (active) {
            return {
                prompt: active.prompt,
                version: active.version,
                isCandidate: false,
                agentSlug,
            };
        }
        return {
            prompt: '',
            version: '',
            isCandidate: false,
            agentSlug,
        };
    }
}
//# sourceMappingURL=prompt-experiment.js.map