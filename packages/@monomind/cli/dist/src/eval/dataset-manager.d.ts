import type { EvalDataset, EvalDatasetEntry, EvalTrace } from '../../../shared/src/types/eval.js';
export interface CreateFromTracesOpts {
    name: string;
    description: string;
    traces: EvalTrace[];
    agentSlugs?: string[];
}
export declare class DatasetManager {
    private datasetsPath;
    private entriesPath;
    constructor(datasetsPath: string, entriesPath: string);
    /**
     * Create a dataset from a set of filtered traces.
     */
    createFromTraces(opts: CreateFromTracesOpts): EvalDataset;
    /**
     * List all datasets.
     */
    listDatasets(): EvalDataset[];
    /**
     * Get entries for a specific dataset.
     */
    getEntries(datasetId: string): EvalDatasetEntry[];
    /**
     * Add a single trace to an existing dataset.
     */
    addTraceToDataset(datasetId: string, traceId: string): EvalDatasetEntry;
    /**
     * Export a dataset to a JSON file. Output path must be within `allowedRoot`.
     */
    exportToFile(datasetId: string, outputPath: string, allowedRoot?: string): void;
}
//# sourceMappingURL=dataset-manager.d.ts.map