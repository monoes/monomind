/**
 * Sandbox Provisioner - Factory for creating sandbox runtimes
 *
 * Dispatches to Docker, WASM, or passthrough based on config type.
 *
 * @module v1/security/sandbox/sandbox-provisioner
 */

import type { SandboxConfig, SandboxExecResult, SandboxRuntime } from './types.js';
import { validateSandboxConfig } from './types.js';
import * as WasmSandbox from './wasm-sandbox.js';
import * as DockerSandbox from './docker-sandbox.js';

/**
 * Creates a passthrough runtime that executes nothing (type='none').
 */
function createPassthrough(agentId: string): SandboxRuntime {
  return {
    type: 'none',
    agentId,

    async execute(command: string): Promise<SandboxExecResult> {
      return {
        code: 0,
        stdout: `[passthrough] ${command}`,
        stderr: '',
        timedOut: false,
      };
    },

    async destroy(): Promise<void> {
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
export function provision(agentId: string, config: SandboxConfig): SandboxRuntime {
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
      throw new Error(`Unknown sandbox type: ${(config as SandboxConfig).type}`);
  }
}
