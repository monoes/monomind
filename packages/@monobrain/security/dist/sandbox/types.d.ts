/**
 * Per-Agent Runtime Sandboxing Types
 *
 * Defines configurations and interfaces for sandboxed agent execution.
 * Supports Docker, WASM (Node vm), and passthrough (none) runtimes.
 *
 * @module v1/security/sandbox/types
 */
/**
 * Sandbox runtime type.
 * - 'docker': Full container isolation
 * - 'wasm': Node.js vm-based sandboxing for JS execution
 * - 'none': Passthrough, no sandboxing
 */
export type SandboxType = 'docker' | 'wasm' | 'none';
/**
 * Network mode for Docker sandboxes.
 */
export type NetworkMode = 'none' | 'bridge' | 'host';
/**
 * Configuration for provisioning a sandbox runtime.
 */
export interface SandboxConfig {
    /** Sandbox type */
    type: SandboxType;
    /** Docker image (docker type only) */
    image?: string;
    /** Paths allowed for read/write access */
    allowed_paths?: string[];
    /** Paths mounted as read-only */
    read_only_paths?: string[];
    /** Network mode (docker type only) */
    network?: NetworkMode;
    /** CPU limit (e.g. '0.5' for half a core) */
    cpu_limit?: string;
    /** Memory limit (e.g. '256m') */
    memory_limit?: string;
    /** Environment variables to inject */
    env_vars?: Record<string, string>;
    /** Execution timeout in milliseconds */
    timeout_ms?: number;
    /** Automatically clean up sandbox on destroy */
    auto_cleanup?: boolean;
    /** WASM memory pages (wasm type only) */
    wasm_memory_pages?: number;
    /** Allowed import specifiers (wasm type only) */
    wasm_allowed_imports?: string[];
}
/**
 * Result of executing a command/code in a sandbox.
 */
export interface SandboxExecResult {
    /** Exit code (0 = success) */
    code: number;
    /** Standard output */
    stdout: string;
    /** Standard error */
    stderr: string;
    /** Whether the execution timed out */
    timedOut: boolean;
}
/**
 * Runtime interface for an active sandbox instance.
 */
export interface SandboxRuntime {
    /** Sandbox type */
    type: SandboxType;
    /** The agent this sandbox belongs to */
    agentId: string;
    /** Execute a command or code snippet */
    execute(command: string, timeoutMs?: number): Promise<SandboxExecResult>;
    /** Destroy and clean up the sandbox */
    destroy?(): Promise<void>;
    /** Get runtime statistics */
    getStats?(): Promise<Record<string, unknown>>;
}
/**
 * Validates that a SandboxConfig has a valid type field.
 */
export declare function validateSandboxConfig(config: SandboxConfig): boolean;
//# sourceMappingURL=types.d.ts.map