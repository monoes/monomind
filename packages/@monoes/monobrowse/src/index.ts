// Re-export the full monoplaybook engine so consumers only need @monoes/monobrowse
export * from '@monoes/monoplaybook';

export * from './browser/index.js';
export * from './browser/action-builder/analyzer.js';
export * from './browser/action-builder/types.js';
export * from './browser/adapters/index.js';
export { startDashboard, getDashboard } from './browser/dashboard/server.js';
export { createBuiltinHandlers, createBrowserHandlers } from './browser/playbook/index.js';
export { readAction } from './browser/playbook/store.js';

// Batteries-included handler factory: service nodes + browser automation + builtins.
// This is the recommended entry point when using monobrowse as the default executor.
import { createNodeHandlers } from '@monoes/monoplaybook';
import { createBrowserHandlers } from './browser/playbook/browser-handlers.js';
import { createBuiltinHandlers } from './browser/playbook/builtin-handlers.js';
import type { NodeHandler } from '@monoes/monoplaybook';

export function createDefaultHandlers(): Map<string, NodeHandler> {
  return new Map<string, NodeHandler>([
    ...createNodeHandlers(),
    ...createBrowserHandlers(),
    ...createBuiltinHandlers(),
  ]);
}
