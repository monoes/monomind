/**
 * MCP Knowledge Tools — Second Brain document ingest and search
 */

import type { MCPTool, MCPToolResult } from './types.js';
import { validateInput } from '../utils/input-guards.js';

const knowledgeIngest: MCPTool = {
  name: 'knowledge_ingest',
  description: 'Ingest documents into the Second Brain knowledge base. Accepts a file or directory path. Extracts text, chunks, embeds, and stores in SQLite for semantic search.',
  category: 'knowledge',
  tags: ['documents', 'ingest', 'second-brain'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to ingest' },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
    },
    required: ['path'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const pathCheck = validateInput(input.path, { type: 'path' });
    if (!pathCheck.valid) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: pathCheck.error }) }],
        isError: true,
      };
    }

    const { ingestDocument, ingestDirectory } = await import('../knowledge/document-pipeline.js');
    const fs = await import('node:fs');
    const pathMod = await import('node:path');

    const target = pathMod.resolve(pathCheck.sanitized!);
    const scope = String(input.scope || 'shared');

    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        const result = await ingestDirectory(target, scope, { rootDir: process.cwd() });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filesProcessed: result.filesProcessed,
              filesSkipped: result.filesSkipped,
              totalChunks: result.totalChunks,
              errors: result.errors,
            }),
          }],
        };
      } else {
        const result = await ingestDocument(target, scope);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: !result.error || result.skipped,
              filePath: result.filePath,
              chunksIndexed: result.chunksIndexed,
              skipped: result.skipped,
              error: result.error,
            }),
          }],
        };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: String(err) }) }],
        isError: true,
      };
    }
  },
};

const knowledgeSearch: MCPTool = {
  name: 'knowledge_search',
  description: 'Search the Second Brain. A rule-based router picks the retrieval surfaces per query — document excerpts, knowledge-graph triplets, distilled rules, past memories — and fuses them by reciprocal rank. Excerpt ids can be rated via memory_feedback.',
  category: 'knowledge',
  tags: ['documents', 'search', 'second-brain', 'rag'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
      minScore: { type: 'number', description: 'Minimum similarity threshold (default: 0.3)' },
      surfaces: { type: 'array', items: { type: 'string' }, description: "Override routing: any of 'chunks','kg','rules','memory'" },
    },
    required: ['query'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const { routeQuery, rrfFuse } = await import('../memory/query-router.js');

    try {
      const query = String(input.query);
      const limit = input.limit ? Number(input.limit) : 10;
      const route = routeQuery(query);
      const surfaces = Array.isArray(input.surfaces) && (input.surfaces as string[]).length
        ? (input.surfaces as string[])
        : (route.confident ? route.surfaces : ['chunks', ...route.surfaces.filter(s => s !== 'chunks')]);

      const bridge = await import('../memory/memory-bridge.js');
      const kg = await import('../memory/memory-kg.js');
      const [excerpts, graph, rules, memories] = await Promise.all([
        surfaces.includes('chunks')
          ? searchKnowledge(query, {
              scope: input.scope ? String(input.scope) : undefined,
              limit,
              minScore: input.minScore ? Number(input.minScore) : undefined,
            })
          : [],
        surfaces.includes('kg') ? kg.kgSearch({ query, limit: 6 }) : null,
        surfaces.includes('rules') ? bridge.bridgeSearchEntries({ query, namespace: 'rules', limit: 3, threshold: 0.35 }) : null,
        surfaces.includes('memory') ? bridge.bridgeSearchEntries({ query, namespace: 'patterns', limit: 3 }) : null,
      ]);

      // Rank-fuse heterogeneous lists (raw scores aren't comparable).
      const fused = rrfFuse([
        excerpts.map(e => ({ id: e.id || `${e.filePath}#${e.chunkIndex}`, kind: 'excerpt' as const, ...e })),
        (graph?.triplets ?? []).map((t, i) => ({ id: `kg:${i}:${t.source}|${t.relation}|${t.target}`, kind: 'triplet' as const, ...t })),
        (rules?.results ?? []).map(r => ({ id: r.id, kind: 'rule' as const, key: r.key, text: r.content, importance: 0.7 })),
        (memories?.results ?? []).map(r => ({ id: r.id, kind: 'memory' as const, key: r.key, text: r.content })),
      ], limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: fused.length,
            routing: { surfaces, confident: route.confident },
            results: fused,
            // Back-compat: excerpt-only view for existing consumers.
            excerpts,
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: String(err) }) }],
        isError: true,
      };
    }
  },
};

export const knowledgeTools: MCPTool[] = [knowledgeIngest, knowledgeSearch];
