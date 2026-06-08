/**
 * Isolated semantic-routing worker.
 *
 * The local embedding model (onnxruntime via @huggingface/transformers)
 * deterministically SIGSEGVs when loaded inside the main CLI process (a native
 * addon conflict with the CLI's bootstrap — reproducible on Node 24 & 25, and
 * unfixable in-process since the transformers Node build only supports the
 * native 'cpu' backend). Running it in this dedicated child process isolates
 * the native code: if it crashes, only the worker dies (non-zero exit) and the
 * parent degrades to keyword + hash routing.
 *
 * Protocol: `node embed-worker.js "<task description>"`
 *   stdout: a single JSON line — the RouteResult (with allScores).
 *   exit 0 = success; non-zero = failure (parent should degrade).
 *
 * This worker does ONLY real-embedding semantic scoring: keyword pre-filtering
 * and the Claude LLM fallback are handled by the parent (keyword needs no model;
 * Claude must run in the parent's auth context).
 */
import { createSemanticRouting } from './embedder.js';
// Quiet the transformers/onnxruntime loader so model-load progress/banners
// don't land on stdout and corrupt the single JSON result line the parent
// parses. Must be set before the (lazy) transformers import in embedder.ts.
process.env.TRANSFORMERS_VERBOSITY ??= 'error';
async function main() {
    const task = process.argv[2];
    if (!task) {
        process.stderr.write('embed-worker: missing task argument\n');
        process.exit(2);
    }
    const { RouteLayer, ALL_ROUTES } = await import('@monomind/routing');
    const semantic = await createSemanticRouting(ALL_ROUTES);
    if (!semantic) {
        // Model unavailable — signal the parent to degrade.
        process.stderr.write('embed-worker: embedding model unavailable\n');
        process.exit(3);
    }
    const layer = new RouteLayer({
        routes: ALL_ROUTES,
        embeddingGenerator: semantic.embeddingGenerator,
        centroids: semantic.centroids,
        globalThreshold: semantic.globalThreshold,
        enableKeywordFilter: false, // parent already ran the keyword pre-filter
        debug: true, // include allScores so the parent can run LLM fallback
    });
    const result = await layer.route(task);
    // Emit on its own line, prefixed, so the parent can unambiguously locate the
    // result even if the model loader wrote stray bytes to stdout earlier.
    process.stdout.write(`\n__ROUTE_RESULT__${JSON.stringify(result)}\n`);
}
main().catch((err) => {
    process.stderr.write(`embed-worker: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=embed-worker.js.map