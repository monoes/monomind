import type { WorkflowDef, NodeDef, Item, RunRecord, StepEvent } from './types.js';
export declare class DagError extends Error {
    constructor(message: string);
}
export declare function buildDag(wf: WorkflowDef): string[];
export interface RunOptions {
    items?: Item[];
    params?: Record<string, string>;
    signal?: AbortSignal;
    onEvent?: (event: StepEvent) => void;
    executeNode?: NodeExecutor;
}
export type NodeExecutor = (node: NodeDef, items: Item[], nodeOutputs: Record<string, Item[]>, params: Record<string, string>, signal?: AbortSignal) => Promise<Item[]>;
export declare function runWorkflow(wf: WorkflowDef, options?: RunOptions): Promise<RunRecord>;
//# sourceMappingURL=engine.d.ts.map