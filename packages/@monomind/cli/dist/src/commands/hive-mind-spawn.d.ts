/**
 * Hive Mind spawn infrastructure — spawnClaudeCodeInstance and spawnCommand
 */
import type { Command } from '../types.js';
import { MAX_AGENT_ID_LEN, type HiveWorker } from './hive-mind-helpers.js';
export declare function spawnClaudeCodeInstance(swarmId: string, swarmName: string, objective: string, workers: HiveWorker[], flags: Record<string, unknown>): Promise<{
    success: boolean;
    promptFile?: string;
    error?: string;
}>;
export declare const spawnCommand: Command;
export { MAX_AGENT_ID_LEN };
//# sourceMappingURL=hive-mind-spawn.d.ts.map