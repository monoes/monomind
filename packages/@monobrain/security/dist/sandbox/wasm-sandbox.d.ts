/**
 * WASM Sandbox - Node.js vm-based sandboxed JS execution
 *
 * Uses Node's vm module to run JavaScript in an isolated context.
 * Blocks access to require, process, setTimeout, setInterval, and other
 * host environment globals.
 *
 * @module v1/security/sandbox/wasm-sandbox
 */
import type { SandboxConfig, SandboxRuntime } from './types.js';
/**
 * Creates a WasmSandbox runtime for an agent.
 */
export declare function create(agentId: string, config: SandboxConfig): SandboxRuntime;
//# sourceMappingURL=wasm-sandbox.d.ts.map