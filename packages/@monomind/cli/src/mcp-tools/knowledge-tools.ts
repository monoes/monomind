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
        // getProjectRoot(), not cwd — the file branch below already defaults to
        // it, and an MCP server's cwd is whatever the client chose. Passing cwd
        // here sent directory-ingest metadata to a different root than
        // file-ingest and than search, splitting one brain into two.
        const { getProjectRoot } = await import('../memory/memory-bridge.js');
        const result = await ingestDirectory(target, scope, { rootDir: getProjectRoot() });
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
      store: { type: 'string', description: "Which store(s) to search: 'project', 'global' (the personal cross-project brain), or 'all' (default — project results win ties)" },
      includeSuperseded: { type: 'boolean', description: 'Also return chunks from older, re-ingested versions of a document (flagged superseded). Default false.' },
    },
    required: ['query'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const { routeQuery, rrfFuse, recordRouteOverride } = await import('../memory/query-router.js');

    try {
      const query = String(input.query);
      const limit = input.limit ? Number(input.limit) : 10;
      const route = routeQuery(query);
      const explicitSurfaces = Array.isArray(input.surfaces) && (input.surfaces as string[]).length
        ? (input.surfaces as string[])
        : null;
      const surfaces = explicitSurfaces
        ?? (route.confident ? route.surfaces : ['chunks', ...route.surfaces.filter(s => s !== 'chunks')]);

      // Same validation as `doc search --store`: anything unrecognised falls
      // back to 'all' rather than erroring, so a typo still returns knowledge.
      const rawStore = String(input.store ?? 'all');
      const store: 'project' | 'global' | 'all' =
        rawStore === 'project' || rawStore === 'global' ? rawStore : 'all';

      const chunkOpts = {
        scope: input.scope ? String(input.scope) : undefined,
        limit,
        minScore: input.minScore ? Number(input.minScore) : undefined,
        store,
        includeSuperseded: input.includeSuperseded === true,
      };

      const bridge = await import('../memory/memory-bridge.js');
      const kg = await import('../memory/memory-kg.js');
      // store:'global' means "only my personal cross-project brain". The KG,
      // rules and pattern namespaces are project-scoped stores, so including
      // them would leak project knowledge into a deliberately global-only
      // query — the same rule the warm /api/knowledge/search endpoint applies.
      const projectSurfaces = store !== 'global';
      const [excerpts, graph, rules, memories] = await Promise.all([
        surfaces.includes('chunks') ? searchKnowledge(query, chunkOpts) : [],
        projectSurfaces && surfaces.includes('kg') ? kg.kgSearch({ query, limit: 6 }) : null,
        projectSurfaces && surfaces.includes('rules') ? bridge.bridgeSearchEntries({ query, namespace: 'rules', limit: 3, threshold: 0.35 }) : null,
        projectSurfaces && surfaces.includes('memory') ? bridge.bridgeSearchEntries({ query, namespace: 'patterns', limit: 3 }) : null,
      ]);

      // Confident non-chunk routing against an empty surface (e.g. a project
      // with no KG yet) must not read as "no knowledge" — fall back to chunks.
      // Same rule the CLI `doc search` path applies; without it agents got
      // "no results" where the CLI returned document excerpts.
      let fellBack = false;
      let chunkExcerpts = excerpts;
      if (!explicitSurfaces && !chunkExcerpts.length && !(graph?.triplets?.length) && !(rules?.results?.length) && !(memories?.results?.length) && !surfaces.includes('chunks')) {
        fellBack = true;
        recordRouteOverride(surfaces[0] as 'chunks' | 'kg' | 'rules' | 'memory', 'chunks');
        chunkExcerpts = await searchKnowledge(query, chunkOpts);
      }

      // Rank-fuse heterogeneous lists (raw scores aren't comparable).
      const fused = rrfFuse([
        chunkExcerpts.map(e => ({ id: e.id || `${e.filePath}#${e.chunkIndex}`, kind: 'excerpt' as const, ...e })),
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
            routing: { surfaces, store, confident: route.confident, fellBackToChunks: fellBack },
            results: fused,
            // Back-compat: excerpt-only view for existing consumers.
            excerpts: chunkExcerpts,
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

const knowledgeRemove: MCPTool = {
  name: 'knowledge_remove',
  description: 'Forget an indexed document. Hides every chunk of it from knowledge_search, doc search, and per-prompt injection immediately; the stored rows are reclaimed on the next full re-index. Reversible by re-ingesting the file. Errors if the path is not currently indexed under the given scope, so a wrong path never silently reports success.',
  category: 'knowledge',
  tags: ['documents', 'remove', 'second-brain'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the indexed document, as reported by knowledge_search / doc list' },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
      global: { type: 'boolean', description: 'Remove from the personal cross-project global brain instead of this project' },
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

    const { listDocuments, removeDocument } = await import('../knowledge/document-pipeline.js');
    const { getGlobalBrainDir, getProjectRoot } = await import('../memory/memory-bridge.js');
    const pathMod = await import('node:path');

    const isGlobal = input.global === true;
    const scope = isGlobal ? 'global' : String(input.scope || 'shared');
    const root = isGlobal ? getGlobalBrainDir() : getProjectRoot();
    const target = pathMod.resolve(pathCheck.sanitized!);

    try {
      const indexed = listDocuments(root, scope);
      if (!indexed.some(d => pathMod.resolve(d.filePath) === target)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Not indexed under scope '${scope}': ${target}`,
              indexedCount: indexed.length,
            }),
          }],
          isError: true,
        };
      }

      await removeDocument(target, scope, root);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            filePath: target,
            scope,
            store: isGlobal ? 'global' : 'project',
            note: 'Hidden from search immediately; storage reclaimed on the next full re-index.',
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

export const knowledgeTools: MCPTool[] = [knowledgeIngest, knowledgeSearch, knowledgeRemove];
