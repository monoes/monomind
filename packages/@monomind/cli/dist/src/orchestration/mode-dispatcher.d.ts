/**
 * ModeDispatcher — selects and executes the correct mode executor
 * based on the requested OrchestrationMode.
 */
import type { AgentDispatcher, CollaborateModeConfig, CoordinateModeConfig, ModeResult, OrchestrationMode, RouteModeConfig } from './routing-modes.js';
export declare class ModeDispatcher {
    private readonly dispatcher;
    constructor(dispatcher: AgentDispatcher);
    dispatchWithMode(mode: OrchestrationMode | undefined, config: RouteModeConfig | CoordinateModeConfig | CollaborateModeConfig): Promise<ModeResult>;
}
//# sourceMappingURL=mode-dispatcher.d.ts.map