/**
 * WASM Agent CLI Subcommands
 *
 * Exposes @monoes/rvagent-wasm operations via the `agent` CLI command.
 * Wraps functions from monovector/agent-wasm.ts for CLI usage.
 */
import type { Command } from '../types.js';
export declare const wasmStatusCommand: Command;
export declare const wasmCreateCommand: Command;
export declare const wasmPromptCommand: Command;
export declare const wasmGalleryCommand: Command;
/** All WASM subcommands for the agent command */
export declare const wasmSubcommands: Command[];
//# sourceMappingURL=agent-wasm.d.ts.map