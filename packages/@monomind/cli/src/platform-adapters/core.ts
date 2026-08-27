/** Platform-neutral Mastermind artifact intents. */

import { renderInstruction } from './renderers/instructions.js';
import { mcpCommand as renderMcpCommand } from './renderers/mcp.js';
import { renderSkillRouter } from './renderers/skills.js';
import type { ArtifactIntent, InstallScope, PlatformAdapter } from './types.js';

export { platformInstruction } from './renderers/instructions.js';

export interface CoreRenderOptions {
  scope: InstallScope;
  enableHooks?: boolean;
  os?: NodeJS.Platform;
}

export const mcpCommand = renderMcpCommand;

/**
 * Produce only artifacts that the evidence-gated registry permits. Individual
 * renderers may add richer platform-specific data, but cannot turn fallback or
 * discovery-only capabilities into files.
 */
export function renderCoreArtifacts(
  adapter: PlatformAdapter,
  options: CoreRenderOptions,
): { intents: ArtifactIntent[]; diagnostics: string[] } {
  const intents: ArtifactIntent[] = [];
  const diagnostics: string[] = [];

  const instruction = renderInstruction(adapter, options.scope);
  if (instruction) {
    intents.push(instruction);
  } else {
    diagnostics.push(
      `${adapter.displayName}: instructions are ${adapter.capabilities.instructions}; use the CLI fallback`,
    );
  }

  const skills = renderSkillRouter(adapter, options.scope);
  if (skills.length > 0) {
    intents.push(...skills);
  } else {
    diagnostics.push(
      `${adapter.displayName}: use monomind mastermind run <skill> --print for workflow fallback`,
    );
  }
  if (adapter.capabilities.mcp !== 'native') {
    diagnostics.push(
      `${adapter.displayName}: MCP is ${adapter.capabilities.mcp}; use the Monomind CLI fallback`,
    );
  }

  return { intents, diagnostics };
}
