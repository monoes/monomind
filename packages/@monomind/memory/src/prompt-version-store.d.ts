/**
 * PromptVersionStore - JSONL-based prompt version management
 *
 * Stores prompt versions and experiments as append-only JSONL files.
 * Supports versioning, A/B experiments, quality scoring, and line-level diffs.
 *
 * File layout:
 *   {dirPath}/versions.jsonl  - one PromptVersion JSON per line
 *   {dirPath}/experiments.jsonl - one PromptExperiment JSON per line
 *
 * @module @monobrain/memory/prompt-version-store
 */
export interface PromptVersion {
    agentSlug: string;
    version: string;
    prompt: string;
    changelog: string;
    activeFrom: Date;
    activeTo?: Date;
    qualityScore?: number;
    traceCount: number;
    publishedBy: string;
    createdAt: Date;
}
export interface PromptExperiment {
    agentSlug: string;
    control: string;
    candidate: string;
    trafficPct: number;
    startedAt: Date;
    endsAt?: Date;
    winnerId?: string;
}
export interface DiffResult {
    agentSlug: string;
    versionA: string;
    versionB: string;
    additions: number;
    deletions: number;
}
export declare class PromptVersionStore {
    private readonly versionsPath;
    private readonly experimentsPath;
    constructor(dirPath: string);
    save(version: PromptVersion): void;
    getActive(agentSlug: string): PromptVersion | null;
    listVersions(agentSlug: string): PromptVersion[];
    setActive(agentSlug: string, version: string): void;
    diff(agentSlug: string, vA: string, vB: string): DiffResult;
    updateQualityScore(agentSlug: string, version: string, score: number): void;
    saveExperiment(exp: PromptExperiment): void;
    getExperiment(agentSlug: string): PromptExperiment | null;
    concludeExperiment(agentSlug: string, winnerId: string): void;
    private readVersions;
    private writeVersions;
    private readExperiments;
    private writeExperiments;
}
//# sourceMappingURL=prompt-version-store.d.ts.map