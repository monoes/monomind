/**
 * WASM Sandbox - Node.js vm-based sandboxed JS execution
 *
 * Uses Node's vm module to run JavaScript in an isolated context.
 * Blocks access to require, process, setTimeout, setInterval, and other
 * host environment globals.
 *
 * ⚠️  SECURITY WARNING: vm.runInContext is NOT a true security sandbox.
 * Code running inside can escape to the host process via the prototype chain
 * (e.g. ({}).constructor.constructor('return process')()). This is documented
 * Node.js behavior. Only use this sandbox for untrusted-but-cooperative code
 * (linting, formatting, lightweight scripting). For genuine untrusted code,
 * use the DockerSandbox or a real V8 isolate (isolated-vm package).
 *
 * @module v1/security/sandbox/wasm-sandbox
 */

import vm from 'node:vm';
import type { SandboxConfig, SandboxExecResult, SandboxRuntime } from './types.js';

/**
 * Creates a WasmSandbox runtime for an agent.
 */
export function create(agentId: string, config: SandboxConfig): SandboxRuntime {
  const defaultTimeout = config.timeout_ms ?? 5000;

  console.warn(
    '[WasmSandbox] vm.runInContext is not a security boundary — ' +
    'prototype chain escapes are possible. Use DockerSandbox for untrusted code.'
  );

  return {
    type: 'wasm',
    agentId,

    async execute(code: string, timeoutMs?: number): Promise<SandboxExecResult> {
      const timeout = timeoutMs ?? defaultTimeout;
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      // Build a minimal sandbox context that blocks dangerous globals
      const sandbox: Record<string, unknown> = {
        console: {
          log: (...args: unknown[]) => {
            stdoutLines.push(args.map(String).join(' '));
          },
          error: (...args: unknown[]) => {
            stderrLines.push(args.map(String).join(' '));
          },
          warn: (...args: unknown[]) => {
            stderrLines.push(args.map(String).join(' '));
          },
          info: (...args: unknown[]) => {
            stdoutLines.push(args.map(String).join(' '));
          },
        },
        // Explicitly block dangerous APIs
        require: undefined,
        process: undefined,
        setTimeout: undefined,
        setInterval: undefined,
        setImmediate: undefined,
        clearTimeout: undefined,
        clearInterval: undefined,
        clearImmediate: undefined,
        globalThis: undefined,
        global: undefined,
      };

      const context = vm.createContext(sandbox);

      try {
        vm.runInContext(code, context, {
          timeout,
          filename: `sandbox-${agentId}.js`,
        });

        return {
          code: 0,
          stdout: stdoutLines.join('\n'),
          stderr: stderrLines.join('\n'),
          timedOut: false,
        };
      } catch (err: unknown) {
        const error = err as Error;

        // Node vm throws an error with code 'ERR_SCRIPT_EXECUTION_TIMEOUT' on timeout
        if (
          error.message?.includes('Script execution timed out') ||
          (error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
        ) {
          return {
            code: 124,
            stdout: stdoutLines.join('\n'),
            stderr: 'Execution timed out',
            timedOut: true,
          };
        }

        return {
          code: 1,
          stdout: stdoutLines.join('\n'),
          stderr: error.message ?? String(err),
          timedOut: false,
        };
      }
    },

    async destroy(): Promise<void> {
      // No persistent resources to clean up for vm-based sandbox
    },

    async getStats(): Promise<Record<string, unknown>> {
      return {
        type: 'wasm',
        agentId,
        memoryPages: config.wasm_memory_pages ?? 256,
      };
    },
  };
}
