/**
 * CLI Hooks Command
 * Self-learning hooks system for intelligent workflow automation
 *
 * This file is the main registration entry point.
 * Commands are extracted to sub-modules (ARCH-1):
 *   - hooks-core-commands.ts    — pre/post edit and command hooks
 *   - hooks-routing-commands.ts — route/explain/pretrain/build-agents/metrics/transfer/list
 *   - hooks-workers.ts          — intelligence and worker commands
 *   - hooks-coverage-commands.ts — coverage-aware routing
 *   - hooks-extended-commands.ts — token optimize, model routing, agent teams
 */
import type { Command } from '../types.js';
export declare const hooksCommand: Command;
export default hooksCommand;
//# sourceMappingURL=hooks.d.ts.map