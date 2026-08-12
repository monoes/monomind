/**
 * CLI Document Command — Second Brain document management
 */

import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { getGlobalBrainDir, getProjectRoot } from '../memory/memory-bridge.js';

const ingestCommand: Command = {
  name: 'ingest',
  description: 'Ingest documents into the knowledge base',
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared; auto-routes to global for paths outside the project)', type: 'string' },
    { name: 'global', short: 'g', description: 'Ingest into the personal cross-project global brain (~/.monomind/global-brain)', type: 'boolean' },
    { name: 'embedder', description: 'Embedding model for this ingest: minilm (default, 384d) or bge-m3 (1024d, 8192-token context, 100+ languages; ~600MB+ download on first use)', type: 'string', default: 'minilm' },
  ],
  examples: [
    { command: 'monomind doc ingest ./docs', description: 'Ingest all docs in a directory' },
    { command: 'monomind doc ingest ~/notes --global', description: 'Ingest into the global brain (auto-detected for paths outside the project)' },
    { command: 'monomind doc ingest report.pdf', description: 'Ingest a single file' },
    { command: 'monomind doc ingest ./docs --embedder bge-m3', description: 'Ingest using BGE-M3 (higher quality, larger model)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0] || '.';

    // P2-6: Wire embedder override before any embedding work happens.
    const embedder = ctx.flags.embedder as string | undefined;
    if (embedder && embedder !== 'minilm') {
      const { setEmbedderOverride } = await import('../memory/embedding-operations.js');
      try {
        setEmbedderOverride(embedder);
        output.writeln(output.dim(`  Using embedder: ${embedder}`));
      } catch (e) {
        output.printWarning(`Unknown embedder '${embedder}'. Available: minilm, bge-m3. Using default.`);
      }
    }

    const { ingestDocument, ingestDirectory } = await import('../knowledge/document-pipeline.js');
    const fs = await import('node:fs');
    const resolved = path.resolve(target);

    // Zero-decision routing: an explicit --global wins; otherwise paths OUTSIDE
    // this project belong to the personal brain (a project-scoped store would
    // never surface them again from another project).
    let scope = String(ctx.flags.scope || 'shared');
    if (ctx.flags.global === true) {
      scope = 'global';
    } else if (!ctx.flags.scope) {
      // Against the PROJECT ROOT, not the cwd: from a package subdirectory,
      // `doc ingest ../../docs` targets this very project, and routing it to
      // the personal brain because it sits above the cwd is simply wrong.
      const relToCwd = path.relative(getProjectRoot(ctx.cwd || process.cwd()), resolved);
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
          rootDir: getProjectRoot(ctx.cwd || process.cwd()),
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
    const docs = listDocuments(isGlobal ? getGlobalBrainDir() : getProjectRoot(), scope);

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
      const result = await exportToOKF(outDir, isGlobal ? getGlobalBrainDir() : getProjectRoot(), scope);
      spinner.succeed(`Exported ${result.exported} documents to ${result.outputDir}`);
      return { success: true, data: result };
    } catch (err) {
      spinner.fail(String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

const removeDocCommand: Command = {
  name: 'remove',
  description: 'Forget an indexed document',
  aliases: ['rm', 'forget'],
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'global', short: 'g', description: 'Remove from the personal cross-project global brain', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind doc remove ./docs/old-spec.md', description: 'Stop returning a document in search' },
    { command: 'monomind doc remove ~/notes/stale.md --global', description: 'Forget it from the personal brain' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0];
    if (!target) {
      output.printError('Document path required: monomind doc remove <path>');
      return { success: false, exitCode: 1 };
    }

    const { listDocuments, removeDocument } = await import('../knowledge/document-pipeline.js');
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : String(ctx.flags.scope || 'shared');
    const root = isGlobal ? getGlobalBrainDir() : getProjectRoot();
    const resolved = path.resolve(target);

    // The metadata log keys on the resolved path recorded at ingest, so a
    // mistyped path would otherwise write a tombstone that matches nothing and
    // report success. Fail like `rm` does instead.
    if (!listDocuments(root, scope).some(d => path.resolve(d.filePath) === resolved)) {
      output.printError(`Not indexed under scope '${scope}': ${resolved}`);
      output.writeln(output.dim(`  See what is indexed: monomind doc list${isGlobal ? ' --global' : ''}`));
      return { success: false, exitCode: 1 };
    }

    await removeDocument(resolved, scope, root);
    output.writeln(`Forgot ${output.highlight(path.basename(resolved))} (${scope})`);
    // Honest about what happened on disk: the tombstone hides the chunks from
    // every search surface, but the bridge exposes no delete-by-prefix, so the
    // rows themselves go on the next full re-index.
    output.writeln(output.dim('  Chunks are hidden from search immediately; storage is reclaimed on the next full re-index.'));
    return { success: true, data: { filePath: resolved, scope } };
  },
};

const reconcileDocCommand: Command = {
  name: 'reconcile',
  description: 'Find and forget indexed documents whose source file no longer exists',
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'global', short: 'g', description: 'Reconcile the personal cross-project global brain', type: 'boolean' },
    { name: 'apply', description: 'Actually forget the stale entries (default: dry run)', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind doc reconcile', description: 'Show indexed documents whose file is gone (changes nothing)' },
    { command: 'monomind doc reconcile --apply', description: 'Forget them' },
    { command: 'monomind doc reconcile --global --apply', description: 'Same, for the personal brain' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { reconcileIndex } = await import('../knowledge/document-pipeline.js');
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : String(ctx.flags.scope || 'shared');
    const root = isGlobal ? getGlobalBrainDir() : getProjectRoot();
    const apply = ctx.flags.apply === true;

    let report;
    try {
      report = await reconcileIndex(root, { scope, apply });
    } catch (err) {
      // reconcileIndex refuses to run against a missing root or a missing
      // metadata log, because there every indexed file looks deleted. Surface
      // that as a refusal, never as "0 stale entries found".
      output.printError(String(err instanceof Error ? err.message : err));
      return { success: false, exitCode: 1 };
    }

    if (report.missing.length === 0) {
      output.writeln(`Index is consistent — all ${report.scanned} indexed documents still exist.`);
      return { success: true, data: report };
    }

    output.writeln(
      `${output.highlight(String(report.missing.length))} of ${report.scanned} indexed documents no longer exist on disk:`,
    );
    for (const m of report.missing.slice(0, 20)) {
      output.writeln(output.dim(`  ${m.filePath}`));
    }
    if (report.missing.length > 20) {
      output.writeln(output.dim(`  ... and ${report.missing.length - 20} more`));
    }

    if (!apply) {
      // Dry run is the default because "the file is missing" also describes an
      // unmounted volume, a checked-out branch, and a partial clone. The user
      // is the one who knows which it is.
      output.writeln('');
      output.writeln(output.dim('Nothing was changed. Re-run with --apply to forget these entries.'));
      return { success: true, data: report };
    }

    output.writeln('');
    output.writeln(`Forgot ${output.highlight(String(report.removed))} stale ${report.removed === 1 ? 'entry' : 'entries'}.`);
    if (report.archivePath) {
      output.writeln(output.dim(`  Archived first, and reversible from: ${report.archivePath}`));
    }
    output.writeln(output.dim('  Chunks are hidden from search immediately; storage is reclaimed on the next full re-index.'));
    return { success: true, data: report };
  },
};

const importDocCommand: Command = {
  name: 'import',
  description: 'Import an OKF bundle produced by `doc export`',
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope (default: shared)', type: 'string', default: 'shared' },
    { name: 'global', short: 'g', description: 'Import into the personal cross-project global brain', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind doc import ./.monomind/knowledge-export', description: 'Import a bundle into this project' },
    { command: 'monomind doc import ~/brain-bundle --global', description: 'Restore a personal brain on another machine' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const bundle = ctx.args[0];
    if (!bundle) {
      output.printError('Bundle directory required: monomind doc import <bundle-dir>');
      return { success: false, exitCode: 1 };
    }

    const { importFromOKF } = await import('../knowledge/document-pipeline.js');
    const fs = await import('node:fs');
    const resolved = path.resolve(bundle);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      output.printError(`Not a directory: ${resolved}`);
      return { success: false, exitCode: 1 };
    }

    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : String(ctx.flags.scope || 'shared');

    const spinner = output.createSpinner({ text: 'Importing OKF bundle...' });
    spinner.start();

    try {
      // importFromOKF, not ingestDirectory: the bundle's own index.md is a
      // manifest, not knowledge, and plain ingest would index it as a document.
      const result = await importFromOKF(resolved, scope, isGlobal ? getGlobalBrainDir() : getProjectRoot());
      spinner.succeed(`Imported ${result.totalChunks} chunks from ${result.filesProcessed} documents (${result.filesSkipped} already indexed)`);
      if (result.errors.length) {
        output.writeln(output.dim(`  Errors: ${result.errors.length}`));
        for (const err of result.errors.slice(0, 5)) output.writeln(output.dim(`    ${err}`));
      }
      return { success: true, data: result };
    } catch (err) {
      spinner.fail(String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

const evalCommand: Command = {
  name: 'eval',
  description: 'Measure retrieval quality (Recall@1/5/10, MRR@10) on the local golden set',
  aliases: ['benchmark', 'scoreboard'],
  options: [
    { name: 'split', description: "Golden-set split: dev (tunable) | test (sealed, stop-condition only) | all", type: 'string', default: 'dev' },
    { name: 'k', description: 'Retrieval cutoff (default: 10)', type: 'number', default: 10 },
    { name: 'json', description: 'Emit the machine-readable report only', type: 'boolean' },
    { name: 'out', short: 'o', description: 'Write the JSON report to this path', type: 'string' },
    { name: 'rebuild', description: 'Rebuild the isolated eval store from scratch', type: 'boolean' },
    { name: 'screen', description: 'Screen a JSON file of candidate golden pairs for lexical overlap before adding them', type: 'string' },
    { name: 'provision-model', description: 'Download the embedding weights (the ONLY networked step; run once before evaluating)', type: 'boolean' },
    { name: 'store-root', description: 'Where the isolated eval store lives (default: <repo>/.monomind/eval)', type: 'string' },
  ],
  examples: [
    { command: 'monomind doc eval', description: 'Score the dev split and print the table' },
    { command: 'monomind doc eval --split test --json', description: 'Sealed run — aggregates only, appended to the exposure ledger' },
    { command: 'monomind doc eval --provision-model', description: 'One-off: fetch the embedding weights (the only networked step)' },
    { command: 'monomind doc eval --out scoreboard.json', description: 'Persist the machine-readable report' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { runEval, renderReport } = await import('../knowledge/eval/harness.js');

    // Authoring-time screening: reject high-overlap candidates BEFORE they
    // enter the set, rather than discovering the distribution afterwards.
    if (ctx.flags.screen) {
      const fs = await import('node:fs');
      const { screenCandidates } = await import('../knowledge/eval/harness.js');
      const cands = JSON.parse(fs.readFileSync(String(ctx.flags.screen), 'utf8'));
      const rep = await screenCandidates(getProjectRoot(ctx.cwd || process.cwd()), cands);
      if (ctx.flags.out) fs.writeFileSync(String(ctx.flags.out), JSON.stringify(rep, null, 2));
      if (ctx.flags.json === true) { output.writeln(JSON.stringify(rep, null, 2)); return { success: true, data: rep }; }
      output.writeln(`\nscreened ${rep.total}: ${rep.accepted} accepted, ${rep.rejected} rejected (corpus ${rep.corpusHash})`);
      output.writeln(`overlap bands of accepted: low ${rep.bands.low}  mid ${rep.bands.mid}  high ${rep.bands.high}`);
      for (const c of rep.candidates.filter(x => !x.accepted)) output.writeln(`  REJECT ${c.id}: ${c.reason}`);
      return { success: true, data: rep };
    }

    // The explicit, non-query-time provisioning step. Separating this from
    // measurement is what makes "clean checkout" and "zero network at query
    // time" jointly satisfiable — `doc eval` itself never fetches.
    if (ctx.flags['provision-model'] === true) {
      const { provisionModel } = await import('../knowledge/eval/model-presence.js');
      try {
        const p = await provisionModel(m => output.writeln(output.dim('  ' + m)));
        output.printSuccess(`Models provisioned (embedding: ${(p.bytes / 1e6).toFixed(0)}MB).`);
        return { success: true, data: p };
      } catch (err) {
        output.printError(String(err instanceof Error ? err.message : err));
        return { success: false, exitCode: 1 };
      }
    }

    const split = String(ctx.flags.split || 'dev');
    if (!['dev', 'test', 'all'].includes(split)) {
      output.printError(`--split must be dev, test or all (got "${split}")`);
      return { success: false, exitCode: 1 };
    }
    const asJson = ctx.flags.json === true;
    const repoRoot = getProjectRoot(ctx.cwd || process.cwd());

    try {
      const report = await runEval({
        repoRoot,
        k: Number(ctx.flags.k || 10),
        rebuild: ctx.flags.rebuild === true,
        storeRoot: ctx.flags['store-root'] ? String(ctx.flags['store-root']) : undefined,
        split: split as 'dev' | 'test' | 'all',
        onProgress: (msg) => { if (!asJson) output.writeln(output.dim('  ' + msg)); },
      });

      if (ctx.flags.out) {
        const fs = await import('node:fs');
        fs.writeFileSync(String(ctx.flags.out), JSON.stringify(report, null, 2));
      }
      if (asJson) output.writeln(JSON.stringify(report, null, 2));
      else output.writeln(renderReport(report));

      // A network attempt during the query phase invalidates the run outright.
      return { success: report.networkFree.verdict === 'proven-blocked', data: report };
    } catch (err) {
      output.printError(String(err instanceof Error ? err.message : err));
      return { success: false, exitCode: 1 };
    }
  },
};

export const docCommand: Command = {
  name: 'doc',
  description: 'Second Brain — document knowledge management',
  aliases: ['docs', 'knowledge'],
  subcommands: [ingestCommand, searchDocCommand, listDocCommand, exportDocCommand, importDocCommand, removeDocCommand, reconcileDocCommand, evalCommand],
  options: [],
  examples: [
    { command: 'monomind doc ingest ./docs', description: 'Index documents' },
    { command: 'monomind doc search -q "auth flow"', description: 'Semantic search' },
    { command: 'monomind doc list', description: 'List indexed docs' },
    { command: 'monomind doc export', description: 'Export as OKF bundle' },
    { command: 'monomind doc import ./bundle', description: 'Import an OKF bundle' },
    { command: 'monomind doc remove ./docs/old.md', description: 'Forget an indexed document' },
    { command: 'monomind doc eval', description: 'Score retrieval quality on the golden set' },
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
      `${output.highlight('import')}  - Import an OKF bundle produced by export`,
      `${output.highlight('remove')}  - Forget an indexed document (aliases: rm, forget)`,
      `${output.highlight('eval')}    - Retrieval-quality scoreboard: Recall@1/5/10, MRR@10`,
    ]);
    return { success: true };
  },
};

export default docCommand;
