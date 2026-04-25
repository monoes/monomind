/**
 * Sandbox Registry - Tracks active sandbox runtimes
 *
 * Static registry for managing the lifecycle of per-agent sandboxes.
 *
 * @module v1/security/sandbox/sandbox-registry
 */
import type { SandboxRuntime } from './types.js';
/**
 * Register an active sandbox runtime.
 */
export declare function register(agentId: string, runtime: SandboxRuntime): void;
/**
 * Retrieve a sandbox runtime by agent ID.
 */
export declare function get(agentId: string): SandboxRuntime | undefined;
/**
 * Clean up and remove a single sandbox.
 */
export declare function cleanup(agentId: string): Promise<void>;
/**
 * Clean up and remove all active sandboxes.
 */
export declare function cleanupAll(): Promise<void>;
/**
 * List all active sandbox agent IDs.
 */
export declare function listActive(): string[];
//# sourceMappingURL=sandbox-registry.d.ts.map