/**
 * Synthesis Prompt Template — Task 47
 *
 * Builds LLM prompts for on-demand agent synthesis and
 * converts agent definitions to YAML-frontmatter markdown.
 */

import { z } from 'zod';
import type { AgentDefinition, SynthesisRequest } from './types.js';

// ── Allowed tools (known Claude Code tools) ──

const ALLOWED_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep',
  'Bash', 'Task', 'TodoWrite', 'WebSearch', 'WebFetch',
  'mcp', 'memory', 'agent', 'swarm',
]);

// ── Zod schema for agent definitions ──

export const agentDefinitionSchema = z.object({
  slug: z.string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
  name: z.string().min(1).max(120),
  description: z.string().min(10).max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be hex color'),
  emoji: z.string().min(1).max(4),
  vibe: z.string().min(1).max(200),
  tools: z.array(z.string().refine(
    (t) => ALLOWED_TOOLS.has(t),
    { message: 'unknown tool' },
  )).min(1),
  systemPromptBody: z.string().min(50, 'systemPromptBody must be at least 50 characters'),
  capability: z.object({
    sandbox: z.enum(['docker', 'wasm', 'none']),
    planning_step: z.enum(['required', 'optional', 'disabled']).optional(),
    confidence_threshold: z.number().min(0).max(1).optional(),
  }).optional(),
  tags: z.array(z.string()).min(1),
  synthesizedFrom: z.string().min(1),
  synthesizedAt: z.coerce.date(),
});

// ── Prompt template builder ──

export class SynthesisPromptTemplate {
  /**
   * Build an LLM prompt requesting agent synthesis.
   */
  static build(request: SynthesisRequest, existingSlugs: string[]): string {
    const slugList = existingSlugs.length > 0
      ? existingSlugs.join(', ')
      : '(none)';

    return [
      '# Agent Synthesis Request',
      '',
      '## Task',
      request.taskDescription,
      '',
      '## Context',
      `- Request ID: ${request.requestId}`,
      `- Top match: "${request.topMatchSlug}" (score ${request.topMatchScore.toFixed(3)})`,
      `- Existing agent count: ${request.existingAgentCount}`,
      '',
      '## Existing Agent Slugs',
      slugList,
      '',
      '## Instructions',
      'Generate a JSON object conforming to AgentDefinition with:',
      '- A unique kebab-case `slug` not in the existing list',
      '- `systemPromptBody` of at least 50 characters',
      '- Only tools from the allowed set: ' + [...ALLOWED_TOOLS].join(', '),
      '- `synthesizedFrom` set to the top-match slug',
      '- `synthesizedAt` set to the current ISO timestamp',
      '',
      'Return ONLY the JSON object, no markdown fences.',
    ].join('\n');
  }

  /**
   * Convert an AgentDefinition to a YAML-frontmatter .md file string.
   */
  static toAgentMarkdown(def: AgentDefinition): string {
    const yaml = [
      '---',
      `slug: ${def.slug}`,
      `name: "${def.name}"`,
      `description: "${def.description}"`,
      `color: "${def.color}"`,
      `emoji: "${def.emoji}"`,
      `vibe: "${def.vibe}"`,
      `tools: [${def.tools.map(t => `"${t}"`).join(', ')}]`,
      `tags: [${def.tags.map(t => `"${t}"`).join(', ')}]`,
      `synthesizedFrom: "${def.synthesizedFrom}"`,
      `synthesizedAt: "${def.synthesizedAt.toISOString()}"`,
      '---',
      '',
      def.systemPromptBody,
      '',
    ].join('\n');
    return yaml;
  }
}
