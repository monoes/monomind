/**
 * Docker Sandbox - Container-based agent isolation
 *
 * Wraps Docker CLI to provide per-agent container sandboxing.
 * Tests should mock the exec function rather than running Docker.
 *
 * @module v1/security/sandbox/docker-sandbox
 */
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(execCb);
/**
 * Builds Docker CLI arguments from a SandboxConfig.
 * Exported for direct testing.
 */
export function buildDockerArgs(agentId, config) {
    const args = [];
    // Container name
    args.push('--name', `monobrain-sandbox-${agentId}`);
    // CPU limit
    if (config.cpu_limit) {
        args.push('--cpus', config.cpu_limit);
    }
    // Memory limit
    if (config.memory_limit) {
        args.push('--memory', config.memory_limit);
    }
    // Network mode
    args.push('--network', config.network ?? 'none');
    // Security options
    args.push('--security-opt', 'no-new-privileges');
    args.push('--read-only');
    // Environment variables
    if (config.env_vars) {
        for (const [key, value] of Object.entries(config.env_vars)) {
            args.push('-e', `${key}=${value}`);
        }
    }
    // Allowed paths (read-write mounts)
    if (config.allowed_paths) {
        for (const p of config.allowed_paths) {
            args.push('-v', `${p}:${p}:rw`);
        }
    }
    // Read-only paths
    if (config.read_only_paths) {
        for (const p of config.read_only_paths) {
            args.push('-v', `${p}:${p}:ro`);
        }
    }
    // Auto-remove on exit
    if (config.auto_cleanup) {
        args.push('--rm');
    }
    return args;
}
/**
 * Creates a DockerSandbox runtime for an agent.
 *
 * @param agentId - Unique agent identifier
 * @param config - Sandbox configuration
 * @param execFn - Optional exec override for testing
 */
export function create(agentId, config, execFn) {
    const run = execFn ?? ((cmd) => execAsync(cmd));
    const image = config.image ?? 'node:20-slim';
    const containerName = `monobrain-sandbox-${agentId}`;
    const defaultTimeout = config.timeout_ms ?? 30000;
    return {
        type: 'docker',
        agentId,
        async execute(command, timeoutMs) {
            const timeout = timeoutMs ?? defaultTimeout;
            const timeoutSec = Math.ceil(timeout / 1000);
            const dockerArgs = buildDockerArgs(agentId, config);
            // Start container in detached mode
            const runCmd = `docker run -d ${dockerArgs.join(' ')} ${image} sleep ${timeoutSec + 10}`;
            try {
                await run(runCmd);
            }
            catch {
                return {
                    code: 1,
                    stdout: '',
                    stderr: 'Failed to start container',
                    timedOut: false,
                };
            }
            // Execute command inside container
            try {
                const execCmd = `docker exec ${containerName} timeout ${timeoutSec} sh -c ${JSON.stringify(command)}`;
                const result = await run(execCmd);
                return {
                    code: 0,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    timedOut: false,
                };
            }
            catch (err) {
                const error = err;
                if (error.code === 124) {
                    return {
                        code: 124,
                        stdout: error.stdout ?? '',
                        stderr: error.stderr ?? 'Execution timed out',
                        timedOut: true,
                    };
                }
                return {
                    code: error.code ?? 1,
                    stdout: error.stdout ?? '',
                    stderr: error.stderr ?? error.message ?? '',
                    timedOut: false,
                };
            }
        },
        async destroy() {
            try {
                await run(`docker stop ${containerName}`);
                await run(`docker rm -f ${containerName}`);
            }
            catch {
                // Container may already be stopped/removed
            }
        },
        async getStats() {
            try {
                const result = await run(`docker stats ${containerName} --no-stream --format "{{json .}}"`);
                return JSON.parse(result.stdout);
            }
            catch {
                return { type: 'docker', agentId, status: 'unavailable' };
            }
        },
    };
}
//# sourceMappingURL=docker-sandbox.js.map