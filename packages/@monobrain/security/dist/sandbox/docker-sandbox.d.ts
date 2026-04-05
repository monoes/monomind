/**
 * Docker Sandbox - Container-based agent isolation
 *
 * Wraps Docker CLI to provide per-agent container sandboxing.
 * Tests should mock the exec function rather than running Docker.
 *
 * @module v1/security/sandbox/docker-sandbox
 */
import type { SandboxConfig, SandboxRuntime } from './types.js';
/**
 * Builds Docker CLI arguments from a SandboxConfig.
 * Exported for direct testing.
 */
export declare function buildDockerArgs(agentId: string, config: SandboxConfig): string[];
/**
 * Creates a DockerSandbox runtime for an agent.
 *
 * @param agentId - Unique agent identifier
 * @param config - Sandbox configuration
 * @param execFn - Optional exec override for testing
 */
export declare function create(agentId: string, config: SandboxConfig, execFn?: (cmd: string) => Promise<{
    stdout: string;
    stderr: string;
}>): SandboxRuntime;
//# sourceMappingURL=docker-sandbox.d.ts.map