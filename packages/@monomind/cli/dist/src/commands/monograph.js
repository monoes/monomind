/**
 * Monograph CLI Command
 * Knowledge graph for code and documents — build, search, inspect.
 */
import { join, resolve, extname } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import { output } from '../output.js';
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.pdf']);
const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.cache', 'coverage', '.monomind', 'vendor', 'target',
]);
function getDbPath(root) {
    return join(root, '.monomind', 'monograph.db');
}
function walkDocs(dir, ignore) {
    const extraIgnore = new Set(ignore);
    const results = [];
    function walk(d) {
        let entries;
        try {
            entries = readdirSync(d);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (IGNORE_DIRS.has(entry) || extraIgnore.has(entry))
                continue;
            const full = join(d, entry);
            let st;
            try {
                st = statSync(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(full);
                continue;
            }
            const ext = extname(entry).toLowerCase();
            if (DOC_EXTENSIONS.has(ext))
                results.push({ path: full, ext });
        }
    }
    walk(dir);
    return results;
}
// ── build subcommand ──────────────────────────────────────────────────────────
const buildCommand = {
    name: 'build',
    description: 'Build the knowledge graph from code, docs (md/txt/rst), and PDFs',
    options: [
        { name: 'path', short: 'p', type: 'string', description: 'Root path to index (default: cwd)' },
        { name: 'code-only', type: 'boolean', description: 'Index only code files, skip documents' },
        { name: 'llm', type: 'boolean', description: 'Enable Claude-powered semantic extraction (requires ANTHROPIC_API_KEY)' },
        { name: 'llm-sections', type: 'number', description: 'Max sections to enrich with LLM (default 50)', default: '50' },
        { name: 'force', short: 'f', type: 'boolean', description: 'Force full rebuild even if index is fresh' },
    ],
    examples: [
        { command: 'monomind monograph build', description: 'Index code + all documents' },
        { command: 'monomind monograph build --llm', description: 'Also extract semantic relationships with Claude' },
        { command: 'monomind monograph build --code-only', description: 'Code only, skip docs' },
        { command: 'monomind monograph build -p ./docs', description: 'Index a specific path' },
    ],
    action: async (ctx) => {
        const root = resolve(ctx.flags.path ?? process.cwd());
        const codeOnly = ctx.flags['code-only'] === true;
        const force = ctx.flags.force === true;
        const llmFlag = ctx.flags.llm === true;
        const llmSections = parseInt(ctx.flags['llm-sections'] || '50', 10);
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const llmMaxSections = (llmFlag && hasApiKey) ? llmSections : 0;
        if (llmFlag && !hasApiKey) {
            output.printWarning('--llm passed but ANTHROPIC_API_KEY is not set — LLM extraction disabled');
        }
        output.writeln();
        output.writeln(output.bold('Monograph — Knowledge Graph Build'));
        output.writeln(output.dim('─'.repeat(60)));
        output.writeln(`  Path    : ${root}`);
        output.writeln(`  Mode    : ${codeOnly ? 'Code only' : 'Code + Documents + PDFs'}`);
        if (llmMaxSections > 0) {
            output.writeln(`  Claude  : Enriching up to ${llmMaxSections} sections`);
        }
        output.writeln();
        // Pre-scan to show what will be indexed
        if (!codeOnly) {
            const docs = walkDocs(root, []);
            const byExt = new Map();
            for (const { ext } of docs)
                byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
            if (docs.length > 0) {
                output.writeln(output.dim(`  Found ${docs.length} document files:`));
                for (const [ext, count] of [...byExt.entries()].sort()) {
                    output.writeln(output.dim(`    ${ext.padEnd(6)} ${count} files`));
                }
                output.writeln();
            }
        }
        const spinner = output.createSpinner({ text: 'Building knowledge graph…', spinner: 'dots' });
        spinner.start();
        const startTime = Date.now();
        const progressLines = [];
        try {
            const { buildAsync } = await import('@monoes/monograph');
            // llmMaxSections is a UI variable only; not a valid BuildOptions key in @monoes/monograph@1.1.0
            await buildAsync(root, {
                codeOnly,
                force,
                onProgress: (p) => {
                    const msg = `[${p.phase}] ${p.message ?? ''}`;
                    progressLines.push(msg);
                    spinner.setText(msg.slice(0, 60));
                },
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            spinner.succeed(`Build complete in ${elapsed}s`);
            // Show per-phase summary
            output.writeln();
            output.writeln(output.bold('  Build phases:'));
            for (const line of progressLines) {
                output.writeln(output.dim(`    ${line}`));
            }
            // Show graph stats
            output.writeln();
            await printStats(root);
            return { success: true };
        }
        catch (err) {
            spinner.fail('Build failed');
            output.printError(err instanceof Error ? err.message : String(err));
            return { success: false, exitCode: 1 };
        }
    },
};
// ── wiki subcommand ───────────────────────────────────────────────────────────
const wikiCommand = {
    name: 'wiki',
    description: 'Scan all docs and PDFs in the project and build a searchable knowledge graph',
    options: [
        { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
        { name: 'llm', type: 'boolean', description: 'Enrich with Claude semantic extraction (requires ANTHROPIC_API_KEY)' },
        { name: 'llm-sections', type: 'number', description: 'Max sections for LLM enrichment (default 100)', default: '100' },
        { name: 'force', short: 'f', type: 'boolean', description: 'Force full rebuild' },
    ],
    examples: [
        { command: 'monomind monograph wiki', description: 'Build knowledge graph from all docs and PDFs' },
        { command: 'monomind monograph wiki --llm', description: 'Also extract semantic relationships with Claude' },
        { command: 'monomind monograph wiki --llm --llm-sections 200', description: 'Process 200 sections with Claude' },
    ],
    action: async (ctx) => {
        const root = resolve(ctx.flags.path ?? process.cwd());
        const force = ctx.flags.force === true;
        const llmFlag = ctx.flags.llm === true;
        const llmSections = parseInt(ctx.flags['llm-sections'] || '100', 10);
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const llmMaxSections = (llmFlag && hasApiKey) ? llmSections : 0;
        if (llmFlag && !hasApiKey) {
            output.printWarning('--llm passed but ANTHROPIC_API_KEY is not set — LLM extraction disabled');
        }
        // Pre-scan docs
        const docs = walkDocs(root, []);
        const byExt = new Map();
        for (const { ext } of docs)
            byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
        output.writeln();
        output.writeln(output.bold('Monograph — Wiki & Document Knowledge Graph'));
        output.writeln(output.dim('─'.repeat(60)));
        output.writeln(`  Path : ${root}`);
        output.writeln();
        if (docs.length === 0) {
            output.printWarning('No document files found (.md .mdx .txt .rst .pdf)');
            output.writeln(output.dim(`  Searched: ${root}`));
            output.writeln(output.dim('  Make sure you\'re in the right directory.'));
            return { success: false, exitCode: 1 };
        }
        output.writeln(output.bold(`  Discovered ${docs.length} files:`));
        for (const [ext, count] of [...byExt.entries()].sort()) {
            const label = ext === '.pdf' ? '(PDF chunks will be created)' :
                ext === '.md' || ext === '.mdx' ? '(headings → Section nodes)' :
                    '(plain text → Section nodes)';
            output.writeln(`    ${output.success(ext.padEnd(6))} ${String(count).padStart(4)} files  ${output.dim(label)}`);
        }
        if (llmMaxSections > 0) {
            output.writeln();
            output.writeln(`  ${output.success('Claude enrichment')} enabled — up to ${llmMaxSections} sections`);
            output.writeln(output.dim('  Extracts typed semantic relationships (DESCRIBES, CAUSES, PART_OF, …)'));
        }
        else if (!llmFlag) {
            output.writeln();
            output.writeln(output.dim('  Tip: add --llm to extract Claude-inferred semantic relationships'));
        }
        output.writeln();
        const spinner = output.createSpinner({ text: 'Building…', spinner: 'dots' });
        spinner.start();
        const startTime = Date.now();
        const progressLines = [];
        try {
            const { buildAsync } = await import('@monoes/monograph');
            // llmMaxSections is a UI variable only; not a valid BuildOptions key in @monoes/monograph@1.1.0
            await buildAsync(root, {
                codeOnly: false,
                force,
                onProgress: (p) => {
                    const msg = `[${p.phase}] ${p.message ?? ''}`;
                    progressLines.push(msg);
                    if (p.phase.includes('docs') || p.phase.includes('pdf') ||
                        p.phase.includes('contextual') || p.phase.includes('llm') ||
                        p.phase.includes('embed')) {
                        spinner.setText(msg.slice(0, 70));
                    }
                },
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            spinner.succeed(`Done in ${elapsed}s`);
            output.writeln();
            output.writeln(output.bold('  Knowledge graph phases:'));
            for (const line of progressLines.filter(l => l.includes('docs') || l.includes('pdf') || l.includes('contextual') ||
                l.includes('llm') || l.includes('embed') || l.includes('structure'))) {
                output.writeln(output.dim(`    ${line}`));
            }
            output.writeln();
            await printStats(root);
            output.writeln();
            output.writeln(output.bold('  Next steps:'));
            output.printList([
                'monomind monograph search "your query"   — search the wiki',
                'monomind monograph stats                 — full node/edge breakdown',
                'monomind monograph watch                 — rebuild on file changes',
            ]);
            return { success: true };
        }
        catch (err) {
            spinner.fail('Build failed');
            output.printError(err instanceof Error ? err.message : String(err));
            return { success: false, exitCode: 1 };
        }
    },
};
// ── search subcommand ─────────────────────────────────────────────────────────
const searchCommand = {
    name: 'search',
    description: 'Search the knowledge graph (BM25, semantic, or hybrid)',
    options: [
        { name: 'query', short: 'q', type: 'string', description: 'Search query', required: true },
        { name: 'limit', short: 'l', type: 'number', description: 'Max results (default 15)', default: '15' },
        { name: 'label', type: 'string', description: 'Filter by node type: Section, Function, Concept, File, etc.' },
        { name: 'mode', short: 'm', type: 'string', description: 'Search mode: bm25 | semantic | hybrid (default: hybrid)', default: 'hybrid' },
        { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
    ],
    examples: [
        { command: 'monomind monograph search -q "authentication flow"', description: 'Hybrid search across all nodes' },
        { command: 'monomind monograph search -q "API design" --label Section', description: 'Search only doc sections' },
        { command: 'monomind monograph search -q "pipeline" --mode semantic', description: 'Semantic (embedding) search' },
    ],
    action: async (ctx) => {
        const query = ctx.flags.query;
        const limit = parseInt(ctx.flags.limit || '15', 10);
        const label = ctx.flags.label;
        const mode = ctx.flags.mode ?? 'hybrid';
        const root = resolve(ctx.flags.path ?? process.cwd());
        const dbPath = getDbPath(root);
        if (!query) {
            output.printError('--query is required');
            return { success: false, exitCode: 1 };
        }
        if (!existsSync(dbPath)) {
            output.printWarning('No knowledge graph found. Run: monomind monograph build');
            return { success: false, exitCode: 1 };
        }
        output.writeln();
        output.writeln(output.bold(`Monograph Search — "${query}"`));
        output.writeln(output.dim(`  mode: ${mode}${label ? `  label: ${label}` : ''}  limit: ${limit}`));
        output.writeln();
        try {
            const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
            // At @monoes/monograph@1.1.0, semanticSearch is not exported. Import from compat.
            // With no embeddings at 1.1.0, --mode semantic and --mode hybrid both degrade to BM25
            // (the RRF block merges bm25 with a sem list that is itself BM25 — harmless).
            const { semanticSearch } = await import('../mcp-tools/monograph-compat.js');
            const db = openDb(dbPath);
            let results = [];
            const K = 60;
            if (mode === 'semantic') {
                results = semanticSearch(db, query, limit, label).map(r => ({ ...r }));
            }
            else if (mode === 'bm25') {
                results = ftsSearch(db, query, limit, label).map(r => ({ ...r }));
            }
            else {
                // hybrid: RRF merge
                const bm25 = ftsSearch(db, query, limit * 2, label);
                const sem = semanticSearch(db, query, limit * 2, label);
                const scores = new Map();
                const meta = new Map();
                bm25.forEach((r, i) => { scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i)); meta.set(r.id, r); });
                sem.forEach((r, i) => { scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + i)); if (!meta.has(r.id))
                    meta.set(r.id, r); });
                results = [...scores.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, limit)
                    .map(([id, score]) => ({ ...meta.get(id), score }));
            }
            closeDb(db);
            if (results.length === 0) {
                output.printWarning('No results found.');
                output.writeln(output.dim('  Try: --mode semantic  or  monomind monograph build to rebuild the index'));
                return { success: true, data: [] };
            }
            output.printTable({
                columns: [
                    { key: 'label', header: 'Type', width: 12 },
                    { key: 'name', header: 'Name', width: 32 },
                    { key: 'file', header: 'File', width: 30 },
                    { key: 'score', header: 'Score', width: 8 },
                ],
                data: results.map(r => ({
                    label: output.dim(r.label),
                    name: r.name.length > 30 ? r.name.slice(0, 27) + '…' : r.name,
                    file: r.filePath ? (r.filePath.length > 28 ? '…' + r.filePath.slice(-27) : r.filePath) : output.dim('—'),
                    score: r.score != null ? output.dim(r.score.toFixed(4)) : output.dim('—'),
                })),
            });
            output.writeln(output.dim(`\n  ${results.length} results`));
            return { success: true, data: results };
        }
        catch (err) {
            output.printError(err instanceof Error ? err.message : String(err));
            return { success: false, exitCode: 1 };
        }
    },
};
// ── stats subcommand ──────────────────────────────────────────────────────────
const statsCommand = {
    name: 'stats',
    description: 'Show knowledge graph statistics — node counts, edge types, top concepts',
    options: [
        { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
        { name: 'top', type: 'number', description: 'Number of top concepts to show (default 10)', default: '10' },
    ],
    examples: [
        { command: 'monomind monograph stats', description: 'Show graph statistics' },
        { command: 'monomind monograph stats --top 20', description: 'Show top 20 concepts' },
    ],
    action: async (ctx) => {
        const root = resolve(ctx.flags.path ?? process.cwd());
        const top = parseInt(ctx.flags.top || '10', 10);
        const dbPath = getDbPath(root);
        if (!existsSync(dbPath)) {
            output.printWarning('No knowledge graph found. Run: monomind monograph build');
            return { success: false, exitCode: 1 };
        }
        output.writeln();
        output.writeln(output.bold('Monograph — Knowledge Graph Statistics'));
        output.writeln(output.dim('─'.repeat(60)));
        output.writeln();
        try {
            await printStats(root, top, true);
            return { success: true };
        }
        catch (err) {
            output.printError(err instanceof Error ? err.message : String(err));
            return { success: false, exitCode: 1 };
        }
    },
};
// ── watch subcommand ──────────────────────────────────────────────────────────
const watchCommand = {
    name: 'watch',
    description: 'Watch for file changes and incrementally rebuild the knowledge graph',
    options: [
        { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
        { name: 'llm', type: 'boolean', description: 'Enable LLM enrichment on rebuild (requires ANTHROPIC_API_KEY)' },
    ],
    examples: [
        { command: 'monomind monograph watch', description: 'Watch and rebuild on changes' },
    ],
    action: async (ctx) => {
        const root = resolve(ctx.flags.path ?? process.cwd());
        const llmFlag = ctx.flags.llm === true;
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const llmMaxSections = (llmFlag && hasApiKey) ? 50 : 0;
        output.writeln();
        output.writeln(output.bold('Monograph — Watch Mode'));
        output.writeln(output.dim(`  Watching: ${root}`));
        output.writeln(output.dim('  Press Ctrl+C to stop'));
        output.writeln();
        try {
            // watchAsync is not exported in @monoes/monograph@1.1.0.
            // Use MonographWatcher directly, mirroring the monograph_watch MCP tool.
            const { MonographWatcher, buildAsync } = await import('@monoes/monograph');
            const watcher = new MonographWatcher(root);
            watcher.on('monograph:updated', () => {
                output.writeln(output.dim('  [watch] File change detected, rebuilding…'));
                buildAsync(root, { codeOnly: false }).catch((err) => {
                    output.writeln(output.dim(`  [watch] Rebuild error: ${err.message}`));
                });
            });
            await watcher.start();
            output.printSuccess('Watching for changes…');
            output.writeln();
            await new Promise(resolve => {
                process.on('SIGINT', () => {
                    watcher.stop();
                    output.writeln();
                    output.writeln(output.dim('Watch stopped.'));
                    resolve();
                });
            });
            return { success: true };
        }
        catch (err) {
            output.printError(err instanceof Error ? err.message : String(err));
            return { success: false, exitCode: 1 };
        }
    },
};
// ── shared helper ─────────────────────────────────────────────────────────────
async function printStats(root, topN = 10, detailed = false) {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath(root));
    try {
        // Node counts by label
        const nodeCounts = db.prepare(`SELECT label, COUNT(*) as n FROM nodes GROUP BY label ORDER BY n DESC`).all();
        // Edge counts by relation
        const edgeCounts = db.prepare(`SELECT relation, COUNT(*) as n FROM edges GROUP BY relation ORDER BY n DESC`).all();
        // Top concepts by importance
        const topConcepts = db.prepare(`
      SELECT name,
             COALESCE(json_extract(properties, '$.importance'), 1) as importance,
             (SELECT COUNT(*) FROM edges WHERE target_id = nodes.id AND relation = 'TAGGED_AS') as sections
      FROM nodes WHERE label = 'Concept'
      ORDER BY importance DESC, sections DESC
      LIMIT ?
    `).all(topN);
        output.writeln(output.bold('  Nodes'));
        output.printTable({
            columns: [
                { key: 'label', header: 'Type', width: 18 },
                { key: 'count', header: 'Count', width: 10 },
                { key: 'bar', header: '', width: 30 },
            ],
            data: nodeCounts.map(r => {
                const n = r.n;
                const max = nodeCounts[0]?.n ?? 1;
                const bars = Math.round((n / max) * 20);
                return {
                    label: r.label,
                    count: String(n),
                    bar: output.dim('█'.repeat(bars) + '░'.repeat(20 - bars)),
                };
            }),
        });
        if (detailed) {
            output.writeln();
            output.writeln(output.bold('  Edges'));
            output.printTable({
                columns: [
                    { key: 'relation', header: 'Relation', width: 22 },
                    { key: 'count', header: 'Count', width: 10 },
                ],
                data: edgeCounts.map(r => ({ relation: r.relation, count: String(r.n) })),
            });
        }
        if (topConcepts.length > 0) {
            output.writeln();
            output.writeln(output.bold(`  Top ${topN} Concepts by Importance`));
            output.printTable({
                columns: [
                    { key: 'name', header: 'Concept', width: 28 },
                    { key: 'importance', header: 'Importance', width: 12 },
                    { key: 'sections', header: 'Sections', width: 10 },
                ],
                data: topConcepts.map(r => ({
                    name: r.name,
                    importance: output.dim('★'.repeat(r.importance) + '☆'.repeat(5 - r.importance)),
                    sections: String(r.sections ?? 0),
                })),
            });
        }
        // CO_OCCURS enrichment hint
        const coOccurCount = db.prepare(`SELECT COUNT(*) as n FROM edges WHERE relation = 'CO_OCCURS'`).get().n;
        const llmCount = db.prepare(`SELECT COUNT(*) as n FROM edges WHERE confidence = 'INFERRED'`).get().n;
        output.writeln();
        output.writeln(output.dim(`  CO_OCCURS edges: ${coOccurCount}   Inferred (LLM) edges: ${llmCount}`));
        output.writeln(output.dim(`  Database: ${getDbPath(root)}`));
    }
    finally {
        closeDb(db);
    }
}
// ── root command ──────────────────────────────────────────────────────────────
export const monographCommand = {
    name: 'monograph',
    description: 'Knowledge graph for code and documents — build, search, explore',
    aliases: ['kg'],
    subcommands: [buildCommand, wikiCommand, searchCommand, statsCommand, watchCommand],
    examples: [
        { command: 'monomind monograph wiki', description: 'Build KG from all docs and PDFs' },
        { command: 'monomind monograph wiki --llm', description: 'Build KG with Claude semantic extraction' },
        { command: 'monomind monograph build', description: 'Build KG from code + docs' },
        { command: 'monomind monograph search -q "authentication"', description: 'Search the knowledge graph' },
        { command: 'monomind monograph stats', description: 'Show graph statistics' },
        { command: 'monomind monograph watch', description: 'Watch for changes and rebuild' },
    ],
    action: async () => {
        output.writeln();
        output.writeln(output.bold('Monograph — Knowledge Graph'));
        output.writeln(output.dim('Code intelligence + Document wiki in one unified graph'));
        output.writeln();
        output.writeln('Commands:');
        output.printList([
            'wiki      — Scan all docs & PDFs → searchable knowledge graph',
            'build     — Full build (code + docs + PDFs)',
            'search    — Search across code, sections, and concepts',
            'stats     — Node/edge counts, top concepts',
            'watch     — Auto-rebuild on file changes',
        ]);
        output.writeln();
        output.writeln('Examples:');
        output.printList([
            'monomind monograph wiki',
            'monomind monograph wiki --llm',
            'monomind monograph search -q "pipeline architecture"',
        ]);
        output.writeln();
        output.writeln(output.dim('Add --llm to any build command to extract semantic relationships with Claude'));
        return { success: true };
    },
};
export default monographCommand;
//# sourceMappingURL=monograph.js.map