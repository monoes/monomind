/**
 * Monograph MCP Tools — monograph_query and monograph_suggest.
 * Extracted from query-tools.ts.
 */

import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { semanticEmbedder } from './semantic.js';
import type { ExpandedNode, SeedNode } from './shared.js';
import {
  _isValidDb,
  computeCommitsBehind,
  expandWithNeighbors,
  getDbPath,
  STALENESS_THRESHOLD,
  text,
  triggerBackgroundBuildIfNeeded,
} from './shared.js';

// ── monograph_query ───────────────────────────────────────────────────────────

export const monographQueryTool: MCPTool = {
  name: 'monograph_query',
  description:
    'Search the code knowledge graph: BM25 over names and symbol summaries, with LIKE/fuzzy fallback (mode=bm25: BM25 only). Higher score = better. Returns nodes with file:line.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search terms' },
      limit: { type: 'number', description: 'Max results (default 20)' },
      label: { type: 'string', description: 'Filter by node type: Class, Function, Method, etc.' },
      mode: {
        type: 'string',
        enum: ['bm25', 'hybrid'],
        description: 'Retrieval mode (default: hybrid)',
      },
      scope: {
        type: 'string',
        enum: ['auto', 'code', 'docs', 'agents', 'all'],
        description:
          'auto (default): code first, then docs; agent questions list agents first. Others restrict.',
      },
      expandNeighbors: {
        type: 'boolean',
        description: 'Add one hop of graph neighbors as separate supporting context (default true)',
      },
      damping: {
        type: 'number',
        description: 'Fraction of a hit score a neighbor inherits, 0-1 (default 0.5)',
      },
      tokenBudget: {
        type: 'number',
        description: 'Drop lowest-scored results beyond about this many tokens',
      },
    },
    required: ['query'],
  },
  handler: async (input) => {
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath))
      return text('Monograph index not built yet. Run monograph_build first.');
    const { openDb, closeDb, searchGraphFused } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      // Cap limit: passed directly to SQLite queries and searchGraph; an
      // unlimited value saturates memory with rows.
      const MAX_QUERY_LIMIT = 1_000;
      const rawLimit = (input.limit as number | undefined) ?? 20;
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), MAX_QUERY_LIMIT)
          : 20;
      // Cap query: passed to FTS5 via searchGraph; very long queries waste
      // parse time and can stress the FTS tokenizer.
      const MAX_MONOGRAPH_QUERY_LEN = 16 * 1024;
      const rawQuery = input.query as string;
      const query =
        typeof rawQuery === 'string' && rawQuery.length > MAX_MONOGRAPH_QUERY_LEN
          ? rawQuery.slice(0, MAX_MONOGRAPH_QUERY_LEN)
          : rawQuery;
      const label = input.label as string | undefined;
      const mode = input.mode === 'bm25' ? 'bm25' : 'hybrid';
      const scope =
        (['code', 'docs', 'agents', 'all'] as const).find((v) => v === input.scope) ?? 'auto';
      const expandNeighbors = (input.expandNeighbors as boolean | undefined) ?? true;
      const damping = input.damping as number | undefined;
      const tokenBudget = input.tokenBudget as number | undefined;

      // P2-9/P2-10: render results, prune to the token budget, and separate
      // direct matches from graph-derived supporting context. A node whose
      // displayed score was raised by a neighbor is never labelled a plain
      // lexical match — that overstated how well it matched the query.
      function render(results: ExpandedNode[]): string[] {
        const rendered = results.map((r) => {
          const loc = r.filePath
            ? r.startLine != null
              ? `${r.filePath}:${r.startLine}`
              : r.filePath
            : '';
          // P2-10: Agentic reason field — deterministic template, no LLM call.
          const why = r.isSupportingContext
            ? 'reached via graph neighbor'
            : r.scoreRaisedByNeighbors
              ? `direct ${mode} match, score raised by graph neighbors`
              : `direct ${mode} match`;
          return {
            node: r,
            line: `[${r.label}] ${r.name}  ${loc}  (score: ${r.score.toFixed(3)}, ${why})`,
          };
        });

        // P2-9: Token-budget pruning — ~4 chars per token heuristic. Prune in
        // score order (lowest dropped first) before grouping into sections.
        let kept = rendered;
        let prunedCount = 0;
        if (tokenBudget && tokenBudget > 0) {
          let totalChars = 0;
          const fit: typeof rendered = [];
          for (const entry of rendered) {
            const lineChars = entry.line.length + 1; // +1 for newline
            if (totalChars + lineChars > tokenBudget * 4) break;
            totalChars += lineChars;
            fit.push(entry);
          }
          prunedCount = rendered.length - fit.length;
          kept = fit;
        }

        const direct = kept.filter((e) => !e.node.isSupportingContext);
        const supporting = kept.filter((e) => e.node.isSupportingContext);
        const out: string[] = [];
        if (direct.length > 0) {
          out.push(`Direct matches (${direct.length}):`);
          for (const e of direct) out.push(`  ${e.line}`);
        }
        if (supporting.length > 0) {
          if (out.length > 0) out.push('');
          out.push(
            `Supporting context — graph neighbors, not query matches (${supporting.length}):`,
          );
          for (const e of supporting) out.push(`  ${e.line}`);
        }
        if (prunedCount > 0) {
          out.push(`(${prunedCount} more results pruned to fit token budget of ${tokenBudget})`);
        }
        return out;
      }

      const zeroResultHint =
        /\s/.test(query) && !/[A-Z]/.test(query.replace(/\s+/g, '').slice(1))
          ? ' Hint: monograph indexes identifiers and filenames — try camelCase/PascalCase (e.g. "AgentSpawn") or a filename instead of a phrase.'
          : '';

      // Lightweight staleness check — fire-and-forget background rebuild;
      // append warning to results so the agent knows data may be outdated.
      let stalenessNote = '';
      const repoPath = getProjectCwd();
      const staleness = await computeCommitsBehind(repoPath);
      if (staleness && staleness.commitsBehind > 0) {
        const triggered = triggerBackgroundBuildIfNeeded(repoPath, staleness.commitsBehind);
        stalenessNote = `\n⚠ Index is ${staleness.commitsBehind} commit(s) behind HEAD${triggered ? ' — rebuild triggered' : ''}.`;
      }

      // One retrieval path, shared with the package-level monograph_query tool.
      // searchGraph returns monograph's single score convention (higher is
      // better, never negative), so nothing here has to know about FTS5 rank.
      const results = await searchGraphFused(db, query, {
        limit: expandNeighbors ? limit * 2 : limit,
        label,
        mode,
        scope,
        embedder: await semanticEmbedder(db, dbPath),
      });
      if (results.length === 0) return text(`No results found.${zeroResultHint}${stalenessNote}`);

      const seeds: SeedNode[] = results.map((r) => ({
        id: r.id,
        name: r.name ?? r.id,
        label: r.label ?? '?',
        filePath: r.filePath ?? '',
        startLine: r.startLine ?? null,
        score: r.relevance,
      }));

      const ranked: ExpandedNode[] = expandNeighbors
        ? expandWithNeighbors(db, seeds, damping ?? 0.5, limit, { label })
        : seeds
            .slice(0, limit)
            .map((s) => ({ ...s, isSupportingContext: false, scoreRaisedByNeighbors: false }));

      return text(render(ranked).join('\n') + stalenessNote);
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_suggest ─────────────────────────────────────────────────────────

export const monographSuggestTool: MCPTool = {
  name: 'monograph_suggest',
  description:
    'Suggest where to start. With task=, the most relevant nodes (file:line) plus graph questions about them; without, graph-derived questions to explore.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Optional task description for task-relevance scoring' },
      limit: { type: 'number', description: 'Max nodes and max questions (default 10)' },
      checkStaleness: {
        type: 'boolean',
        description:
          'Check staleness and rebuild in the background when behind HEAD (default true)',
      },
    },
  },
  handler: async (input) => {
    // Health-aware mode (formerly monograph_suggest_auto): check staleness and
    // trigger a background rebuild if the index is behind HEAD. Defaults on
    // (opt-out, not opt-in) — a caller that never checked was exactly how a
    // stale graph kept serving results silently.
    let stalenessAnnotation = '';
    if (input.checkStaleness !== false) {
      const repoPath = getProjectCwd();
      const stalenessResult = await computeCommitsBehind(repoPath);
      const commitsBehind = stalenessResult?.commitsBehind ?? 0;
      const triggered = triggerBackgroundBuildIfNeeded(
        repoPath,
        commitsBehind,
        STALENESS_THRESHOLD + 1,
      );
      const status: 'fresh' | 'stale' | 'building' = triggered
        ? 'building'
        : commitsBehind === 0
          ? 'fresh'
          : 'stale';
      stalenessAnnotation = `\n_staleness: ${JSON.stringify({ commitsBehind, status, triggered })}`;
    }
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath))
      return text(
        `Monograph index not built yet. Run monograph_build first.${stalenessAnnotation}`,
      );
    const { openDb, closeDb, searchGraphFused, assessRelevance } = await import(
      '@monoes/monograph'
    );
    const db = openDb(dbPath);
    try {
      // "Run monograph_build" is only true when the graph has no nodes; a
      // built graph that has no answer for a query must say so instead.
      const { n: nodeCount } = db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number };
      if (nodeCount === 0)
        return text(`Monograph index is empty. Run monograph_build first.${stalenessAnnotation}`);
      // Cap limit and task: limit is passed directly to SQL LIMIT clause;
      // task is forwarded to searchGraph.
      const MAX_SUGGEST_LIMIT = 1_000;
      const MAX_SUGGEST_TASK_LEN = 16 * 1024;
      const rawSuggestLimit = (input.limit as number | undefined) ?? 10;
      const limit =
        Number.isFinite(rawSuggestLimit) && rawSuggestLimit > 0
          ? Math.min(Math.floor(rawSuggestLimit), MAX_SUGGEST_LIMIT)
          : 10;
      const rawTask = (input.task as string | undefined) ?? '';
      const task =
        typeof rawTask === 'string' && rawTask.length > MAX_SUGGEST_TASK_LEN
          ? rawTask.slice(0, MAX_SUGGEST_TASK_LEN)
          : rawTask;

      // Format a suggestion row as a navigable string for LLM consumption.
      // Includes file:line references so the LLM can jump directly to the code.
      const formatSuggestion = (r: any): string => {
        const srcLoc = r.src_file
          ? r.src_line != null
            ? `${r.src_file}:${r.src_line}`
            : r.src_file
          : '';
        const tgtLoc = r.tgt_file
          ? r.tgt_line != null
            ? `${r.tgt_file}:${r.tgt_line}`
            : r.tgt_file
          : '';
        const locHint = srcLoc ? `  [${srcLoc}${tgtLoc ? ` → ${tgtLoc}` : ''}]` : '';
        return `Why does ${r.src} ${r.relation.toLowerCase()} ${r.tgt}? (${r.confidence})${locHint}`;
      };

      // When a task is provided, use the shared retrieval service to find
      // relevant nodes and restrict the edge-level questions to them. This
      // used to be gated behind MONOGRAPH_EMBEDDINGS=true, which gated
      // nothing once vector retrieval was removed and just left this
      // better-ranked path off unless a caller happened to know about it.
      let hitIds: string[] = [];
      let nodeLines: string[] = [];
      if (task) {
        // scope "auto" ranks code ahead of documentation, so a task phrased in
        // generic words ("improve", "discovery") no longer fills the result
        // with headings from unrelated docs.
        const relevantHits = await searchGraphFused(db, task, {
          limit: Math.max(limit, 20),
          embedder: await semanticEmbedder(db, dbPath),
        });
        hitIds = [...new Set(relevantHits.map((h) => h.id))];
        // Ranked search always returns its best N; judge them against the task's own words.
        if (hitIds.length > 0 && !assessRelevance(db, task, relevantHits).relevant) {
          return text(
            `No relevant match for this task in the built graph (${nodeCount} nodes): the closest nodes share too few of its words. ` +
              'Try identifiers (camelCase/PascalCase) or filenames, or the concept may not exist in the code yet.' +
              stalenessAnnotation,
          );
        }
        if (hitIds.length === 0) {
          return text(
            `No nodes match this task in the built graph (${nodeCount} nodes). ` +
              'Try identifiers (camelCase/PascalCase) or filenames from the codebase.' +
              stalenessAnnotation,
          );
        }
        // The task-ranked nodes are the answer; edge questions are extra.
        nodeLines = relevantHits.slice(0, limit).map((h) => {
          const loc = h.filePath
            ? h.startLine != null
              ? `${h.filePath}:${h.startLine}`
              : h.filePath
            : '';
          return `  [${h.label}] ${h.name}  ${loc}  (score: ${h.relevance.toFixed(3)})`;
        });
      }

      const taskFilter = hitIds.length
        ? `AND (e.source_id IN (${hitIds.map(() => '?').join(',')}) OR e.target_id IN (${hitIds.map(() => '?').join(',')}))`
        : '';
      const rows = db
        .prepare(`
        SELECT e.relation, e.confidence, n1.name as src, n2.name as tgt,
               n1.file_path as src_file, n1.start_line as src_line,
               n2.file_path as tgt_file, n2.start_line as tgt_line
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence IN ('AMBIGUOUS', 'INFERRED')
          AND e.relation != 'CO_OCCURS'
        ${taskFilter}
        LIMIT 100
      `)
        .all(...hitIds, ...hitIds) as any[];

      const questions = rows.map(formatSuggestion).slice(0, limit);
      if (task) {
        const out = [`Relevant nodes for this task (${nodeLines.length}):`, ...nodeLines];
        if (questions.length > 0) out.push('', 'Open questions about these nodes:', ...questions);
        return text(out.join('\n') + stalenessAnnotation);
      }
      const fallback =
        'No open questions: the graph has no AMBIGUOUS/INFERRED edges. ' +
        'Pass task= to get the nodes relevant to a task.';
      return text((questions.join('\n') || fallback) + stalenessAnnotation);
    } finally {
      closeDb(db);
    }
  },
};
