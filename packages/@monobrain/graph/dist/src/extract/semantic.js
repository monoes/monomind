// ---------------------------------------------------------------------------
// Prompt template (mirrors graphify skill.md lines 253-303)
// ---------------------------------------------------------------------------
function buildPrompt(files, mode, chunkNum, totalChunks) {
    const deepInstructions = mode === 'deep'
        ? '\nDEEP MODE: be aggressive with INFERRED edges - indirect deps, shared assumptions, latent couplings. Mark uncertain ones AMBIGUOUS instead of omitting.\n'
        : '';
    const fileList = files
        .map((f) => `--- file: ${f.relPath} ---\n${f.content.slice(0, 6000)}\n---`)
        .join('\n\n');
    return `You are a graphify extraction subagent. Read the files listed and extract a knowledge graph fragment.
Output ONLY valid JSON matching the schema below - no explanation, no markdown fences, no preamble.

Files (chunk ${chunkNum} of ${totalChunks}):
${fileList}

Rules:
- EXTRACTED: relationship explicit in source (import, call, citation, "see §3.2")
- INFERRED: reasonable inference (shared data structure, implied dependency)
- AMBIGUOUS: uncertain - flag for review, do not omit

Code files: focus on semantic edges AST cannot find (call relationships, shared data, arch patterns).
  Do not re-extract imports - AST already has those.
Doc/paper files: extract named concepts, entities, citations. Also extract rationale — sections that explain WHY a decision was made, trade-offs chosen, or design intent. These become nodes with "rationale_for" edges pointing to the concept they explain.
${deepInstructions}
Semantic similarity: if two concepts in this chunk solve the same problem or represent the same idea without any structural link, add a "semantically_similar_to" edge marked INFERRED with a confidence_score reflecting how similar they are (0.6-0.95). Only add these when the similarity is genuinely non-obvious and cross-cutting.

Hyperedges: if 3 or more nodes clearly participate together in a shared concept, flow, or pattern not captured by pairwise edges, add a hyperedge to the "hyperedges" array. Use sparingly — maximum 3 hyperedges per chunk.

If a file has YAML frontmatter (--- ... ---), copy source_url, captured_at, author, contributor onto every node from that file.

confidence_score is REQUIRED on every edge:
- EXTRACTED edges: confidence_score = 1.0 always
- INFERRED edges: Direct structural evidence: 0.8-0.9. Reasonable with uncertainty: 0.6-0.7. Weak/speculative: 0.4-0.5.
- AMBIGUOUS edges: 0.1-0.3

Output exactly this JSON (no other text):
{"nodes":[{"id":"filestem_entityname","label":"Human Readable Name","file_type":"code|document|paper|image","source_file":"relative/path","source_location":null,"source_url":null,"captured_at":null,"author":null,"contributor":null}],"edges":[{"source":"node_id","target":"node_id","relation":"calls|implements|references|cites|conceptually_related_to|shares_data_with|semantically_similar_to|rationale_for","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"relative/path","source_location":null,"weight":1.0}],"hyperedges":[{"id":"snake_case_id","label":"Human Readable Label","nodes":["node_id1","node_id2","node_id3"],"relation":"participate_in|implement|form","confidence":"EXTRACTED|INFERRED","confidence_score":0.75,"source_file":"relative/path"}],"input_tokens":0,"output_tokens":0}`;
}
async function callClaude(prompt, apiKey, model, maxTokens) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }
    const msg = (await response.json());
    const text = msg.content.find((c) => c.type === 'text')?.text ?? '';
    return {
        text,
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
    };
}
function parseChunkResult(text, chunkFiles) {
    // Strip markdown fences if model added them despite instructions
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    let raw;
    try {
        raw = JSON.parse(cleaned);
    }
    catch {
        return { nodes: [], edges: [], hyperedges: [], inputTokens: 0, outputTokens: 0 };
    }
    const fileSet = new Set(chunkFiles.map((f) => f.relPath));
    const nodes = (raw.nodes ?? [])
        .filter((n) => typeof n === 'object' && n !== null)
        .map((n) => ({
        id: String(n['id'] ?? ''),
        label: String(n['label'] ?? n['id'] ?? ''),
        fileType: n['file_type'] ?? 'document',
        sourceFile: String(n['source_file'] ?? ''),
        sourceLocation: n['source_location'] ?? undefined,
        // Extra metadata from YAML frontmatter
        ...(n['source_url'] ? { sourceUrl: n['source_url'] } : {}),
        ...(n['captured_at'] ? { capturedAt: n['captured_at'] } : {}),
        ...(n['author'] ? { author: n['author'] } : {}),
    }))
        .filter((n) => n.id && fileSet.has(n.sourceFile));
    const edges = (raw.edges ?? [])
        .filter((e) => typeof e === 'object' && e !== null)
        .map((e) => ({
        source: String(e['source'] ?? ''),
        target: String(e['target'] ?? ''),
        relation: String(e['relation'] ?? 'references'),
        confidence: e['confidence'] ?? 'INFERRED',
        confidenceScore: typeof e['confidence_score'] === 'number' ? e['confidence_score'] : 0.7,
        sourceFile: e['source_file'] ?? undefined,
        weight: typeof e['weight'] === 'number' ? e['weight'] : 1.0,
    }))
        .filter((e) => e.source && e.target);
    const hyperedges = (raw.hyperedges ?? [])
        .filter((h) => typeof h === 'object' && h !== null)
        .map((h) => ({
        label: String(h['label'] ?? h['id'] ?? ''),
        nodes: Array.isArray(h['nodes']) ? h['nodes'] : [],
        confidence: h['confidence'] ?? 'INFERRED',
        confidenceScore: typeof h['confidence_score'] === 'number' ? h['confidence_score'] : 0.7,
    }))
        .filter((h) => h.label && h.nodes.length >= 2);
    return {
        nodes,
        edges,
        hyperedges,
        inputTokens: raw.input_tokens ?? 0,
        outputTokens: raw.output_tokens ?? 0,
    };
}
// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
/**
 * Run semantic extraction on a set of files using the Anthropic Claude API.
 *
 * Returns an empty ExtractionResult (not an error) when:
 * - No API key is available
 * - The API call fails
 *
 * Only document/paper files benefit from semantic extraction.
 * Code files may be included but the prompt instructs Claude not to re-extract imports.
 */
export async function extractSemantic(files, options = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    if (!apiKey) {
        return { nodes: [], edges: [], hyperedges: [], filesProcessed: 0, fromCache: 0, errors: ['ANTHROPIC_API_KEY not set — semantic extraction skipped'] };
    }
    const model = options.model ?? 'claude-haiku-4-5-20251001';
    const chunkSize = options.chunkSize ?? 20;
    const mode = options.mode ?? 'fast';
    const maxTokens = options.maxTokens ?? 8192;
    const allNodes = [];
    const allEdges = [];
    const allHyperedges = [];
    const errors = [];
    let totalInput = 0;
    let totalOutput = 0;
    // Chunk files
    const chunks = [];
    for (let i = 0; i < files.length; i += chunkSize) {
        chunks.push(files.slice(i, i + chunkSize));
    }
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const prompt = buildPrompt(chunk, mode, i + 1, chunks.length);
        try {
            const { text, inputTokens, outputTokens } = await callClaude(prompt, apiKey, model, maxTokens);
            totalInput += inputTokens;
            totalOutput += outputTokens;
            const parsed = parseChunkResult(text, chunk);
            allNodes.push(...parsed.nodes);
            allEdges.push(...parsed.edges);
            allHyperedges.push(...parsed.hyperedges);
        }
        catch (err) {
            errors.push(`Chunk ${i + 1}/${chunks.length} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // Deduplicate nodes by id
    const seenNodeIds = new Set();
    const dedupedNodes = allNodes.filter((n) => {
        if (seenNodeIds.has(n.id))
            return false;
        seenNodeIds.add(n.id);
        return true;
    });
    // Attach token totals as extra fields for report generation
    const result = {
        nodes: dedupedNodes,
        edges: allEdges,
        hyperedges: allHyperedges,
        filesProcessed: files.length,
        fromCache: 0,
        errors,
        inputTokens: totalInput,
        outputTokens: totalOutput,
    };
    return result;
}
//# sourceMappingURL=semantic.js.map