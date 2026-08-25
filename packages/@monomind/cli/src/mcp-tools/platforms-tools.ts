/** Read-only MCP exposure of platform adapter diagnostics. */

import { runPlatformsDoctor } from '../platform-adapters/operations.js';
import { resolvePlatformId } from '../platform-adapters/registry.js';
import type { MCPTool } from './types.js';

export const platformsDoctor: MCPTool = {
  name: 'platforms_doctor',
  description: 'Inspect evidence-gated Monomind platform integration state without changing files.',
  category: 'platforms',
  tags: ['platforms', 'doctor', 'diagnostics'],
  version: '1.0.0',
  inputSchema: {
    type: 'object',
    properties: {
      platform: { type: 'string', description: 'Optional platform id or legacy alias.' },
      scope: { type: 'string', enum: ['project', 'user'], description: 'Inspection scope.' },
      path: { type: 'string', description: 'Project root for project-scope inspection.' },
    },
  },
  async handler(input, context) {
    const raw = typeof input.platform === 'string' ? input.platform : undefined;
    const platform = raw ? resolvePlatformId(raw) : undefined;
    if (raw && !platform) {
      return { content: [{ type: 'text', text: `Unknown platform: ${raw}` }], isError: true };
    }
    const path =
      typeof input.path === 'string'
        ? input.path
        : typeof context?.cwd === 'string'
          ? context.cwd
          : process.cwd();
    const reports = await runPlatformsDoctor({
      platform,
      path,
      scope: input.scope === 'user' ? 'user' : 'project',
    });
    return { content: [{ type: 'text', text: JSON.stringify(reports) }] };
  },
};

export const platformsTools: MCPTool[] = [platformsDoctor];
