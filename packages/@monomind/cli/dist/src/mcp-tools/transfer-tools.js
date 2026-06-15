/**
 * Transfer MCP Tools
 * Pattern and plugin sharing via IPFS-based decentralized registry
 *
 * @module @monomind/cli/mcp-tools/transfer-tools
 * @version 3.0.0
 */
/**
 * Helper to create MCP tool result
 */
function createResult(data, isError = false) {
    return {
        content: [
            {
                type: 'text',
                text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
            },
        ],
        isError,
    };
}
/**
 * Cached PatternStore — initialize() may open IPFS connections, sql.js/WASM,
 * or download registry data. Re-creating on every handler call wastes work
 * and risks file-descriptor / socket-pool leaks on rapid invocations.
 */
let cachedPatternStore = null;
async function getPatternStore() {
    if (cachedPatternStore)
        return cachedPatternStore;
    const { PatternStore } = await import('../transfer/store/index.js');
    const store = new PatternStore();
    await store.initialize();
    cachedPatternStore = store;
    return cachedPatternStore;
}
/**
 * Transfer MCP tools for pattern export, import, anonymization, and sharing
 */
export const transferTools = [
    // ═══════════════════════════════════════════════════════════════
    // ANONYMIZATION TOOLS
    // ═══════════════════════════════════════════════════════════════
    {
        name: 'transfer_detect-pii',
        description: 'Detect PII in content without redacting',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'Content to scan for PII',
                },
            },
            required: ['content'],
        },
        handler: async (input) => {
            try {
                const { detectPII } = await import('../transfer/anonymization/index.js');
                // detectPII runs multiple PII regexes over the entire string — O(n × patterns).
                // Cap to 1 MB to prevent ReDoS-style DoS from oversized content.
                const MAX_PII_CONTENT_LEN = 1024 * 1024; // 1 MB
                const rawContent = input.content;
                const content = typeof rawContent === 'string' && rawContent.length > MAX_PII_CONTENT_LEN
                    ? rawContent.slice(0, MAX_PII_CONTENT_LEN) : rawContent;
                const result = detectPII(content);
                return createResult(result);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    // ═══════════════════════════════════════════════════════════════
    // IPFS TOOLS
    // ═══════════════════════════════════════════════════════════════
    {
        name: 'transfer_ipfs-resolve',
        description: 'Resolve IPNS name to CID',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'IPNS name to resolve',
                },
            },
            required: ['name'],
        },
        handler: async (input) => {
            try {
                const { resolveIPNS } = await import('../transfer/ipfs/client.js');
                // Cap IPNS name length — uncapped strings may trigger O(n) path parsing
                // inside the IPFS client or be reflected in error messages.
                const MAX_IPNS_NAME_LEN = 512;
                const rawName = input.name;
                const name = typeof rawName === 'string' && rawName.length > MAX_IPNS_NAME_LEN
                    ? rawName.slice(0, MAX_IPNS_NAME_LEN) : rawName;
                const result = await resolveIPNS(name);
                return createResult({ success: true, cid: result });
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    // ═══════════════════════════════════════════════════════════════
    // PATTERN STORE TOOLS
    // ═══════════════════════════════════════════════════════════════
    {
        name: 'transfer_store-search',
        description: 'Search the pattern store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query',
                },
                category: {
                    type: 'string',
                    description: 'Filter by category',
                },
                minRating: {
                    type: 'number',
                    description: 'Minimum rating',
                },
                verified: {
                    type: 'boolean',
                    description: 'Only show verified patterns',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum results',
                },
            },
        },
        handler: async (input) => {
            try {
                const store = await getPatternStore();
                // Cap query and limit to prevent DoS via large string or result set.
                const MAX_TRANSFER_QUERY_LEN = 4 * 1024;
                const MAX_TRANSFER_LIMIT = 500;
                const inp = input;
                const cappedInput = {
                    ...inp,
                    query: typeof inp.query === 'string' && inp.query.length > MAX_TRANSFER_QUERY_LEN
                        ? inp.query.slice(0, MAX_TRANSFER_QUERY_LEN) : inp.query,
                    limit: typeof inp.limit === 'number' && Number.isFinite(inp.limit)
                        ? Math.min(Math.floor(Math.max(inp.limit, 1)), MAX_TRANSFER_LIMIT) : inp.limit,
                };
                const results = store.search(cappedInput);
                return createResult(results);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_store-info',
        description: 'Get detailed info about a pattern',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'Pattern ID',
                },
            },
            required: ['id'],
        },
        handler: async (input) => {
            try {
                const store = await getPatternStore();
                const pattern = store.getPattern(input.id);
                if (!pattern) {
                    return createResult({ error: 'Pattern not found' }, true);
                }
                return createResult(pattern);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_store-download',
        description: 'Download a pattern from the store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'Pattern ID',
                },
                verify: {
                    type: 'boolean',
                    description: 'Verify pattern integrity',
                },
            },
            required: ['id'],
        },
        handler: async (input) => {
            try {
                const store = await getPatternStore();
                const result = await store.download(input.id, { verify: input.verify });
                return createResult(result);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_store-featured',
        description: 'Get featured patterns from the store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum results',
                },
            },
        },
        handler: async (input) => {
            try {
                const store = await getPatternStore();
                const featured = store.getFeatured();
                const limit = input.limit || 10;
                return createResult(featured.slice(0, limit));
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_store-trending',
        description: 'Get trending patterns from the store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum results',
                },
            },
        },
        handler: async (input) => {
            try {
                const store = await getPatternStore();
                const trending = store.getTrending();
                const limit = input.limit || 10;
                return createResult(trending.slice(0, limit));
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    // ═══════════════════════════════════════════════════════════════
    // PLUGIN STORE TOOLS
    // ═══════════════════════════════════════════════════════════════
    {
        name: 'transfer_plugin-search',
        description: 'Search the plugin store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query',
                },
                category: {
                    type: 'string',
                    description: 'Filter by category',
                },
                type: {
                    type: 'string',
                    description: 'Filter by plugin type',
                },
                verified: {
                    type: 'boolean',
                    description: 'Only show verified plugins',
                },
                minRating: {
                    type: 'number',
                    description: 'Minimum rating',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum results',
                },
            },
        },
        handler: async (input) => {
            try {
                const { createPluginDiscoveryService, searchPlugins } = await import('../plugins/store/index.js');
                const discovery = createPluginDiscoveryService();
                const result = await discovery.discoverRegistry();
                if (!result.success || !result.registry) {
                    return createResult({ error: result.error || 'Failed to discover registry' }, true);
                }
                // Cap query and limit before forwarding to searchPlugins.
                const MAX_PLUGIN_QUERY_LEN = 4 * 1024;
                const MAX_PLUGIN_LIMIT = 500;
                const rawOpts = input;
                const opts = {
                    ...rawOpts,
                    query: typeof rawOpts.query === 'string' && rawOpts.query.length > MAX_PLUGIN_QUERY_LEN
                        ? rawOpts.query.slice(0, MAX_PLUGIN_QUERY_LEN) : rawOpts.query,
                    limit: typeof rawOpts.limit === 'number' && Number.isFinite(rawOpts.limit)
                        ? Math.min(Math.floor(Math.max(rawOpts.limit, 1)), MAX_PLUGIN_LIMIT) : rawOpts.limit,
                };
                const searchResult = searchPlugins(result.registry, opts);
                return createResult(searchResult);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_plugin-info',
        description: 'Get detailed info about a plugin',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Plugin name or ID',
                },
            },
            required: ['name'],
        },
        handler: async (input) => {
            try {
                const { createPluginDiscoveryService } = await import('../plugins/store/index.js');
                const discovery = createPluginDiscoveryService();
                const result = await discovery.discoverRegistry();
                if (!result.success || !result.registry) {
                    return createResult({ error: result.error || 'Failed to discover registry' }, true);
                }
                const name = input.name;
                const plugin = result.registry.plugins.find((p) => p.id === name || p.name === name);
                if (!plugin) {
                    return createResult({ error: 'Plugin not found' }, true);
                }
                return createResult(plugin);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_plugin-featured',
        description: 'Get featured plugins from the store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum results',
                },
            },
        },
        handler: async (input) => {
            try {
                const { createPluginDiscoveryService, getFeaturedPlugins } = await import('../plugins/store/index.js');
                const discovery = createPluginDiscoveryService();
                const result = await discovery.discoverRegistry();
                if (!result.success || !result.registry) {
                    return createResult({ error: result.error || 'Failed to discover registry' }, true);
                }
                const featured = getFeaturedPlugins(result.registry);
                const limit = input.limit || 10;
                return createResult(featured.slice(0, limit));
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
    {
        name: 'transfer_plugin-official',
        description: 'Get official plugins from the store',
        category: 'transfer',
        version: '1.0.0',
        inputSchema: {
            type: 'object',
            properties: {},
        },
        handler: async () => {
            try {
                const { createPluginDiscoveryService, getOfficialPlugins } = await import('../plugins/store/index.js');
                const discovery = createPluginDiscoveryService();
                const result = await discovery.discoverRegistry();
                if (!result.success || !result.registry) {
                    return createResult({ error: result.error || 'Failed to discover registry' }, true);
                }
                const official = getOfficialPlugins(result.registry);
                return createResult(official);
            }
            catch (error) {
                return createResult({ error: error.message }, true);
            }
        },
    },
];
export default transferTools;
//# sourceMappingURL=transfer-tools.js.map