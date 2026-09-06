/**
 * MCP Knowledge Tools — Second Brain document ingest and search
 */

import { validateInput } from '../utils/input-guards.js';
import type { MCPTool, MCPToolResult } from './types.js';

const knowledgeIngest: MCPTool = {
  name: 'knowledge_ingest',
  description:
    'Ingest documents into the Second Brain knowledge base. Accepts a file or directory path. Extracts text, chunks, embeds, and stores in SQLite for semantic search.',
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
        content: [
          { type: 'text', text: JSON.stringify({ success: false, error: pathCheck.error }) },
        ],
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
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                filesProcessed: result.filesProcessed,
                filesSkipped: result.filesSkipped,
                totalChunks: result.totalChunks,
                errors: result.errors,
              }),
            },
          ],
        };
      } else {
        const result = await ingestDocument(target, scope);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: !result.error || result.skipped,
                filePath: result.filePath,
                chunksIndexed: result.chunksIndexed,
                skipped: result.skipped,
                error: result.error,
              }),
            },
          ],
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
  description:
    'Search the Second Brain. A rule-based router picks the retrieval surfaces per query — document excerpts, memory knowledge-graph entities and relations, distilled rules, past memories — and fuses them by reciprocal rank. Does NOT search the Monograph code graph: for "what calls/imports X", use monograph_query / monograph_impact. Every response reports which surfaces were requested, executed, failed or unsupported, and the retrieval method each actually used. Excerpt ids can be rated via memory_feedback.',
  category: 'knowledge',
  tags: ['documents', 'search', 'second-brain', 'rag'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
      minScore: { type: 'number', description: 'Minimum similarity threshold (default: 0.3)' },
      surfaces: {
        type: 'array',
        items: { type: 'string' },
        description: "Override routing: any of 'chunks','kg','rules','memory'",
      },
      store: {
        type: 'string',
        description:
          "Which store(s) to search: 'project', 'global' (the personal cross-project brain), or 'all' (default — project results win ties)",
      },
      includeSuperseded: {
        type: 'boolean',
        description:
          'Also return chunks from older, re-ingested versions of a document (flagged superseded). Default false.',
      },
    },
    required: ['query'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const { buildRetrievalReport, routeQuery, rrfFuse, recordRouteOverride, SURFACE_IDS } =
      await import('../memory/query-router.js');
    type SurfaceOutcome = import('../memory/query-router.js').SurfaceOutcome;
    type FusableResult = import('../memory/query-router.js').FusableResult;

    try {
      const query = String(input.query);
      const limit = input.limit ? Number(input.limit) : 10;
      const route = routeQuery(query);
      const explicitSurfaces =
        Array.isArray(input.surfaces) && (input.surfaces as string[]).length
          ? (input.surfaces as string[])
          : null;
      const surfaces =
        explicitSurfaces ??
        (route.confident
          ? route.surfaces
          : ['chunks', ...route.surfaces.filter((s) => s !== 'chunks')]);

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
      // One surface failing must not erase the others' results, and must not
      // be reported as "nothing found" — each is settled independently and its
      // real outcome recorded below.
      const attempt = async <T>(
        run: () => Promise<T>,
      ): Promise<{ value: T } | { error: string }> => {
        try {
          return { value: await run() };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      };
      const [excerptsRes, graphRes, rulesRes, memoriesRes] = await Promise.all([
        surfaces.includes('chunks')
          ? attempt(() => searchKnowledge(query, chunkOpts))
          : Promise.resolve(null),
        projectSurfaces && surfaces.includes('kg')
          ? attempt(() => kg.kgSearch({ query, limit: 6 }))
          : Promise.resolve(null),
        projectSurfaces && surfaces.includes('rules')
          ? attempt(() =>
              bridge.bridgeSearchEntries({ query, namespace: 'rules', limit: 3, threshold: 0.35 }),
            )
          : Promise.resolve(null),
        projectSurfaces && surfaces.includes('memory')
          ? attempt(() => bridge.bridgeSearchEntries({ query, namespace: 'patterns', limit: 3 }))
          : Promise.resolve(null),
      ]);
      const excerpts = excerptsRes && 'value' in excerptsRes ? excerptsRes.value : [];
      const graph = graphRes && 'value' in graphRes ? graphRes.value : null;
      const rules = rulesRes && 'value' in rulesRes ? rulesRes.value : null;
      const memories = memoriesRes && 'value' in memoriesRes ? memoriesRes.value : null;

      // Confident non-chunk routing against an empty surface (e.g. a project
      // with no KG yet) must not read as "no knowledge" — fall back to chunks.
      // Same rule the CLI `doc search` path applies; without it agents got
      // "no results" where the CLI returned document excerpts.
      let fellBack = false;
      let chunkExcerpts = excerpts;
      if (
        !explicitSurfaces &&
        !chunkExcerpts.length &&
        !graph?.triplets?.length &&
        // An isolated entity IS a knowledge-graph answer — falling back past it
        // discarded the only result the requested surface had.
        !graph?.seeds?.length &&
        !rules?.results?.length &&
        !memories?.results?.length &&
        !surfaces.includes('chunks')
      ) {
        fellBack = true;
        recordRouteOverride(surfaces[0] as 'chunks' | 'kg' | 'rules' | 'memory', 'chunks');
        chunkExcerpts = await searchKnowledge(query, chunkOpts);
      }

      // Entities whose relations are not (yet) in the graph — kgSearch returns
      // them as `seeds`, and fusing only triplets dropped them entirely, so a
      // kg-only search over a graph with one standalone entity returned zero.
      const entities = (graph?.seeds ?? []).filter(
        (s) => !(graph?.triplets ?? []).some((t) => t.source === s.name || t.target === s.name),
      );

      // What each surface actually did — requested vs executed vs failed vs
      // unsupported, with the retrieval method the bridge really used.
      const scope = { store } as const;
      const outcome = (
        surface: import('../memory/query-router.js').KnowledgeSurface,
        requested: boolean,
        settled: { error: string } | { value: unknown } | null,
        results: number,
        extra: Partial<SurfaceOutcome> = {},
      ): SurfaceOutcome => {
        if (!requested) return { surface, status: 'not_requested' };
        if (settled && 'error' in settled)
          return { surface, status: 'failed', scope, detail: settled.error };
        return { surface, status: results > 0 ? 'executed' : 'empty', scope, results, ...extra };
      };
      const bridgeMeta = (
        r: { searchMethod?: string; fallbackReason?: string } | null,
      ): Partial<SurfaceOutcome> => ({
        ...(r?.searchMethod ? { method: r.searchMethod } : {}),
        ...(r?.fallbackReason ? { fallbackReason: r.fallbackReason } : {}),
      });
      const outcomes: SurfaceOutcome[] = [
        outcome(
          SURFACE_IDS.chunks,
          surfaces.includes('chunks') || fellBack,
          fellBack ? null : excerptsRes,
          chunkExcerpts.length,
          { method: 'document-index' },
        ),
        outcome(
          SURFACE_IDS.kg,
          surfaces.includes('kg'),
          graphRes,
          entities.length + (graph?.triplets?.length ?? 0),
          {
            // The seed retrieval kgSearch actually ran, not the one its name
            // suggests: a keyword fallback reported as vector search is the
            // overclaim this field exists to prevent. kgSearch names it `method`
            // (it is the graph's own answer, not a bridge passthrough).
            ...(graph?.method ? { method: graph.method } : {}),
            ...(graph?.fallbackReason ? { fallbackReason: graph.fallbackReason } : {}),
            ...(graph?.truncated ? { truncated: true } : {}),
            ...(graph?.error ? { detail: graph.error } : {}),
          },
        ),
        outcome(
          SURFACE_IDS.rules,
          surfaces.includes('rules'),
          rulesRes,
          rules?.results?.length ?? 0,
          bridgeMeta(rules),
        ),
        outcome(
          SURFACE_IDS.memory,
          surfaces.includes('memory'),
          memoriesRes,
          memories?.results?.length ?? 0,
          bridgeMeta(memories),
        ),
        // Never searched here by design; named so a code question cannot read
        // as "we looked and found nothing".
        {
          surface: 'code_graph',
          status: 'unsupported',
          detail: route.codeQuery
            ? 'This looks like a code-structure question. Knowledge search does not read parsed code — use monograph_query / monograph_impact / monograph_neighbors.'
            : 'Knowledge search does not read parsed code; use the monograph_* tools.',
        },
      ];
      // A kg-scoped surface is genuinely unavailable under store:'global'.
      if (!projectSurfaces)
        for (const o of outcomes)
          if (
            o.status === 'not_requested' &&
            (['memory_graph', 'rules', 'memory'] as string[]).includes(o.surface) &&
            surfaces.includes(
              o.surface === 'memory_graph' ? 'kg' : (o.surface as 'rules' | 'memory'),
            )
          ) {
            o.status = 'unsupported';
            o.detail =
              "store:'global' searches only the personal document brain — project-scoped surfaces are not part of it.";
          }
      const retrieval = buildRetrievalReport(outcomes);

      // Rank-fuse heterogeneous lists (raw scores aren't comparable). The type
      // argument is explicit because the lists are five different shapes: left
      // to infer, TS pins T to whichever list comes first and rejects the rest.
      const fused = rrfFuse<FusableResult>(
        [
          chunkExcerpts.map((e) => ({
            ...e,
            id: e.id || `${e.filePath}#${e.chunkIndex}`,
            kind: 'excerpt' as const,
          })),
          (graph?.triplets ?? []).map((t, i) => ({
            id: `kg:${i}:${t.source}|${t.relation}|${t.target}`,
            kind: 'triplet' as const,
            ...t,
          })),
          entities.map((s) => ({
            id: `kgent:${s.id || s.name}`,
            kind: 'entity' as const,
            name: s.name,
            entityType: s.type,
            text: s.description,
            score: s.score,
          })),
          (rules?.results ?? []).map((r) => ({
            id: r.id,
            kind: 'rule' as const,
            key: r.key,
            text: r.content,
            importance: 0.7,
          })),
          (memories?.results ?? []).map((r) => ({
            id: r.id,
            kind: 'memory' as const,
            key: r.key,
            text: r.content,
          })),
        ],
        limit,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: fused.length,
              routing: {
                surfaces,
                store,
                confident: route.confident,
                fellBackToChunks: fellBack,
                codeQuery: route.codeQuery,
              },
              retrieval,
              results: fused,
              // Back-compat: excerpt-only view for existing consumers. Id/metadata
              // projection only — `results` already carries the full chunk text, so
              // repeating it here doubled the payload of every search response.
              excerpts: chunkExcerpts.map((e) => ({
                id: e.id || `${e.filePath}#${e.chunkIndex}`,
                filePath: e.filePath,
                chunkIndex: e.chunkIndex,
                score: e.similarity,
                global: e.scope === 'global',
              })),
            }),
          },
        ],
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
  description:
    'Forget an indexed document — hidden from search and prompt injection until re-ingested. Errors if the path is not currently indexed.',
  category: 'knowledge',
  tags: ['documents', 'remove', 'second-brain'],
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the indexed document, as reported by knowledge_search / doc list',
      },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
      global: {
        type: 'boolean',
        description: 'Remove from the personal cross-project global brain instead of this project',
      },
    },
    required: ['path'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const pathCheck = validateInput(input.path, { type: 'path' });
    if (!pathCheck.valid) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: false, error: pathCheck.error }) },
        ],
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
      if (!indexed.some((d) => pathMod.resolve(d.filePath) === target)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Not indexed under scope '${scope}': ${target}`,
                indexedCount: indexed.length,
              }),
            },
          ],
          isError: true,
        };
      }

      await removeDocument(target, scope, root);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              filePath: target,
              scope,
              store: isGlobal ? 'global' : 'project',
              note: 'Hidden from search immediately; storage reclaimed on the next full re-index.',
            }),
          },
        ],
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
