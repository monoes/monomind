import type { FusableResult } from '../memory/query-router.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { FILTER_OPTIONS, hasFilter, libraryFilterFromFlags } from './doc-filters.js';

export const searchDocCommand: Command = {
  name: 'search',
  description: 'Semantic search over indexed documents',
  options: [
    { name: 'query', short: 'q', description: 'Search query', type: 'string', required: true },
    {
      name: 'limit',
      short: 'l',
      description: 'Max results (default: 10)',
      type: 'number',
      default: 10,
    },
    {
      name: 'scope',
      short: 's',
      description: 'Knowledge scope (default: shared)',
      type: 'string',
      default: 'shared',
    },
    {
      name: 'min-score',
      description: 'Minimum similarity (default: 0.3)',
      type: 'number',
      default: 0.3,
    },
    {
      name: 'store',
      description:
        'Which store(s): project | global | all (default: all — project results win ties)',
      type: 'string',
      default: 'all',
    },
    {
      name: 'surfaces',
      description:
        'Override routing: comma list of chunks,kg,rules,memory (default: rule-based router picks)',
      type: 'string',
    },
    // RCL-09: the same library facets as `doc list`, applied to chunk hits.
    ...FILTER_OPTIONS,
    { name: 'json', description: 'Emit JSON for programmatic use', type: 'boolean' },
  ],
  examples: [
    {
      command: 'monomind doc search -q "authentication flow"',
      description: 'Search project + global brain',
    },
    {
      command: 'monomind doc search -q "pricing notes" --store global',
      description: 'Search only the personal global brain',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = String(ctx.flags.query || ctx.args[0] || '');
    if (!query) {
      output.printError('Query required: monomind doc search -q "your query"');
      return { success: false, exitCode: 1 };
    }

    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const { routeQuery, rrfFuse, recordRouteOverride } = await import('../memory/query-router.js');
    const storeFlag = String(ctx.flags.store || 'all');
    const limit = Number(ctx.flags.limit || 10);

    // Same surface routing as the MCP knowledge_search tool and the warm
    // /api/knowledge/search endpoint: the rule-based router picks which
    // retrieval surfaces to spend queries on; --surfaces overrides it.
    const route = routeQuery(query);
    const VALID_SURFACES = ['chunks', 'kg', 'rules', 'memory'];
    const rawSurfaces = String(ctx.flags.surfaces || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const requested = rawSurfaces.filter((s) => VALID_SURFACES.includes(s));
    const invalidSurfaces = rawSurfaces.filter((s) => !VALID_SURFACES.includes(s));
    if (invalidSurfaces.length) {
      output.writeln(
        output.dim(
          `ignoring unknown surface(s): ${invalidSurfaces.join(',')} (valid: ${VALID_SURFACES.join(',')})`,
        ),
      );
    }
    const surfaces = requested.length
      ? requested
      : route.confident
        ? route.surfaces
        : ['chunks', ...route.surfaces.filter((s) => s !== 'chunks')];

    const bridge = await import('../memory/memory-bridge.js');
    const kg = await import('../memory/memory-kg.js');
    const [excerpts, graph, rules, memories] = await Promise.all([
      surfaces.includes('chunks')
        ? searchKnowledge(query, {
            scope: String(ctx.flags.scope || 'shared'),
            limit,
            minScore: Number(ctx.flags['min-score'] || 0.3),
            store: storeFlag === 'project' || storeFlag === 'global' ? storeFlag : 'all',
          })
        : [],
      surfaces.includes('kg') ? kg.kgSearch({ query, limit: 6 }).catch(() => null) : null,
      surfaces.includes('rules')
        ? bridge
            .bridgeSearchEntries({ query, namespace: 'rules', limit: 3, threshold: 0.35 })
            .catch(() => null)
        : null,
      surfaces.includes('memory')
        ? bridge.bridgeSearchEntries({ query, namespace: 'patterns', limit: 3 }).catch(() => null)
        : null,
    ]);

    // Confident non-chunk routing against an empty surface (e.g. a project
    // with no KG yet) must not read as "no knowledge" — fall back to chunks.
    let fellBack = false;
    let chunkExcerpts = excerpts;
    if (
      !requested.length &&
      !chunkExcerpts.length &&
      !graph?.triplets?.length &&
      !rules?.results?.length &&
      !memories?.results?.length &&
      !surfaces.includes('chunks')
    ) {
      fellBack = true;
      recordRouteOverride(surfaces[0] as 'chunks' | 'kg' | 'rules' | 'memory', 'chunks');
      chunkExcerpts = await searchKnowledge(query, {
        scope: String(ctx.flags.scope || 'shared'),
        limit,
        minScore: Number(ctx.flags['min-score'] || 0.3),
        store: storeFlag === 'project' || storeFlag === 'global' ? storeFlag : 'all',
      });
    }

    // RCL-09: a library filter narrows the CHUNK surface only — the graph,
    // rule and memory surfaces have no capture provenance to filter on, and
    // silently dropping them would change what `--site` appears to mean.
    const filter = libraryFilterFromFlags(ctx);
    if (hasFilter(filter)) {
      const { matchesLibraryFilter } = await import('../knowledge/library.js');
      chunkExcerpts = chunkExcerpts.filter((e) =>
        matchesLibraryFilter(
          {
            filePath: e.filePath,
            scope: e.scope,
            contentHash: '',
            chunkCount: 0,
            size: 0,
            indexedAt: '',
            ...(e.provenance?.canonicalUrl ? { canonicalUrl: e.provenance.canonicalUrl } : {}),
            ...(e.provenance ? { provenance: e.provenance } : {}),
          },
          filter,
        ),
      );
    }

    const fused = rrfFuse<FusableResult>(
      [
        chunkExcerpts.map((e) => ({
          ...e,
          id: e.id || `${e.filePath}#${e.chunkIndex}`,
          kind: 'excerpt' as const,
        })),
        (graph?.triplets ?? []).map((t, i) => ({
          ...t,
          id: `kg:${i}:${t.source}|${t.relation}|${t.target}`,
          kind: 'triplet' as const,
        })),
        (rules?.results ?? []).map((r) => ({
          id: r.id,
          kind: 'rule' as const,
          key: r.key,
          text: r.content,
          score: r.score,
          importance: 0.7,
        })),
        (memories?.results ?? []).map((r) => ({
          id: r.id,
          kind: 'memory' as const,
          key: r.key,
          text: r.content,
          score: r.score,
        })),
      ],
      limit,
    );

    if (ctx.flags.json === true) {
      output.writeln(JSON.stringify(fused, null, 2));
      return { success: true, data: fused };
    }

    if (!fused.length) {
      output.writeln(output.dim('No results found.'));
      return { success: true, data: [] };
    }

    output.writeln(
      output.bold(
        `${fused.length} results ${output.dim(`(surfaces: ${fellBack ? `${surfaces.join(',')} → chunks fallback` : surfaces.join(',')})`)}:`,
      ),
    );
    output.writeln();

    for (let i = 0; i < fused.length; i++) {
      const r = fused[i] as Record<string, unknown>;
      const n = output.highlight(`${i + 1}.`);
      if (r.kind === 'triplet') {
        const fact =
          r.fact && r.fact !== `${r.source} ${r.relation} ${r.target}`
            ? ` ${output.dim(`(${String(r.fact).slice(0, 160)})`)}`
            : '';
        output.writeln(`${n} ${output.dim('[kg]')} ${r.source} —${r.relation}→ ${r.target}${fact}`);
      } else if (r.kind === 'rule' || r.kind === 'memory') {
        output.writeln(
          `${n} ${output.dim(`[${r.kind}]`)} ${String(r.text || '')
            .replace(/\s+/g, ' ')
            .slice(0, 200)}`,
        );
      } else {
        const origin = r.scope === 'global' ? ` ${output.dim('[global]')}` : '';
        const sim = typeof r.similarity === 'number' ? `(${r.similarity.toFixed(3)}) ` : '';
        const prov = r.provenance as { title?: string; capturedAt?: string } | undefined;
        output.writeln(`${n} ${output.dim(sim)}${prov?.title ?? r.filePath ?? 'unknown'}${origin}`);
        const text = String(r.text || '');
        output.writeln(`   ${output.dim(text.length > 200 ? `${text.slice(0, 200)}...` : text)}`);
        // RCL-10: the anchor is what turns this hit into a citation —
        // `monomind doc cite <doc> --anchor <anchor>` prints the passage.
        if (r.anchor) {
          output.writeln(output.dim(`   cite: ${r.anchor} · chars ${r.startChar}-${r.endChar}`));
        }
      }
      output.writeln();
    }

    return { success: true, data: fused };
  },
};
