/**
 * Sandbox Provisioner - Factory for creating sandbox runtimes
 *
 * Dispatches to Docker, WASM, or passthrough based on config type.
 *
 * @module v1/security/sandbox/sandbox-provisioner
 */
import type { SandboxConfig, SandboxRuntime } from './types.js';
/**
 * Provisions a sandbox runtime for the given agent.
 *
 * @param agentId - Unique agent identifier
 * @param config - Sandbox configuration
 * @returns A SandboxRuntime instance
 * @throws If config type is invalid
 */
export declare function provision(agentId: string, config: SandboxConfig): SandboxRuntime;
//# sourceMappingURL=sandbox-provisioner.d.ts.map