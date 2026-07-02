/**
 * Agent lifecycle commands — spawn, list, status, stop
 */
import type { Command } from '../types.js';
export declare function updateSwarmActivityMetrics(agentCountDelta: number): void;
export declare const AGENT_TYPES: {
    value: string;
    label: string;
    hint: string;
}[];
export declare function getAgentCapabilities(type: string): string[];
export declare function formatStatus(status: unknown): string;
export declare const spawnCommand: Command;
export declare const listCommand: Command;
export declare const statusCommand: Command;
export declare const stopCommand: Command;
//# sourceMappingURL=agent-lifecycle.d.ts.map