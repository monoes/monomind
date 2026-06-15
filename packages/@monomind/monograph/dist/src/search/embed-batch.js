/**
 * Batch-embed all symbol nodes that don't yet have an embedding stored.
 */
import { upsertEmbedding, ensureEmbeddingSchema, countEmbeddings } from '../storage/embedding-store.js';
import { embedText } from './embedder.js';
const BATCH_SIZE = 32;
/**
 * Embed a list of text strings and return an array of embedding vectors.
 *
 * If `config.remote` is provided, delegates to `HttpEmbedder`.
 * Otherwise falls back to the local HuggingFace embedder.
 *
 * @param texts  - Strings to embed
 * @param config - Optional device/remote/batchSize config
 */
export async function embedBatch(texts, config) {
    // Store device config in a local variable (passed through for future use)
    const _device = config?.device;
    void _device;
    if (config?.remote) {
        const { HttpEmbedder } = await import('./http-embedder.js');
        const embedder = new HttpEmbedder(config.remote);
        return embedder.embedBatch(texts);
    }
    // Local embedder path
    const { getEmbedder } = await import('./embedder.js');
    const embedderFn = await getEmbedder();
    const batchSize = config?.batchSize ?? BATCH_SIZE;
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (text) => {
            const vector = await embedText(text, embedderFn);
            return Array.from(vector);
        }));
        results.push(...batchResults);
    }
    return results;
}
/**
 * Embed all nodes that are missing embeddings.
 *
 * Nodes are fetched in batches of BATCH_SIZE to avoid loading the entire DB
 * into memory at once.
 *
 * @param db       - Open monograph database
 * @param embedder - Feature extraction pipeline function
 * @param force    - When true, re-embed nodes even if they already have an embedding
 */
const CODE_LABELS = new Set(['Function', 'Method', 'Class', 'Module', 'Interface', 'Enum', 'Struct', 'Constructor', 'Variable', 'Const', 'TypeAlias']);
export async function embedAll(db, embedder, force = false, codeOnly = false) {
    let embedded = 0;
    let skipped = 0;
    // Fetch all node IDs and their name+normLabel (used as the text to embed)
    const rows = db
        .prepare(`SELECT id, name, norm_label, label, file_path
       FROM nodes
       ORDER BY rowid`)
        .all();
    const filteredRows = codeOnly ? rows.filter((r) => CODE_LABELS.has(r.label)) : rows;
    // Build set of node IDs that already have embeddings
    const existingIds = force
        ? new Set()
        : new Set(db.prepare('SELECT node_id FROM embeddings').all().map((r) => r.node_id));
    // Filter to only rows that need embedding
    const toEmbed = filteredRows.filter((r) => !existingIds.has(r.id));
    skipped = filteredRows.length - toEmbed.length;
    // Ensure schema migration runs once before any upsert — not per-row.
    if (toEmbed.length > 0)
        ensureEmbeddingSchema(db);
    // Process in batches
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
        const batch = toEmbed.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (row) => {
            const text = buildNodeText(row);
            try {
                const vector = await embedText(text, embedder);
                upsertEmbedding(db, row.id, vector);
                embedded++;
            }
            catch {
                // Skip nodes that fail to embed (e.g. empty name)
                skipped++;
            }
        }));
    }
    return { embedded, skipped };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function buildNodeText(row) {
    const parts = [row.name, row.label];
    if (row.norm_label && row.norm_label !== row.name)
        parts.push(row.norm_label);
    if (row.file_path)
        parts.push(row.file_path);
    return parts.join(' ');
}
export { countEmbeddings };
//# sourceMappingURL=embed-batch.js.map