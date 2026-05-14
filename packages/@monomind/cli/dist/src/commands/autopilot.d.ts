/**
 * CLI Autopilot Command
 * Persistent swarm completion — keeps agents working until ALL tasks are done.
 *
 * ADR-072: Autopilot Integration
 */
import type { Command } from '../types.js';
export declare function autopilotCheck(): Promise<{
    allowStop: boolean;
    reason: string;
    continueWith?: string;
}>;
export declare const autopilotCommand: Command;
export default autopilotCommand;
//# sourceMappingURL=autopilot.d.ts.map