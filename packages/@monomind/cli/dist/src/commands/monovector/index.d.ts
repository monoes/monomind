/**
 * CLI MonoVector PostgreSQL Bridge Command
 * Management commands for MonoVector PostgreSQL integration
 *
 * Features:
 * - monovector/pgvector integration for vector operations
 * - Attention mechanism embeddings
 * - Graph Neural Network support
 * - Hyperbolic embeddings (Poincare ball)
 * - Performance benchmarking
 * - Migration management
 *
 * https://github.com/nokhodian/monomind
 */
import type { Command } from '../../types.js';
/**
 * MonoVector PostgreSQL Bridge main command
 */
export declare const monovectorCommand: Command;
export default monovectorCommand;
export { initCommand } from './init.js';
export { setupCommand } from './setup.js';
export { importCommand } from './import.js';
export { migrateCommand } from './migrate.js';
export { statusCommand } from './status.js';
export { benchmarkCommand } from './benchmark.js';
export { optimizeCommand } from './optimize.js';
export { backupCommand } from './backup.js';
//# sourceMappingURL=index.d.ts.map