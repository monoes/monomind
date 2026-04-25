/**
 * Sandbox Provisioner - Factory for creating sandbox runtimes
 *
 * Dispatches to Docker, WASM, or passthrough based on config type.
 *
 * @module v1/security/sandbox/sandbox-provisioner
 */
import { validateSandboxConfig } from './types.js';
import * as WasmSandbox from './wasm-sandbox.js';
import * as DockerSandbox from './docker-sandbox.js';
/**
 * Creates a passthrough runtime that executes nothing (type='none').
 */
function createPassthrough(agentId) {
    return {
        type: 'none',
        agentId,
        async execute(command) {
            return {
                code: 0,
                stdout: `[passthrough] ${command}`,
                stderr: '',
                timedOut: false,
            };
        },
        async destroy() {
            // Nothing to clean up
        },
    };
}
/**
 * Provisions a sandbox runtime for the given agent.
 *
 * @param agentId - Unique agent identifier
 * @param config - Sandbox configuration
 * @returns A SandboxRuntime instance
 * @throws If config type is invalid
 */
export function provision(agentId, config) {
    if (!validateSandboxConfig(config)) {
        throw new Error(`Invalid sandbox config type: ${config.type}`);
    }
    switch (config.type) {
        case 'wasm':
            return WasmSandbox.create(agentId, config);
        case 'docker':
            return DockerSandbox.create(agentId, config);
        case 'none':
            return createPassthrough(agentId);
        default:
            throw new Error(`Unknown sandbox type: ${config.type}`);
    }
}
//# sourceMappingURL=sandbox-provisioner.js.map