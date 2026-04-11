import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { collectFiles, corpusHealth } from './detect.js';
import { FileCache } from './cache.js';
import { buildGraph as buildGraphologyGraph } from './build.js';
import { detectCommunities, cohesionScore } from './cluster.js';
import { buildAnalysis, suggestQuestions } from './analyze.js';
import { saveGraph } from './export.js';
import { exportHTML } from './visualize.js';
import { generateReport } from './report.js';
import { typescriptExtractor } from './extract/languages/typescript.js';
import { parseFile } from './extract/tree-sitter-runner.js';
const DEFAULT_OUTPUT_SUBDIR = '.monobrain/graph';
// ---------------------------------------------------------------------------
// Experiment loop — adapted from autoresearch's program.md protocol
//
// Every buildGraph call appends one row to results.tsv with a quality scalar,
// then decides BASELINE / KEEP / DISCARD by comparing against the best known
// result.  The quality metric mirrors autoresearch's val_bpb (a single number
// to optimise), but for graph structure rather than language model perplexity.
// ---------------------------------------------------------------------------
const RESULTS_TSV_HEADER = 'timestamp\tnodes\tedges\tcommunities\tavg_cohesion\tavg_degree\tgraph_quality\tfiles_processed\tstatus\tdescription\n';
/**
 * Graph quality scalar.
 *
 * avgCohesion × ln(1 + avgDegree)
 *
 * Rewards both tight community structure (cohesion) and overall connectivity
 * (avgDegree).  Higher is better — directly comparable across builds, like
 * autoresearch's vocab-size-independent bits-per-byte metric.
 */
function computeGraphQuality(avgCohesion, nodes, edges) {
    const avgDegree = nodes > 0 ? (2 * edges) / nodes : 0;
    return avgCohesion * Math.log(1 + avgDegree);
}
/** Read results.tsv and return the best graph_quality seen so far (BASELINE or KEEP rows). */
function readBestQuality(tsvPath) {
    if (!existsSync(tsvPath))
        return -Infinity;
    try {
        const lines = readFileSync(tsvPath, 'utf-8').split('\n').filter(Boolean);
        let best = -Infinity;
        for (const line of lines.slice(1)) { // skip header
            const cols = line.split('\t');
            const status = cols[8]; // status column
            const quality = parseFloat(cols[6] ?? '0'); // graph_quality column
            if ((status === 'BASELINE' || status === 'KEEP') && !isNaN(quality)) {
                if (quality > best)
                    best = quality;
            }
        }
        return best;
    }
    catch {
        return -Infinity;
    }
}
/** Append one experiment row to results.tsv. Creates file + header if needed. */
function appendResultsTsv(tsvPath, metrics) {
    const avgDegree = metrics.nodes > 0 ? (2 * metrics.edges) / metrics.nodes : 0;
    const description = `${metrics.nodes}n/${metrics.edges}e coh=${metrics.avgCohesion.toFixed(3)} deg=${avgDegree.toFixed(1)}`;
    const row = [
        new Date().toISOString(),
        metrics.nodes,
        metrics.edges,
        metrics.communities,
        metrics.avgCohesion.toFixed(4),
        avgDegree.toFixed(2),
        metrics.graphQuality.toFixed(6),
        metrics.filesProcessed,
        metrics.status,
        description,
    ].join('\t') + '\n';
    try {
        if (!existsSync(tsvPath)) {
            writeFileSync(tsvPath, RESULTS_TSV_HEADER + row, 'utf-8');
        }
        else {
            const existing = readFileSync(tsvPath, 'utf-8');
            writeFileSync(tsvPath, existing + row, 'utf-8');
        }
    }
    catch { /* TSV tracking is non-fatal */ }
}
// Map language identifiers to the extractors we have available.
// python and go extractors are loaded lazily when their modules exist.
const EXTRACTOR_MAP = {
    typescript: typescriptExtractor,
    javascript: typescriptExtractor, // TS extractor handles JS via regex + tree-sitter-javascript
};
/** Attempt to load python/go extractors that may be present in the extract/languages dir. */
async function tryLoadExtractor(language) {
    if (EXTRACTOR_MAP[language])
        return EXTRACTOR_MAP[language];
    try {
        const mod = await import(`./extract/languages/${language}.js`);
        const extractor = (mod[`${language}Extractor`] ?? mod['default']);
        if (extractor)
            EXTRACTOR_MAP[language] = extractor;
        return extractor;
    }
    catch {
        return undefined;
    }
}
export async function buildGraph(projectPath, options = {}) {
    // Resolve output directory
    const outputDir = options.outputDir ?? join(projectPath, DEFAULT_OUTPUT_SUBDIR);
    mkdirSync(outputDir, { recursive: true });
    const cache = new FileCache(outputDir);
    // 1. Collect files + corpus health check
    const files = collectFiles(projectPath, options);
    const corpusWarnings = corpusHealth(files);
    // 2. Extract nodes/edges from each file (cache-aware)
    const merged = {
        nodes: [],
        edges: [],
        hyperedges: [],
        filesProcessed: 0,
        fromCache: 0,
        errors: [],
    };
    for (const file of files) {
        let content;
        try {
            content = readFileSync(file.path, 'utf-8');
        }
        catch (err) {
            merged.errors.push(`Cannot read ${file.path}: ${String(err)}`);
            continue;
        }
        const cacheKey = cache.key(file.path, content);
        let result = cache.get(cacheKey);
        if (result) {
            merged.fromCache += 1;
        }
        else {
            const extractor = file.language
                ? await tryLoadExtractor(file.language)
                : undefined;
            if (extractor) {
                result = parseFile(file.path, content, extractor);
            }
            else {
                result = extractGeneric(file.path, content);
            }
            cache.set(cacheKey, result);
        }
        merged.nodes.push(...result.nodes);
        merged.edges.push(...result.edges);
        if (result.hyperedges)
            merged.hyperedges.push(...result.hyperedges);
        merged.filesProcessed += 1;
        merged.errors.push(...result.errors);
    }
    // 3. Build graphology graph (dedup + stub endpoints)
    const graph = buildGraphologyGraph(merged);
    // 4. Community detection (Louvain with directory-based fallback)
    await detectCommunities(graph);
    // 5. Degree annotation
    graph.forEachNode((id) => {
        graph.setNodeAttribute(id, 'degree', graph.degree(id));
    });
    // 6. Build analysis (god nodes, surprise edges, communities, stats)
    const analysis = buildAnalysis(graph, outputDir);
    // 6b. Suggest questions the graph can answer
    const questions = suggestQuestions(graph, analysis.communities);
    // 6c. Compute cohesion scores per community
    const cohesionScores = {};
    for (const [cidStr, memberIds] of Object.entries(analysis.communities)) {
        cohesionScores[Number(cidStr)] = cohesionScore(graph, memberIds);
    }
    // 6d. Graph quality metric + experiment loop (autoresearch protocol)
    const cohesionValues = Object.values(cohesionScores);
    const avgCohesion = cohesionValues.length > 0
        ? cohesionValues.reduce((a, b) => a + b, 0) / cohesionValues.length
        : 0;
    const graphQuality = computeGraphQuality(avgCohesion, graph.order, graph.size);
    const tsvPath = join(outputDir, 'results.tsv');
    const prevBest = readBestQuality(tsvPath);
    const experimentStatus = prevBest === -Infinity
        ? 'BASELINE'
        : graphQuality > prevBest * 1.001 // 0.1% improvement threshold
            ? 'KEEP'
            : 'DISCARD';
    appendResultsTsv(tsvPath, {
        nodes: graph.order,
        edges: graph.size,
        communities: analysis.stats.communities,
        avgCohesion,
        graphQuality,
        filesProcessed: merged.filesProcessed,
        status: experimentStatus,
    });
    // 7. Persist to disk
    saveGraph(graph, outputDir, projectPath);
    const graphPath = join(outputDir, 'graph.json');
    // 7b. Generate and save markdown report (non-fatal)
    const reportPath = join(outputDir, 'GRAPH_REPORT.md');
    try {
        const totalWords = merged.nodes.reduce((sum, n) => sum + (n.linesOfCode ?? 0) * 10, 0);
        const reportMd = generateReport(graph, analysis, cohesionScores, {
            projectPath,
            questions,
            corpusStats: corpusWarnings.length > 0
                ? { totalFiles: files.length, totalWords, warning: corpusWarnings[0] }
                : { totalFiles: files.length, totalWords },
        });
        writeFileSync(reportPath, reportMd, 'utf-8');
    }
    catch { /* report generation is non-fatal */ }
    // 8. Serialize to the public return type
    const serialized = {
        version: '1.0.0',
        builtAt: new Date().toISOString(),
        projectPath,
        directed: true,
        multigraph: false,
        nodes: graph.nodes().map((id) => ({
            id,
            ...graph.getNodeAttributes(id),
        })),
        links: graph.edges().map((edgeId) => ({
            source: graph.source(edgeId),
            target: graph.target(edgeId),
            ...graph.getEdgeAttributes(edgeId),
        })),
    };
    // 9. Generate interactive HTML visualization (non-fatal)
    try {
        exportHTML(serialized, outputDir);
    }
    catch {
        // Visualization is best-effort; never block the build
    }
    return {
        graph: serialized,
        analysis,
        questions,
        corpusWarnings,
        filesProcessed: merged.filesProcessed,
        fromCache: merged.fromCache,
        graphPath,
        reportPath,
        graphQuality,
        experimentStatus,
    };
}
// ---------------------------------------------------------------------------
// Internal: minimal fallback for languages without a dedicated extractor
// ---------------------------------------------------------------------------
function extractGeneric(filePath, content) {
    return {
        nodes: [
            {
                id: filePath,
                label: filePath.split('/').pop() ?? filePath,
                fileType: 'code',
                sourceFile: filePath,
                linesOfCode: content.split('\n').length,
            },
        ],
        edges: [],
        filesProcessed: 1,
        fromCache: 0,
        errors: [],
    };
}
//# sourceMappingURL=pipeline.js.map