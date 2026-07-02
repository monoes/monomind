/**
 * Hive Mind spawn infrastructure — spawnClaudeCodeInstance and spawnCommand
 */
import type { Command } from '../types.js';
import { type HiveWorker } from './hive-mind-helpers.js';
export declare function spawnClaudeCodeInstance(swarmId: string, swarmName: string, objective: string, workers: HiveWorker[], flags: Record<string, unknown>): Promise<{
    success: boolean;
    promptFile?: string;
    error?: string;
}>;
export declare const spawnCommand: Command;
//# sourceMappingURL=hive-mind-spawn.d.ts.map