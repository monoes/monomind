/**
 * CLI Document Command — Second Brain document management
 */

import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { getGlobalBrainDir } from '../memory/memory-bridge.js';

const ingestCommand: Command = {
  name: 'ingest',
  description: 'Ingest documents into the knowledge base',
  options: [
    // No `default` on scope: the auto-global routing below must be able to
    // tell "user typed --scope shared" apart from "user typed nothing" — a
    // parser-injected default makes them indistinguishable.
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared; auto-routes to global for paths outside the project)', type: 'string' },
    { name: 'global', short: 'g', description: 'Ingest into the personal cross-project global brain (~/.monomind/global-brain)', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind doc ingest ./docs', description: 'Ingest all docs in a directory' },
    { command: 'monomind doc ingest ~/notes --global', description: 'Ingest into the global brain (auto-detected for paths outside the project)' },
    { command: 'monomind doc ingest report.pdf', description: 'Ingest a single file' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0] || '.';

    const { ingestDocument, ingestDirectory } = await import('../knowledge/document-pipeline.js');
    const fs = await import('node:fs');
    const resolved = path.resolve(target);

    // Zero-decision routing: an explicit --global wins; otherwise paths OUTSIDE
    // the current project belong to the personal brain (a project store keyed
    // to this cwd would never see them again from another project).
    let scope = String(ctx.flags.scope || 'shared');
    if (ctx.flags.global === true) {
      scope = 'global';
    } else if (!ctx.flags.scope) {
      const relToCwd = path.relative(process.cwd(), resolved);
      if (relToCwd.startsWith('..') || path.isAbsolute(relToCwd)) {
        scope = 'global';
        output.writeln(output.dim(`  ${target} is outside this project — ingesting into the global brain (use --scope shared to force project scope)`));
      }
    }

    const spinner = output.createSpinner({ text: 'Indexing documents...' });
    spinner.start();

    try {
      const stat = fs.statSync(resolved);

      if (stat.isDirectory()) {
        const result = await ingestDirectory(resolved, scope, {
          rootDir: ctx.cwd || process.cwd(),
          onProgress: (file, done, total) => {
            spinner.setText(`[${done + 1}/${total}] ${path.basename(file)}`);
          },
        });
        spinner.succeed(`Indexed ${result.totalChunks} chunks from ${result.filesProcessed} files (${result.filesSkipped} skipped)`);
        if (result.errors.length) {
          output.writeln(output.dim(`  Errors: ${result.errors.length}`));
          for (const err of result.errors.slice(0, 5)) {
            output.writeln(output.dim(`    ${err}`));
          }
        }
        return { success: true, data: result };
      } else {
        const result = await ingestDocument(resolved, scope);
        if (result.skipped && !result.error) {
          spinner.succeed(`Already indexed: ${path.basename(resolved)} (${result.chunksIndexed} chunks)`);
        } else if (result.error) {
          spinner.fail(result.error);
          return { success: false };
        } else {
          spinner.succeed(`Indexed ${result.chunksIndexed} chunks from ${path.basename(resolved)}`);
        }
        return { success: true, data: result };
      }
    } catch (err) {
      spinner.fail(String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

const searchDocCommand: Command = {
  name: 'search',
  description: 'Semantic search over indexed documents',
  options: [
    { name: 'query', short: 'q', description: 'Search query', type: 'string', required: true },
    { name: 'limit', short: 'l', description: 'Max results (default: 10)', type: 'number', default: 10 },
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'min-score', description: 'Minimum similarity (default: 0.3)', type: 'number', default: 0.3 },
    { name: 'store', description: 'Which store(s): project | global | all (default: all — project results win ties)', type: 'string', default: 'all' },
    { name: 'surfaces', description: "Override routing: comma list of chunks,kg,rules,memory (default: rule-based router picks)", type: 'string' },
  ],
  examples: [
    { command: 'monomind doc search -q "authentication flow"', description: 'Search project + global brain' },
    { command: 'monomind doc search -q "pricing notes" --store global', description: 'Search only the personal global brain' },
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
    const rawSurfaces = String(ctx.flags.surfaces || '').split(',').map(s => s.trim()).filter(Boolean);
    const requested = rawSurfaces.filter(s => VALID_SURFACES.includes(s));
    const invalidSurfaces = rawSurfaces.filter(s => !VALID_SURFACES.includes(s));
    if (invalidSurfaces.length) {
      output.writeln(output.dim(`ignoring unknown surface(s): ${invalidSurfaces.join(',')} (valid: ${VALID_SURFACES.join(',')})`));
    }
    const surfaces = requested.length
      ? requested
      : (route.confident ? route.surfaces : ['chunks', ...route.surfaces.filter(s => s !== 'chunks')]);

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
      surfaces.includes('rules') ? bridge.bridgeSearchEntries({ query, namespace: 'rules', limit: 3, threshold: 0.35 }).catch(() => null) : null,
      surfaces.includes('memory') ? bridge.bridgeSearchEntries({ query, namespace: 'patterns', limit: 3 }).catch(() => null) : null,
    ]);

    // Confident non-chunk routing against an empty surface (e.g. a project
    // with no KG yet) must not read as "no knowledge" — fall back to chunks.
    let fellBack = false;
    let chunkExcerpts = excerpts;
    if (!requested.length && !chunkExcerpts.length && !(graph?.triplets?.length) && !(rules?.results?.length) && !(memories?.results?.length) && !surfaces.includes('chunks')) {
      fellBack = true;
      recordRouteOverride(surfaces[0] as 'chunks' | 'kg' | 'rules' | 'memory', 'chunks');
      chunkExcerpts = await searchKnowledge(query, {
        scope: String(ctx.flags.scope || 'shared'),
        limit,
        minScore: Number(ctx.flags['min-score'] || 0.3),
        store: storeFlag === 'project' || storeFlag === 'global' ? storeFlag : 'all',
      });
    }

    const fused = rrfFuse([
      chunkExcerpts.map(e => ({ id: e.id || `${e.filePath}#${e.chunkIndex}`, kind: 'excerpt' as const, ...e })),
      (graph?.triplets ?? []).map((t, i) => ({ id: `kg:${i}:${t.source}|${t.relation}|${t.target}`, kind: 'triplet' as const, ...t })),
      (rules?.results ?? []).map(r => ({ id: r.id, kind: 'rule' as const, key: r.key, text: r.content, score: r.score, importance: 0.7 })),
      (memories?.results ?? []).map(r => ({ id: r.id, kind: 'memory' as const, key: r.key, text: r.content, score: r.score })),
    ], limit);

    if (!fused.length) {
      output.writeln(output.dim('No results found.'));
      return { success: true, data: [] };
    }

    output.writeln(output.bold(`${fused.length} results ${output.dim(`(surfaces: ${fellBack ? surfaces.join(',') + ' → chunks fallback' : surfaces.join(',')})`)}:`));
    output.writeln();

    for (let i = 0; i < fused.length; i++) {
      const r = fused[i] as Record<string, unknown>;
      const n = output.highlight(`${i + 1}.`);
      if (r.kind === 'triplet') {
        const fact = r.fact && r.fact !== `${r.source} ${r.relation} ${r.target}` ? ` ${output.dim(`(${String(r.fact).slice(0, 160)})`)}` : '';
        output.writeln(`${n} ${output.dim('[kg]')} ${r.source} —${r.relation}→ ${r.target}${fact}`);
      } else if (r.kind === 'rule' || r.kind === 'memory') {
        output.writeln(`${n} ${output.dim(`[${r.kind}]`)} ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 200)}`);
      } else {
        const origin = r.scope === 'global' ? ` ${output.dim('[global]')}` : '';
        const sim = typeof r.similarity === 'number' ? `(${r.similarity.toFixed(3)}) ` : '';
        output.writeln(`${n} ${output.dim(sim)}${r.filePath || 'unknown'}${origin}`);
        const text = String(r.text || '');
        output.writeln(`   ${output.dim(text.length > 200 ? text.slice(0, 200) + '...' : text)}`);
      }
      output.writeln();
    }

    return { success: true, data: fused };
  },
};

const listDocCommand: Command = {
  name: 'list',
  description: 'List indexed documents',
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope', type: 'string' },
    { name: 'global', short: 'g', description: 'List the personal cross-project global brain', type: 'boolean' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { listDocuments } = await import('../knowledge/document-pipeline.js');
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : ctx.flags.scope ? String(ctx.flags.scope) : undefined;
    const docs = listDocuments(isGlobal ? getGlobalBrainDir() : process.cwd(), scope);

    if (!docs.length) {
      output.writeln(output.dim('No documents indexed. Run: monomind doc ingest <path>'));
      return { success: true, data: [] };
    }

    output.writeln(output.bold(`${docs.length} documents indexed:`));
    output.writeln();

    for (const doc of docs) {
      const name = path.basename(doc.filePath);
      const size = doc.size > 1024 * 1024
        ? `${(doc.size / 1024 / 1024).toFixed(1)}MB`
        : `${(doc.size / 1024).toFixed(0)}KB`;
      const date = doc.indexedAt.slice(0, 10);
      output.writeln(`  ${output.highlight(name)} ${output.dim(`${doc.chunkCount} chunks · ${size} · ${date} · ${doc.scope}`)}`);
    }

    return { success: true, data: docs };
  },
};

const exportDocCommand: Command = {
  name: 'export',
  description: 'Export knowledge base as OKF bundle (markdown + frontmatter)',
  options: [
    { name: 'output', short: 'o', description: 'Output directory', type: 'string', default: '.monomind/knowledge-export' },
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'global', short: 'g', description: 'Export the personal cross-project global brain (portable between machines)', type: 'boolean' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { exportToOKF } = await import('../knowledge/document-pipeline.js');
    const outDir = path.resolve(String(ctx.flags.output || '.monomind/knowledge-export'));
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : String(ctx.flags.scope || 'shared');

    const spinner = output.createSpinner({ text: 'Exporting to OKF...' });
    spinner.start();

    try {
      const result = await exportToOKF(outDir, isGlobal ? getGlobalBrainDir() : process.cwd(), scope);
      spinner.succeed(`Exported ${result.exported} documents to ${result.outputDir}`);
      return { success: true, data: result };
    } catch (err) {
      spinner.fail(String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

export const docCommand: Command = {
  name: 'doc',
  description: 'Second Brain — document knowledge management',
  aliases: ['docs', 'knowledge'],
  subcommands: [ingestCommand, searchDocCommand, listDocCommand, exportDocCommand],
  options: [],
  examples: [
    { command: 'monomind doc ingest ./docs', description: 'Index documents' },
    { command: 'monomind doc search -q "auth flow"', description: 'Semantic search' },
    { command: 'monomind doc list', description: 'List indexed docs' },
    { command: 'monomind doc export', description: 'Export as OKF bundle' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Second Brain — Document Knowledge Management'));
    output.writeln();
    output.writeln('Usage: monomind doc <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('ingest')}  - Ingest documents into the knowledge base`,
      `${output.highlight('search')}  - Semantic search over indexed documents`,
      `${output.highlight('list')}    - List indexed documents`,
      `${output.highlight('export')}  - Export as OKF bundle (markdown + frontmatter)`,
    ]);
    return { success: true };
  },
};

export default docCommand;
