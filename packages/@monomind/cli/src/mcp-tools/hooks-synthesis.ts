/**
 * Hooks Dynamic Agent Synthesis MCP Tools
 *
 * Wires the previously-orphaned @monomind/hooks synthesis subsystem
 * (EphemeralRegistry, TTLCleanup, AgentPromoter, DGMArchive,
 * SynthesisPromptTemplate — "Task 47") into the CLI's live MCP tool
 * registry.
 *
 * Architecture: @monomind/hooks has no LLM client of its own, so the actual
 * agent-definition generation is delegated to the calling agent (e.g. Claude
 * Code via the Task tool), which already has reasoning + generation
 * capability. The flow is:
 *   1. hooks_synthesis_prompt   — caller gets a structured prompt describing
 *      the task that had no good routing match.
 *   2. Caller (LLM) generates an AgentDefinition JSON object from the prompt.
 *   3. hooks_synthesis_register — validates the definition (zod schema),
 *      writes it to disk as a markdown agent file, and registers it in the
 *      ephemeral registry with a TTL.
 *   4. hooks_synthesis_status   — introspect the registry / DGM archive.
 *   5. hooks_synthesis_promote  — promote a well-performing ephemeral agent
 *      to the permanent registry (copies file + records in DGM archive).
 *   6. hooks_synthesis_cleanup  — delete expired, non-promoted agents.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { type MCPTool, getProjectCwd } from './types.js';
import {
  agentDefinitionSchema,
  SynthesisPromptTemplate,
  EphemeralRegistry,
  TTLCleanup,
  AgentPromoter,
  DGMArchive,
  type AgentDefinition,
} from '@monomind/hooks';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getEphemeralAgentDir(): string {
  return join(getProjectCwd(), '.claude', 'agents', 'ephemeral');
}

export const hooksSynthesisPrompt: MCPTool = {
  name: 'hooks_synthesis-prompt',
  description:
    'Build an LLM prompt requesting a new synthesized agent definition, for use when hooks_route finds no confident match. ' +
    'The caller generates the AgentDefinition JSON from the returned prompt, then submits it via hooks_synthesis-register.',
  inputSchema: {
    type: 'object',
    properties: {
      taskDescription: { type: 'string', description: 'The task that had no confident agent match' },
      topMatchSlug: { type: 'string', description: 'Slug of the closest existing agent match' },
      topMatchScore: { type: 'number', description: 'Confidence score of the closest match (0-1)' },
      existingAgentCount: { type: 'number', description: 'Number of existing agents considered' },
      existingSlugs: { type: 'array', items: { type: 'string' }, description: 'Slugs of existing agents to avoid colliding with' },
    },
    required: ['taskDescription'],
  },
  handler: async (params: Record<string, unknown>) => {
    const taskDescription = params.taskDescription as string;
    const topMatchSlug = (params.topMatchSlug as string) ?? 'none';
    const topMatchScore = typeof params.topMatchScore === 'number' ? params.topMatchScore : 0;
    const existingAgentCount = typeof params.existingAgentCount === 'number' ? params.existingAgentCount : 0;
    const existingSlugs = Array.isArray(params.existingSlugs) ? (params.existingSlugs as string[]) : [];

    const requestId = randomUUID();
    const prompt = SynthesisPromptTemplate.build(
      {
        requestId,
        taskDescription,
        topMatchSlug,
        topMatchScore,
        existingAgentCount,
        requestedAt: new Date(),
      },
      existingSlugs,
    );

    return { requestId, prompt };
  },
};

export const hooksSynthesisRegister: MCPTool = {
  name: 'hooks_synthesis-register',
  description:
    'Validate and register a synthesized agent definition (from hooks_synthesis-prompt). ' +
    'Writes the agent as a markdown file and registers it in the ephemeral registry with a TTL.',
  inputSchema: {
    type: 'object',
    properties: {
      agentDefinition: { type: 'object', description: 'AgentDefinition JSON produced from the synthesis prompt' },
      synthesisRequestId: { type: 'string', description: 'requestId returned by hooks_synthesis-prompt' },
      ttlMs: { type: 'number', description: 'Time-to-live in ms before the agent expires (default: 24h)' },
    },
    required: ['agentDefinition', 'synthesisRequestId'],
  },
  handler: async (params: Record<string, unknown>) => {
    const raw = params.agentDefinition as Record<string, unknown>;
    const synthesisRequestId = params.synthesisRequestId as string;
    const ttlMs = typeof params.ttlMs === 'number' && params.ttlMs > 0 ? params.ttlMs : DEFAULT_TTL_MS;

    const parsed = agentDefinitionSchema.safeParse({
      ...raw,
      synthesizedAt: raw.synthesizedAt ?? new Date().toISOString(),
    });
    if (!parsed.success) {
      return { registered: false, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
    }
    const def = parsed.data as AgentDefinition;

    const registry = EphemeralRegistry.getInstance();
    if (registry.isRegistered(def.slug)) {
      return { registered: false, error: `slug "${def.slug}" is already registered` };
    }

    const agentDir = getEphemeralAgentDir();
    if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
    const filePath = join(agentDir, `${def.slug}.md`);
    writeFileSync(filePath, SynthesisPromptTemplate.toAgentMarkdown(def), 'utf-8');

    const now = new Date();
    registry.register({
      slug: def.slug,
      filePath,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      usageCount: 0,
      avgQualityScore: 0,
      promoted: false,
      synthesisRequestId,
    });

    return { registered: true, slug: def.slug, filePath, expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
  },
};

export const hooksSynthesisStatus: MCPTool = {
  name: 'hooks_synthesis-status',
  description: 'Introspect the ephemeral agent registry and DGM MAP-Elites archive: registered agents, usage/quality, and promotion candidates.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const registry = EphemeralRegistry.getInstance();
    const all = [...registry.getAll().values()];
    const candidates = registry.getPromotionCandidates();
    const archive = DGMArchive.getInstance();

    return {
      registrySize: registry.size,
      agents: all.map(r => ({
        slug: r.slug,
        usageCount: r.usageCount,
        avgQualityScore: r.avgQualityScore,
        promoted: r.promoted,
        expiresAt: r.expiresAt.toISOString(),
      })),
      promotionCandidates: candidates.map(c => c.slug),
      dgmArchive: {
        size: archive.size,
        best: archive.best() ?? null,
        niches: archive.listAll(),
      },
    };
  },
};

export const hooksSynthesisPromote: MCPTool = {
  name: 'hooks_synthesis-promote',
  description: 'Promote an eligible ephemeral agent (min usage + quality threshold) to the permanent agent directory and DGM archive.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Slug of the ephemeral agent to promote' },
      targetDir: { type: 'string', description: 'Permanent agent directory (default: .claude/agents)' },
    },
    required: ['slug'],
  },
  handler: async (params: Record<string, unknown>) => {
    const slug = params.slug as string;
    const targetDir = (params.targetDir as string) || join(getProjectCwd(), '.claude', 'agents');

    const registry = EphemeralRegistry.getInstance();
    const record = registry.get(slug);
    if (!record) return { promoted: false, error: `slug "${slug}" not found in registry` };
    if (!AgentPromoter.isEligible(record)) {
      return {
        promoted: false,
        error: `slug "${slug}" is not eligible (needs usageCount>=${AgentPromoter.MIN_USAGE_COUNT}, avgQualityScore>=${AgentPromoter.PROMOTION_THRESHOLD})`,
        usageCount: record.usageCount,
        avgQualityScore: record.avgQualityScore,
      };
    }

    const destPath = await AgentPromoter.promote(record, targetDir);
    registry.markPromoted(slug);
    return { promoted: true, slug, destPath };
  },
};

export const hooksSynthesisCleanup: MCPTool = {
  name: 'hooks_synthesis-cleanup',
  description: 'Delete expired, non-promoted ephemeral agents from the registry and disk (TTL cleanup).',
  inputSchema: {
    type: 'object',
    properties: {
      agentDir: { type: 'string', description: 'Ephemeral agent directory (default: .claude/agents/ephemeral)' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const agentDir = (params.agentDir as string) || getEphemeralAgentDir();
    const registry = EphemeralRegistry.getInstance();
    const cleanup = new TTLCleanup(agentDir);
    const result = await cleanup.runCleanup(registry);
    return result;
  },
};

export const hooksSynthesisTools: MCPTool[] = [
  hooksSynthesisPrompt,
  hooksSynthesisRegister,
  hooksSynthesisStatus,
  hooksSynthesisPromote,
  hooksSynthesisCleanup,
];
