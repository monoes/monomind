import { join } from 'path';
import { mkdirSync, readFileSync } from 'fs';
import { collectFiles } from './detect.js';
import { FileCache } from './cache.js';
import { buildGraph as buildGraphologyGraph } from './build.js';
import { detectCommunities } from './cluster.js';
import { buildAnalysis } from './analyze.js';
import { saveGraph } from './export.js';
import { typescriptExtractor } from './extract/languages/typescript.js';
import { parseFile } from './extract/tree-sitter-runner.js';
const DEFAULT_OUTPUT_SUBDIR = '.monobrain/graph';
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
/**
 * Main entry point for building a knowledge graph from a codebase.
 *
 * Orchestrates file collection, per-file extraction (with caching),
 * graph construction via graphology, community detection, and serialisation.
 *
 * @param projectPath - Absolute path to the root of the codebase to analyse.
 * @param options     - Optional build configuration.
 * @returns           - Serialized graph + analysis summary.
 */
export async function buildGraph(projectPath, options = {}) {
    // Resolve output directory
    const outputDir = options.outputDir ?? join(projectPath, DEFAULT_OUTPUT_SUBDIR);
    mkdirSync(outputDir, { recursive: true });
    const cache = new FileCache(outputDir);
    // 1. Collect files
    const files = collectFiles(projectPath, options);
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
    // 7. Persist to disk
    saveGraph(graph, outputDir, projectPath);
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
    return { graph: serialized, analysis };
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