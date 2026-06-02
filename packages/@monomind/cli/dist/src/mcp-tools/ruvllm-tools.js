/**
 * MonoVector LLM WASM MCP Tools
 *
 * Exposes @monoes/ruvllm-wasm operations via MCP protocol.
 * All tools gracefully degrade when the WASM package is not installed.
 */
async function loadRuvllmWasm() {
    return import('../monovector/ruvllm-wasm.js');
}
// ── Instance Registries ──────────────────────────────────────
const hnswRouters = new Map();
const sonaInstances = new Map();
const loraInstances = new Map();
// ── Map eviction (prevents WASM object leaks in long-running MCP servers) ────
const MAX_MAP_SIZE = 50;
function setWithEviction(map, key, value) {
    if (map.size >= MAX_MAP_SIZE) {
        // Evict the oldest entry (first inserted)
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}
export const ruvllmWasmTools = [
    {
        name: 'ruvllm_status',
        description: 'Get ruvllm-wasm availability and initialization status.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
            try {
                const mod = await loadRuvllmWasm();
                const status = await mod.getRuvllmStatus();
                return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_hnsw_create',
        description: 'Create a WASM HNSW router for semantic pattern routing. Max ~11 patterns (v2.0.1 limit).',
        inputSchema: {
            type: 'object',
            properties: {
                dimensions: { type: 'number', description: 'Embedding dimensions (e.g., 64, 128, 384)' },
                maxPatterns: { type: 'number', description: 'Max patterns capacity (limit ~11 in v2.0.1)' },
                efSearch: { type: 'number', description: 'HNSW ef search parameter (higher = more accurate, slower)' },
            },
            required: ['dimensions', 'maxPatterns'],
        },
        handler: async (args) => {
            try {
                const mod = await loadRuvllmWasm();
                const router = await mod.createHnswRouter({
                    dimensions: args.dimensions,
                    maxPatterns: args.maxPatterns,
                    efSearch: args.efSearch,
                });
                // Store router in module-level registry
                const id = `hnsw-${Date.now().toString(36)}`;
                setWithEviction(hnswRouters, id, router);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, routerId: id, dimensions: args.dimensions, maxPatterns: args.maxPatterns }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_hnsw_add',
        description: 'Add a pattern to an HNSW router. Embedding must match router dimensions.',
        inputSchema: {
            type: 'object',
            properties: {
                routerId: { type: 'string', description: 'HNSW router ID from ruvllm_hnsw_create' },
                name: { type: 'string', description: 'Pattern name/label' },
                embedding: { type: 'array', items: { type: 'number' }, description: 'Float array embedding vector' },
                metadata: { type: 'object', description: 'Optional metadata object' },
            },
            required: ['routerId', 'name', 'embedding'],
        },
        handler: async (args) => {
            try {
                const router = hnswRouters.get(args.routerId);
                if (!router)
                    return { content: [{ type: 'text', text: JSON.stringify({ error: `Router not found: ${args.routerId}` }) }], isError: true };
                const embedding = new Float32Array(args.embedding);
                const ok = router.addPattern({
                    name: args.name,
                    embedding,
                    metadata: args.metadata,
                });
                return { content: [{ type: 'text', text: JSON.stringify({ success: ok, patternCount: router.patternCount() }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_hnsw_route',
        description: 'Route a query embedding to nearest patterns in HNSW index.',
        inputSchema: {
            type: 'object',
            properties: {
                routerId: { type: 'string', description: 'HNSW router ID' },
                query: { type: 'array', items: { type: 'number' }, description: 'Query embedding vector' },
                k: { type: 'number', description: 'Number of nearest neighbors (default: 3)' },
            },
            required: ['routerId', 'query'],
        },
        handler: async (args) => {
            try {
                const router = hnswRouters.get(args.routerId);
                if (!router)
                    return { content: [{ type: 'text', text: JSON.stringify({ error: `Router not found: ${args.routerId}` }) }], isError: true };
                const query = new Float32Array(args.query);
                const k = typeof args.k === 'number' && args.k > 0 ? Math.floor(args.k) : 3;
                const results = router.route(query, k);
                return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_sona_create',
        description: 'Create a SONA instant adaptation loop (<1ms adaptation cycles).',
        inputSchema: {
            type: 'object',
            properties: {
                hiddenDim: { type: 'number', description: 'Hidden dimension (default: 64)' },
                learningRate: { type: 'number', description: 'Learning rate (default: 0.01)' },
                patternCapacity: { type: 'number', description: 'Max stored patterns' },
            },
        },
        handler: async (args) => {
            try {
                const mod = await loadRuvllmWasm();
                const sona = await mod.createSonaInstant({
                    hiddenDim: args.hiddenDim,
                    learningRate: args.learningRate,
                    patternCapacity: args.patternCapacity,
                });
                const id = `sona-${Date.now().toString(36)}`;
                setWithEviction(sonaInstances, id, sona);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, sonaId: id }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_sona_adapt',
        description: 'Run SONA instant adaptation with a quality signal.',
        inputSchema: {
            type: 'object',
            properties: {
                sonaId: { type: 'string', description: 'SONA instance ID' },
                quality: { type: 'number', description: 'Quality signal (0.0-1.0)' },
            },
            required: ['sonaId', 'quality'],
        },
        handler: async (args) => {
            try {
                const sona = sonaInstances.get(args.sonaId);
                if (!sona)
                    return { content: [{ type: 'text', text: JSON.stringify({ error: `SONA not found: ${args.sonaId}` }) }], isError: true };
                sona.adapt(args.quality);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, stats: sona.stats() }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_microlora_create',
        description: 'Create a MicroLoRA adapter (ultra-lightweight LoRA, ranks 1-4).',
        inputSchema: {
            type: 'object',
            properties: {
                inputDim: { type: 'number', description: 'Input dimension' },
                outputDim: { type: 'number', description: 'Output dimension' },
                rank: { type: 'number', description: 'LoRA rank (1-4, default: 2)' },
                alpha: { type: 'number', description: 'LoRA alpha scaling (default: 1.0)' },
            },
            required: ['inputDim', 'outputDim'],
        },
        handler: async (args) => {
            try {
                const mod = await loadRuvllmWasm();
                const lora = await mod.createMicroLora({
                    inputDim: args.inputDim,
                    outputDim: args.outputDim,
                    rank: args.rank,
                    alpha: args.alpha,
                });
                const id = `lora-${Date.now().toString(36)}`;
                setWithEviction(loraInstances, id, lora);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, loraId: id }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_microlora_adapt',
        description: 'Adapt MicroLoRA weights with quality feedback.',
        inputSchema: {
            type: 'object',
            properties: {
                loraId: { type: 'string', description: 'MicroLoRA instance ID' },
                quality: { type: 'number', description: 'Quality signal (0.0-1.0)' },
                learningRate: { type: 'number', description: 'Learning rate (default: 0.01)' },
                success: { type: 'boolean', description: 'Whether the adaptation was successful (default: true)' },
            },
            required: ['loraId', 'quality'],
        },
        handler: async (args) => {
            try {
                const lora = loraInstances.get(args.loraId);
                if (!lora)
                    return { content: [{ type: 'text', text: JSON.stringify({ error: `MicroLoRA not found: ${args.loraId}` }) }], isError: true };
                lora.adapt(args.quality, args.learningRate, args.success);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, stats: lora.stats() }) }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_chat_format',
        description: 'Format chat messages using a template (llama3, mistral, chatml, phi, gemma, or auto-detect).',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } }, required: ['role', 'content'] },
                    description: 'Array of {role, content} message objects',
                },
                template: { type: 'string', description: 'Template preset (llama3, mistral, chatml, phi, gemma) or model ID for auto-detection' },
            },
            required: ['messages', 'template'],
        },
        handler: async (args) => {
            try {
                const mod = await loadRuvllmWasm();
                const messages = args.messages;
                const templateStr = args.template;
                const presets = ['llama3', 'mistral', 'chatml', 'phi', 'gemma'];
                const template = presets.includes(templateStr)
                    ? templateStr
                    : { modelId: templateStr };
                const formatted = await mod.formatChat(messages, template);
                return { content: [{ type: 'text', text: formatted }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
    {
        name: 'ruvllm_generate_config',
        description: 'Create a generation config (maxTokens, temperature, topP, etc.) as JSON.',
        inputSchema: {
            type: 'object',
            properties: {
                maxTokens: { type: 'number', description: 'Max tokens to generate' },
                temperature: { type: 'number', description: 'Sampling temperature (note: f32 precision)' },
                topP: { type: 'number', description: 'Top-p sampling' },
                topK: { type: 'number', description: 'Top-k sampling' },
                repetitionPenalty: { type: 'number', description: 'Repetition penalty' },
                stopSequences: { type: 'array', items: { type: 'string' }, description: 'Stop sequences' },
            },
        },
        handler: async (args) => {
            try {
                const mod = await loadRuvllmWasm();
                const config = await mod.createGenerateConfig(args);
                return { content: [{ type: 'text', text: config }] };
            }
            catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
            }
        },
    },
];
//# sourceMappingURL=ruvllm-tools.js.map