/**
 * ModeDispatcher — selects and executes the correct mode executor
 * based on the requested OrchestrationMode.
 */
import { CollaborateModeExecutor, CoordinateModeExecutor, RouteModeExecutor, } from './routing-modes.js';
export class ModeDispatcher {
    dispatcher;
    constructor(dispatcher) {
        this.dispatcher = dispatcher;
    }
    async dispatchWithMode(mode = 'route', config) {
        switch (mode) {
            case 'route': {
                const executor = new RouteModeExecutor(this.dispatcher);
                return executor.execute(config);
            }
            case 'coordinate': {
                const executor = new CoordinateModeExecutor(this.dispatcher);
                return executor.execute(config);
            }
            case 'collaborate': {
                const executor = new CollaborateModeExecutor(this.dispatcher);
                return executor.execute(config);
            }
            default: {
                throw new Error(`Unknown orchestration mode: ${mode}`);
            }
        }
    }
}
//# sourceMappingURL=mode-dispatcher.js.map