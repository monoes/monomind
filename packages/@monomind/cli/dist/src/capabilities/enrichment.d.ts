import type { EnrichmentState, EnrichmentTier, FileEntry } from './types.js';
import type { CapabilityManager } from './manager.js';
export interface EnrichmentSummary {
    total: number;
    fullyEnriched: number;
    t0Done: number;
    t1Done: number;
    t2Done: number;
}
export interface EnrichmentStatusReport {
    paused: boolean;
    summary: EnrichmentSummary;
}
export declare class EnrichmentPipeline {
    private state;
    private _paused;
    private manager?;
    constructor(manager?: CapabilityManager);
    get isPaused(): boolean;
    markDone(filePath: string, tier: EnrichmentTier): void;
    markQueued(filePath: string, tier: EnrichmentTier): void;
    markFailed(filePath: string, tier: EnrichmentTier): void;
    markSkipped(filePath: string, tier: EnrichmentTier): void;
    getState(): EnrichmentState;
    getSummary(): EnrichmentSummary;
    getStatus(): EnrichmentStatusReport;
    pause(): void;
    resume(): void;
    /**
     * Run a single enrichment tier over the given files using the active
     * capability modules from the CapabilityManager (if provided).
     *
     * - t0/t1: each active module's `index()` is invoked (T0 = metadata,
     *   T1 = content indexing; capability modules decide internally how to
     *   split the work between these tiers).
     * - t2: each active module's optional `enrich()` is invoked; modules
     *   without an `enrich()` implementation have their files marked skipped.
     */
    runTier(tier: EnrichmentTier, files: FileEntry[], monomindDir?: string): Promise<void>;
    saveState(monomindDir: string): void;
    loadState(monomindDir: string): void;
    private ensureEntry;
}
//# sourceMappingURL=enrichment.d.ts.map