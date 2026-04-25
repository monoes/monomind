/**
 * Sandbox Registry - Tracks active sandbox runtimes
 *
 * Static registry for managing the lifecycle of per-agent sandboxes.
 *
 * @module v1/security/sandbox/sandbox-registry
 */

import type { SandboxRuntime } from './types.js';

const activeSandboxes: Map<string, SandboxRuntime> = new Map();

/**
 * Register an active sandbox runtime.
 */
export function register(agentId: string, runtime: SandboxRuntime): void {
  activeSandboxes.set(agentId, runtime);
}

/**
 * Retrieve a sandbox runtime by agent ID.
 */
export function get(agentId: string): SandboxRuntime | undefined {
  return activeSandboxes.get(agentId);
}

/**
 * Clean up and remove a single sandbox.
 */
export async function cleanup(agentId: string): Promise<void> {
  const runtime = activeSandboxes.get(agentId);
  if (runtime) {
    if (runtime.destroy) {
      await runtime.destroy();
    }
    activeSandboxes.delete(agentId);
  }
}

/**
 * Clean up and remove all active sandboxes.
 */
export async function cleanupAll(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [agentId, runtime] of activeSandboxes.entries()) {
    if (runtime.destroy) {
      promises.push(runtime.destroy());
    }
    activeSandboxes.delete(agentId);
  }
  await Promise.all(promises);
}

/**
 * List all active sandbox agent IDs.
 */
export function listActive(): string[] {
  return Array.from(activeSandboxes.keys());
}
