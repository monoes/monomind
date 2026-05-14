/**
 * Three-Mode Team Routing — Task 22
 *
 * Provides three orchestration modes:
 *  - route:       single-agent dispatch
 *  - coordinate:  planner → fan-out → synthesizer
 *  - collaborate: iterative A↔B with shared scratchpad
 */
export type OrchestrationMode = 'route' | 'coordinate' | 'collaborate';
export interface RouteModeConfig {
    agentSlug: string;
    task: string;
}
export interface CoordinateModeConfig {
    plannerSlug?: string;
    synthesizerSlug?: string;
    task: string;
    maxSubtasks?: number;
}
export interface CollaborateModeConfig {
    agentA: string;
    agentB: string;
    task: string;
    maxIterations?: number;
    convergencePhrase?: string;
}
export interface ModeResult {
    mode: OrchestrationMode;
    output: unknown;
    agentsInvolved: string[];
    iterationCount: number;
    tokenUsage: {
        input: number;
        output: number;
    };
    latencyMs: number;
}
export interface AgentDispatcher {
    dispatch(agentSlug: string, task: string, context?: string): Promise<{
        output: unknown;
        tokenUsage?: {
            input: number;
            output: number;
        };
    }>;
}
export declare abstract class ModeExecutor<TConfig> {
    protected readonly dispatcher: AgentDispatcher;
    constructor(dispatcher: AgentDispatcher);
    abstract execute(config: TConfig): Promise<ModeResult>;
}
export declare class RouteModeExecutor extends ModeExecutor<RouteModeConfig> {
    execute(config: RouteModeConfig): Promise<ModeResult>;
}
/**
 * Extract a subtasks array from the planner output.
 * Accepts either a raw array or JSON containing a `subtasks` key.
 */
export declare function parsePlan(output: unknown): string[];
export declare class CoordinateModeExecutor extends ModeExecutor<CoordinateModeConfig> {
    execute(config: CoordinateModeConfig): Promise<ModeResult>;
    private addTokens;
}
export declare class CollaborateModeExecutor extends ModeExecutor<CollaborateModeConfig> {
    execute(config: CollaborateModeConfig): Promise<ModeResult>;
    private addTokens;
}
//# sourceMappingURL=routing-modes.d.ts.map