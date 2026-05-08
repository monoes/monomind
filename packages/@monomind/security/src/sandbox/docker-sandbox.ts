/**
 * Docker Sandbox - Container-based agent isolation
 *
 * Wraps Docker CLI to provide per-agent container sandboxing.
 * Tests should mock the execFn rather than running Docker.
 *
 * @module v1/security/sandbox/docker-sandbox
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { SandboxConfig, SandboxExecResult, SandboxRuntime } from './types.js';

const execFileAsync = promisify(execFileCb);

/** Allowlist pattern for agentId values used in container names */
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Allowlist pattern for Docker image references */
const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_/:@]{0,255}$/;

/**
 * Builds Docker CLI arguments from a SandboxConfig.
 * Exported for direct testing.
 */
export function buildDockerArgs(agentId: string, config: SandboxConfig): string[] {
  const args: string[] = [];

  // Container name
  args.push('--name', `monomind-sandbox-${agentId}`);

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
  if (config.use_gvisor) {
    args.push('--runtime', 'runsc');
  }

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
 * All Docker invocations use execFile (no shell) to prevent command injection.
 *
 * @param agentId - Unique agent identifier (must match /^[a-zA-Z0-9_-]{1,64}$/)
 * @param config - Sandbox configuration
 * @param execFn - Optional exec override for testing (receives ['docker', ...args])
 */
export function create(
  agentId: string,
  config: SandboxConfig,
  execFn?: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
): SandboxRuntime {
  // Validate agentId and image at the boundary to prevent injection via container names
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`Invalid agentId "${agentId}" — must match ${AGENT_ID_RE.source}`);
  }
  const image = config.image ?? 'node:20-slim';
  if (!IMAGE_RE.test(image)) {
    throw new Error(`Invalid Docker image reference "${image}"`);
  }

  const run = execFn ?? ((args: string[]) =>
    execFileAsync('docker', args, { encoding: 'utf-8' }) as Promise<{ stdout: string; stderr: string }>
  );

  const containerName = `monomind-sandbox-${agentId}`;
  const defaultTimeout = config.timeout_ms ?? 30000;

  return {
    type: 'docker',
    agentId,

    async execute(command: string, timeoutMs?: number): Promise<SandboxExecResult> {
      const timeout = timeoutMs ?? defaultTimeout;
      const timeoutSec = Math.ceil(timeout / 1000);
      const dockerArgs = buildDockerArgs(agentId, config);

      // Start container in detached mode — no shell, args array prevents injection
      try {
        await run(['run', '-d', ...dockerArgs, image, 'sleep', String(timeoutSec + 10)]);
      } catch {
        return {
          code: 1,
          stdout: '',
          stderr: 'Failed to start container',
          timedOut: false,
        };
      }

      // Execute command inside container
      try {
        const result = await run([
          'exec', containerName,
          'timeout', String(timeoutSec),
          'sh', '-c', command,
        ]);
        return {
          code: 0,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: false,
        };
      } catch (err: unknown) {
        const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
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

    async destroy(): Promise<void> {
      try {
        await run(['stop', containerName]);
        await run(['rm', '-f', containerName]);
      } catch {
        // Container may already be stopped/removed; force-rm is best-effort
      }
    },

    async getStats(): Promise<Record<string, unknown>> {
      try {
        const result = await run(['stats', containerName, '--no-stream', '--format', '{{json .}}']);
        return JSON.parse(result.stdout) as Record<string, unknown>;
      } catch {
        return { type: 'docker', agentId, status: 'unavailable' };
      }
    },
  };
}
