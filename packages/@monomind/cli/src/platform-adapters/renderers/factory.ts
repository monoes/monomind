/** Pure platform-plan composition shared by the dedicated target renderers. */

import { renderCoreArtifacts } from '../core.js';
import type { InstallRequest, PlatformAdapter, PlatformId, PlatformPlan } from '../types.js';
import { renderHookArtifacts } from './hooks.js';
import { renderMcpArtifacts } from './mcp.js';
import { renderEnhancements } from './status.js';

export interface PlatformRenderer {
  readonly platform: PlatformId;
  render(adapter: PlatformAdapter, request: InstallRequest): PlatformPlan;
}

function dedupe(diagnostics: readonly string[]): string[] {
  return [...new Set(diagnostics)];
}

/**
 * Assemble a declarative plan only. The operations layer remains the sole
 * owner of path resolution and filesystem writes.
 */
export function renderPlatformPlan(
  adapter: PlatformAdapter,
  request: InstallRequest,
): PlatformPlan {
  const core = renderCoreArtifacts(adapter, {
    scope: request.scope,
    enableHooks: request.enableHooks,
  });
  const enhancements = renderEnhancements(adapter, { scope: request.scope });
  const mcp = renderMcpArtifacts(adapter, { scope: request.scope });
  const hooks = renderHookArtifacts(adapter, {
    scope: request.scope,
    enableHooks: request.enableHooks,
    enableBlockingHooks: request.enableBlockingHooks,
  });
  const diagnostics = [
    ...core.diagnostics,
    ...enhancements.diagnostics,
    ...mcp.diagnostics,
    ...hooks.diagnostics,
  ];

  if (adapter.requiresDiscovery && !request.discovery?.available) {
    diagnostics.push(`${adapter.displayName}: native enhancements require successful discovery.`);
  }

  return {
    scope: request.scope,
    authorizedUserMutation: request.scope === 'project' || request.yes === true,
    intents: [...core.intents, ...enhancements.intents, ...mcp.intents, ...hooks.intents],
    diagnostics: dedupe(diagnostics),
  };
}

/** Bind the generic composition to one target without allowing id mix-ups. */
export function createPlatformRenderer(platform: PlatformId): PlatformRenderer {
  return Object.freeze({
    platform,
    render(adapter: PlatformAdapter, request: InstallRequest): PlatformPlan {
      if (adapter.id !== platform || request.platform !== platform) {
        throw new Error(`Renderer ${platform} cannot render ${adapter.id}`);
      }
      return renderPlatformPlan(adapter, request);
    },
  });
}
