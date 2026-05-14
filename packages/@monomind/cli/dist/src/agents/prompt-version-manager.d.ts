/**
 * PromptVersionManager - High-level prompt version lifecycle operations
 *
 * Provides publish-from-file, promote, rollback, and experiment
 * start/stop workflows on top of PromptVersionStore.
 *
 * @module @monomind/cli/agents/prompt-version-manager
 */
type PromptVersionStore = any;
type PromptVersion = any;
type PromptExperiment = any;
export declare class PromptVersionManager {
    private readonly store;
    constructor(store: PromptVersionStore);
    publishFromFile(agentSlug: string, filePath: string, newVersion: string, changelog: string): PromptVersion;
    promote(agentSlug: string, version: string): void;
    rollback(agentSlug: string, stepsBack?: number): void;
    startExperiment(experiment: PromptExperiment): void;
    stopExperiment(agentSlug: string, promoteWinner?: boolean): void;
}
export {};
//# sourceMappingURL=prompt-version-manager.d.ts.map