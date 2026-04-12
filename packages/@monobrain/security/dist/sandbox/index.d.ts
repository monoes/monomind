/**
 * Per-Agent Runtime Sandboxing
 *
 * Provides Docker, WASM (vm), and passthrough sandbox runtimes
 * for isolating agent execution environments.
 *
 * @module v1/security/sandbox
 */
export type { SandboxType, NetworkMode, SandboxConfig, SandboxExecResult, SandboxRuntime, } from './types.js';
export { validateSandboxConfig } from './types.js';
export * as WasmSandbox from './wasm-sandbox.js';
export * as DockerSandbox from './docker-sandbox.js';
export { provision } from './sandbox-provisioner.js';
export { register, get, cleanup, cleanupAll, listActive, } from './sandbox-registry.js';
//# sourceMappingURL=index.d.ts.map