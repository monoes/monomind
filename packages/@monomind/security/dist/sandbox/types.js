/**
 * Per-Agent Runtime Sandboxing Types
 *
 * Defines configurations and interfaces for sandboxed agent execution.
 * Supports Docker, WASM (Node vm), and passthrough (none) runtimes.
 *
 * @module v1/security/sandbox/types
 */
/**
 * Validates that a SandboxConfig has a valid type field.
 */
export function validateSandboxConfig(config) {
    const validTypes = ['docker', 'wasm', 'none'];
    return validTypes.includes(config.type);
}
//# sourceMappingURL=types.js.map