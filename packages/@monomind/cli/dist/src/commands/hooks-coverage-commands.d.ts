/**
 * Hooks Coverage Commands
 * Coverage-aware routing, progress tracking, and statusline generation.
 * Extracted from hooks.ts to reduce file size.
 */
import type { Command } from '../types.js';
export { coverageRouteCommand } from './hooks-coverage-routing.js';
export { coverageSuggestCommand } from './hooks-coverage-routing.js';
export { coverageGapsCommand } from './hooks-coverage-gaps.js';
export { progressHookCommand } from './hooks-coverage-gaps.js';
export declare const statuslineCommand: Command;
//# sourceMappingURL=hooks-coverage-commands.d.ts.map