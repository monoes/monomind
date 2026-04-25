/**
 * Guidance Hook Integration Layer
 *
 * Wires the EnforcementGates and ShardRetriever into the Monobrain
 * hook lifecycle. Each guidance concern is registered as a hook that
 * participates in the standard HookRegistry event flow.
 *
 * Hook mappings:
 *   PreCommand  -> EnforcementGates.evaluateCommand()  (destructive ops + secrets)
 *   PreToolUse  -> EnforcementGates.evaluateToolUse()   (tool allowlist + secrets)
 *   PreEdit     -> EnforcementGates.evaluateEdit()      (diff size + secrets)
 *   PreTask     -> ShardRetriever.retrieve()            (inject relevant shards)
 *   PostTask    -> RunLedger.finalizeEvent()             (record run completion)
 *
 * @module @monobrain/guidance/hooks
 */
import type { HookResult } from '@monobrain/hooks';
import type { HookRegistry } from '@monobrain/hooks';
import type { EnforcementGates } from './gates.js';
import type { ShardRetriever } from './retriever.js';
import type { RunLedger } from './ledger.js';
import type { GateResult, RunEvent } from './types.js';
/**
 * Convert an array of GateResults into a single HookResult.
 *
 * Severity ordering: block > require-confirmation > warn > allow.
 * The most restrictive decision drives the hook outcome.
 */
declare function gateResultsToHookResult(gateResults: GateResult[]): HookResult;
/**
 * Provides guidance enforcement hooks for the V1 hook system.
 *
 * Registers hooks on a HookRegistry that wire each lifecycle event
 * (PreCommand, PreToolUse, PreEdit, PreTask, PostTask) to the
 * appropriate guidance subsystem (gates, retriever, ledger).
 */
export declare class GuidanceHookProvider {
    private gates;
    private retriever;
    private ledger;
    /** IDs of hooks registered by this provider, for cleanup */
    private hookIds;
    /** Active run events keyed by task ID, for PostTask finalization */
    private activeRuns;
    constructor(gates: EnforcementGates, retriever: ShardRetriever, ledger: RunLedger);
    /**
     * Register all guidance hooks on the given registry.
     *
     * Returns the array of generated hook IDs for tracking.
     */
    registerAll(registry: HookRegistry): string[];
    /**
     * Unregister all hooks previously registered by this provider.
     */
    unregisterAll(registry: HookRegistry): void;
    /**
     * Get the IDs of all registered hooks.
     */
    getHookIds(): string[];
    /**
     * Get the active run event for a given task ID (if any).
     */
    getActiveRun(taskId: string): RunEvent | undefined;
    /**
     * PreCommand handler: evaluate command through destructive ops and secrets gates.
     */
    private handlePreCommand;
    /**
     * PreToolUse handler: evaluate tool usage against allowlist and check params for secrets.
     */
    private handlePreToolUse;
    /**
     * PreEdit handler: evaluate file edit for diff size and secrets.
     *
     * Extracts the file path from context. The content to scan comes from
     * metadata.content or is synthesized from available context. The diff
     * line count defaults to metadata.diffLines or 0.
     */
    private handlePreEdit;
    /**
     * PreTask handler: classify intent and retrieve relevant guidance shards.
     *
     * Creates a new RunEvent in the active runs map for PostTask finalization.
     * Returns the retrieved policy text and shards as hook data.
     */
    private handlePreTask;
    /**
     * PostTask handler: finalize the run event in the ledger.
     *
     * Looks up the active run by task ID, populates completion metadata,
     * and calls ledger.finalizeEvent().
     */
    private handlePostTask;
}
/**
 * Create a GuidanceHookProvider and optionally register it on a registry.
 *
 * @param gates - The enforcement gates instance
 * @param retriever - The shard retriever instance
 * @param ledger - The run ledger instance
 * @param registry - Optional registry to auto-register on
 * @returns The provider and (if registry was given) the hook IDs
 */
export declare function createGuidanceHooks(gates: EnforcementGates, retriever: ShardRetriever, ledger: RunLedger, registry?: HookRegistry): {
    provider: GuidanceHookProvider;
    hookIds: string[];
};
export { gateResultsToHookResult };
//# sourceMappingURL=hooks.d.ts.map