/**
 * `pick` — the central agent/skill picker over MCP (mcp__monomind__pick).
 * Same ranking and JSON as `monomind pick --json`, plus a one-line `summary`.
 */
import { z } from 'zod';
import { pickForTask, pickSummary } from '../routing/agent-pick.js';
import type { MCPTool } from './types.js';

const MAX_TASK_LEN = 16 * 1024;

const PickInput = z.object({
  task: z.string().trim().min(1).max(MAX_TASK_LEN),
  kind: z.enum(['agents', 'skills', 'both']).default('both'),
  categories: z.array(z.string().min(1).max(64)).max(50).optional(),
  top: z.number().int().min(1).max(20).default(5),
});

export const pickTool: MCPTool = {
  name: 'pick',
  description:
    'Pick the best agents and skills for a task — the same ranking as `monomind pick` (Jev ' +
    'decision model when configured, keyword fallback). Every agent entry has `name`, the ' +
    'spawnable Task subagent_type; skills carry `invoke`. `summary` is one line naming the top picks.',
  category: 'pick',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      kind: {
        type: 'string',
        enum: ['agents', 'skills', 'both'],
        description: 'What to rank (default: both)',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Agent categories to consider (default: all)',
      },
      top: { type: 'number', description: 'Entries per list, 1-20 (default: 5)' },
    },
    required: ['task'],
  },
  handler: async (input) => {
    const parsed = PickInput.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
      return { error: `invalid input — ${issues.join('; ')}` };
    }
    const { task, kind, categories, top } = parsed.data;
    const ranking = await pickForTask({ task, kind, categories, top });
    // Plain data: the MCP server serialises the return value into the text
    // content itself, so this is exactly what the client reads.
    return { ...ranking, summary: pickSummary(ranking, kind) };
  },
};

export const pickTools: MCPTool[] = [pickTool];
