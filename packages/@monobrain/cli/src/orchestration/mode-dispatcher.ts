/**
 * ModeDispatcher — selects and executes the correct mode executor
 * based on the requested OrchestrationMode.
 */

import type {
  AgentDispatcher,
  CollaborateModeConfig,
  CoordinateModeConfig,
  ModeResult,
  OrchestrationMode,
  RouteModeConfig,
} from './routing-modes.js';

import {
  CollaborateModeExecutor,
  CoordinateModeExecutor,
  RouteModeExecutor,
} from './routing-modes.js';

export class ModeDispatcher {
  constructor(private readonly dispatcher: AgentDispatcher) {}

  async dispatchWithMode(
    mode: OrchestrationMode = 'route',
    config: RouteModeConfig | CoordinateModeConfig | CollaborateModeConfig,
  ): Promise<ModeResult> {
    switch (mode) {
      case 'route': {
        const executor = new RouteModeExecutor(this.dispatcher);
        return executor.execute(config as RouteModeConfig);
      }
      case 'coordinate': {
        const executor = new CoordinateModeExecutor(this.dispatcher);
        return executor.execute(config as CoordinateModeConfig);
      }
      case 'collaborate': {
        const executor = new CollaborateModeExecutor(this.dispatcher);
        return executor.execute(config as CollaborateModeConfig);
      }
      default: {
        throw new Error(`Unknown orchestration mode: ${mode}`);
      }
    }
  }
}
