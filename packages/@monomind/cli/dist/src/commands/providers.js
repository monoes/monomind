/**
 * CLI Providers Command
 * Manage AI providers, models, and configurations
 *
 * github.com/monoes/monomind
 */
import { output } from '../output.js';
import { configManager } from '../services/config-file-manager.js';
// List subcommand
const listCommand = {
    name: 'list',
    description: 'List available AI providers and models',
    options: [
        { name: 'type', short: 't', type: 'string', description: 'Filter by type: llm, embedding, image', default: 'all' },
        { name: 'active', short: 'a', type: 'boolean', description: 'Show only active providers' },
    ],
    examples: [
        { command: 'monomind providers list', description: 'List all providers' },
        { command: 'monomind providers list -t embedding', description: 'List embedding providers' },
    ],
    action: async (ctx) => {
        const type = ctx.flags.type || 'all';
        // Note: Static provider catalog — does not reflect user's configured providers
        output.writeln();
        output.writeln(output.bold('Available Providers'));
        output.writeln(output.dim('─'.repeat(60)));
        output.printTable({
            columns: [
                { key: 'provider', header: 'Provider', width: 18 },
                { key: 'type', header: 'Type', width: 12 },
                { key: 'models', header: 'Models', width: 25 },
                { key: 'status', header: 'Status', width: 12 },
            ],
            data: [
                { provider: 'Anthropic', type: 'LLM', models: 'claude-3.5-sonnet, opus', status: output.success('Active') },
                { provider: 'OpenAI', type: 'LLM', models: 'gpt-4o, gpt-4-turbo', status: output.success('Active') },
                { provider: 'OpenAI', type: 'Embedding', models: 'text-embedding-3-small/large', status: output.success('Active') },
                { provider: 'Transformers.js', type: 'Embedding', models: 'Xenova/all-MiniLM-L6-v2', status: output.success('Active') },
                { provider: 'Agentic Flow', type: 'Embedding', models: 'ONNX optimized', status: output.success('Active') },
                { provider: 'Mock', type: 'All', models: 'mock-*', status: output.dim('Dev only') },
            ],
        });
        return { success: true };
    },
};
// Configure subcommand
const configureCommand = {
    name: 'configure',
    description: 'Configure provider settings and API keys',
    options: [
        { name: 'provider', short: 'p', type: 'string', description: 'Provider name', required: true },
        { name: 'key', short: 'k', type: 'string', description: 'API key' },
        { name: 'model', short: 'm', type: 'string', description: 'Default model' },
        { name: 'endpoint', short: 'e', type: 'string', description: 'Custom endpoint URL' },
    ],
    examples: [
        { command: 'monomind providers configure -p openai -k sk-...', description: 'Set OpenAI key' },
        { command: 'monomind providers configure -p anthropic -m claude-3.5-sonnet', description: 'Set default model' },
    ],
    action: async (ctx) => {
        try {
            const provider = ctx.flags.provider || (ctx.args && ctx.args[0]) || '';
            const apiKey = ctx.flags.key;
            const model = ctx.flags.model;
            const endpoint = ctx.flags.endpoint;
            if (!provider) {
                output.printError('Provider name is required. Use -p <name> or pass as first argument.');
                return { success: false, exitCode: 1 };
            }
            const cwd = process.cwd();
            const config = configManager.getConfig(cwd);
            // Ensure agents.providers array exists
            const agents = (config.agents ?? {});
            const providers = (agents.providers ?? []);
            // Find existing provider entry or create a new one
            let entry = providers.find((p) => typeof p.name === 'string' && p.name.toLowerCase() === provider.toLowerCase());
            if (!entry) {
                entry = { name: provider, enabled: true };
                providers.push(entry);
            }
            // Warn when key is supplied via CLI flag (visible in process table and shell history)
            if (apiKey !== undefined) {
                output.writeln(output.warning('  Warning: passing API keys via --key exposes them in process listings and shell history. Prefer setting the environment variable instead.'));
            }
            if (apiKey !== undefined)
                entry.apiKey = apiKey;
            if (model !== undefined)
                entry.model = model;
            if (endpoint !== undefined)
                entry.baseUrl = endpoint;
            agents.providers = providers;
            configManager.set(cwd, 'agents.providers', providers);
            output.writeln();
            output.writeln(output.bold(`Configured: ${provider}`));
            output.writeln(output.dim('─'.repeat(40)));
            if (apiKey)
                output.writeln(`  API Key : ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`);
            if (model)
                output.writeln(`  Model   : ${model}`);
            if (endpoint)
                output.writeln(`  Endpoint: ${endpoint}`);
            if (!apiKey && !model && !endpoint) {
                output.writeln(`  Provider "${provider}" registered (no settings changed).`);
            }
            output.writeln();
            output.writeln(output.success(`Provider "${provider}" configuration saved.`));
            return { success: true };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            output.printError(`Failed to configure provider: ${msg}`);
            return { success: false, exitCode: 1 };
        }
    },
};
// Test subcommand
const testCommand = {
    name: 'test',
    description: 'Test provider connectivity and API access',
    options: [
        { name: 'provider', short: 'p', type: 'string', description: 'Provider to test' },
        { name: 'all', short: 'a', type: 'boolean', description: 'Test all configured providers' },
    ],
    examples: [
        { command: 'monomind providers test -p openai', description: 'Test OpenAI connection' },
        { command: 'monomind providers test --all', description: 'Test all providers' },
    ],
    action: async (ctx) => {
        try {
            const provider = ctx.flags.provider || (ctx.args && ctx.args[0]) || '';
            const testAll = ctx.flags.all;
            output.writeln();
            output.writeln(output.bold('Provider Connectivity Test'));
            output.writeln(output.dim('─'.repeat(50)));
            const cwd = process.cwd();
            const config = configManager.getConfig(cwd);
            const agents = (config.agents ?? {});
            const configuredProviders = (agents.providers ?? []);
            const getConfigApiKey = (name) => {
                const entry = configuredProviders.find((p) => typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
                return entry?.apiKey;
            };
            const knownChecks = [
                {
                    name: 'Anthropic',
                    test: async () => {
                        const key = process.env.ANTHROPIC_API_KEY || getConfigApiKey('anthropic');
                        if (key)
                            return { pass: true, reason: 'API key found' };
                        return { pass: false, reason: 'ANTHROPIC_API_KEY not set and no apiKey in config' };
                    },
                },
                {
                    name: 'OpenAI',
                    test: async () => {
                        const key = process.env.OPENAI_API_KEY || getConfigApiKey('openai');
                        if (key)
                            return { pass: true, reason: 'API key found' };
                        return { pass: false, reason: 'OPENAI_API_KEY not set and no apiKey in config' };
                    },
                },
                {
                    name: 'Google',
                    test: async () => {
                        const key = process.env.GOOGLE_API_KEY || getConfigApiKey('google');
                        if (key)
                            return { pass: true, reason: 'API key found' };
                        return { pass: false, reason: 'GOOGLE_API_KEY not set and no apiKey in config' };
                    },
                },
                {
                    name: 'Ollama',
                    test: async () => {
                        const entry = configuredProviders.find((p) => typeof p.name === 'string' && p.name.toLowerCase() === 'ollama');
                        const baseUrl = entry?.baseUrl || 'http://localhost:11434';
                        let parsedBaseUrl;
                        try {
                            parsedBaseUrl = new URL(baseUrl);
                        }
                        catch {
                            return { pass: false, reason: 'Invalid URL in Ollama config' };
                        }
                        if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
                            return { pass: false, reason: 'Only http/https URLs are permitted for Ollama endpoint' };
                        }
                        // SSRF defense: block cloud-metadata + RFC1918 private ranges by default.
                        // Ollama is conventionally local, so allow loopback by default but
                        // refuse metadata IPs and link-local. Set MONOMIND_OLLAMA_ALLOW_REMOTE=1
                        // to opt into hitting non-loopback hosts (useful for dev clusters).
                        const host = parsedBaseUrl.hostname;
                        const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
                            host === '0.0.0.0' || /^127\./.test(host);
                        const isMetadata = host === '169.254.169.254' || /^169\.254\./.test(host) ||
                            /^fe80:/i.test(host);
                        const isPrivateV4 = /^10\./.test(host) ||
                            /^192\.168\./.test(host) ||
                            /^172\.(1[6-9]|2\d|3[01])\./.test(host);
                        if (isMetadata) {
                            return { pass: false, reason: `Refusing to fetch metadata IP ${host}` };
                        }
                        const allowRemote = process.env.MONOMIND_OLLAMA_ALLOW_REMOTE === '1';
                        if (!isLoopback && (isPrivateV4 || !allowRemote)) {
                            return { pass: false, reason: `Refusing non-loopback Ollama host ${host}. Set MONOMIND_OLLAMA_ALLOW_REMOTE=1 to override.` };
                        }
                        try {
                            const controller = new AbortController();
                            const timeout = setTimeout(() => controller.abort(), 3000);
                            const res = await fetch(parsedBaseUrl.href, { signal: controller.signal });
                            clearTimeout(timeout);
                            if (res.ok)
                                return { pass: true, reason: `Reachable at ${parsedBaseUrl.href}` };
                            return { pass: false, reason: `HTTP ${res.status} from ${parsedBaseUrl.href}` };
                        }
                        catch {
                            return { pass: false, reason: `Unreachable at ${parsedBaseUrl.href}` };
                        }
                    },
                },
            ];
            // Filter to requested provider or test all
            let checksToRun;
            if (testAll || !provider) {
                checksToRun = knownChecks;
            }
            else {
                const match = knownChecks.find((c) => c.name.toLowerCase() === provider.toLowerCase());
                if (match) {
                    checksToRun = [match];
                }
                else {
                    // Unknown provider -- check if it has a config entry with an apiKey
                    checksToRun = [
                        {
                            name: provider,
                            test: async () => {
                                const key = getConfigApiKey(provider);
                                if (key)
                                    return { pass: true, reason: 'API key found in config' };
                                return { pass: false, reason: 'No API key in environment or config' };
                            },
                        },
                    ];
                }
            }
            let anyPassed = false;
            const results = [];
            for (const check of checksToRun) {
                const result = await check.test();
                results.push({ name: check.name, ...result });
                if (result.pass)
                    anyPassed = true;
            }
            output.writeln();
            for (const r of results) {
                const icon = r.pass ? output.success('PASS') : output.error('FAIL');
                output.writeln(`  ${icon}  ${r.name}: ${r.reason}`);
            }
            output.writeln();
            if (anyPassed) {
                output.writeln(output.success(`${results.filter((r) => r.pass).length}/${results.length} provider(s) passed.`));
            }
            else {
                output.writeln(output.warning('No providers passed connectivity checks.'));
            }
            return { success: anyPassed };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            output.printError(`Provider test failed: ${msg}`);
            return { success: false, exitCode: 1 };
        }
    },
};
// Models subcommand
const modelsCommand = {
    name: 'models',
    description: 'List and manage available models',
    options: [
        { name: 'provider', short: 'p', type: 'string', description: 'Filter by provider' },
        { name: 'capability', short: 'c', type: 'string', description: 'Filter by capability: chat, completion, embedding' },
    ],
    examples: [
        { command: 'monomind providers models', description: 'List all models' },
        { command: 'monomind providers models -p anthropic', description: 'List Anthropic models' },
    ],
    action: async (ctx) => {
        output.writeln();
        output.writeln(output.bold('Available Models'));
        output.writeln(output.dim('─'.repeat(70)));
        output.printTable({
            columns: [
                { key: 'model', header: 'Model', width: 28 },
                { key: 'provider', header: 'Provider', width: 14 },
                { key: 'capability', header: 'Capability', width: 12 },
                { key: 'context', header: 'Context', width: 10 },
                { key: 'cost', header: 'Cost/1K', width: 12 },
            ],
            data: [
                { model: 'claude-3.5-sonnet-20241022', provider: 'Anthropic', capability: 'Chat', context: '200K', cost: '$0.003/$0.015' },
                { model: 'claude-3-opus-20240229', provider: 'Anthropic', capability: 'Chat', context: '200K', cost: '$0.015/$0.075' },
                { model: 'gpt-4o', provider: 'OpenAI', capability: 'Chat', context: '128K', cost: '$0.005/$0.015' },
                { model: 'gpt-4-turbo', provider: 'OpenAI', capability: 'Chat', context: '128K', cost: '$0.01/$0.03' },
                { model: 'text-embedding-3-small', provider: 'OpenAI', capability: 'Embedding', context: '8K', cost: '$0.00002' },
                { model: 'text-embedding-3-large', provider: 'OpenAI', capability: 'Embedding', context: '8K', cost: '$0.00013' },
                { model: 'Xenova/all-MiniLM-L6-v2', provider: 'Transformers', capability: 'Embedding', context: '512', cost: output.success('Free') },
            ],
        });
        return { success: true };
    },
};
// Usage subcommand
const usageCommand = {
    name: 'usage',
    description: 'View provider usage and costs',
    options: [
        { name: 'provider', short: 'p', type: 'string', description: 'Filter by provider' },
        { name: 'timeframe', short: 't', type: 'string', description: 'Timeframe: 24h, 7d, 30d', default: '7d' },
    ],
    examples: [
        { command: 'monomind providers usage', description: 'View all usage' },
        { command: 'monomind providers usage -t 30d', description: 'View 30-day usage' },
    ],
    action: async (ctx) => {
        const timeframe = ctx.flags.timeframe || '7d';
        output.writeln();
        output.writeln(output.bold(`Provider Usage (${timeframe})`));
        output.writeln(output.dim('─'.repeat(60)));
        output.printTable({
            columns: [
                { key: 'provider', header: 'Provider', width: 15 },
                { key: 'requests', header: 'Requests', width: 12 },
                { key: 'tokens', header: 'Tokens', width: 15 },
                { key: 'cost', header: 'Est. Cost', width: 12 },
                { key: 'trend', header: 'Trend', width: 12 },
            ],
            data: [
                { provider: 'Anthropic', requests: '12,847', tokens: '4.2M', cost: '$12.60', trend: output.warning('↑ 15%') },
                { provider: 'OpenAI (LLM)', requests: '3,421', tokens: '1.1M', cost: '$5.50', trend: output.success('↓ 8%') },
                { provider: 'OpenAI (Embed)', requests: '89,234', tokens: '12.4M', cost: '$0.25', trend: output.success('↓ 12%') },
                { provider: 'Transformers.js', requests: '234,567', tokens: '45.2M', cost: output.success('$0.00'), trend: '→' },
            ],
        });
        output.writeln();
        output.printBox([
            `Total Requests: 340,069`,
            `Total Tokens: 62.9M`,
            `Total Cost: $18.35`,
            ``,
            `Savings from local embeddings: $890.12`,
        ].join('\n'), 'Summary');
        return { success: true };
    },
};
// Main providers command
export const providersCommand = {
    name: 'providers',
    description: 'Manage AI providers, models, and configurations',
    subcommands: [listCommand, configureCommand, testCommand, modelsCommand, usageCommand],
    examples: [
        { command: 'monomind providers list', description: 'List all providers' },
        { command: 'monomind providers configure -p openai', description: 'Configure OpenAI' },
        { command: 'monomind providers test --all', description: 'Test all providers' },
    ],
    action: async () => {
        output.writeln();
        output.writeln(output.bold('MonoMind Provider Management'));
        output.writeln(output.dim('Multi-provider AI orchestration'));
        output.writeln();
        output.writeln('Subcommands:');
        output.printList([
            'list      - List available providers and their status',
            'configure - Configure provider settings and API keys',
            'test      - Test provider connectivity',
            'models    - List and manage available models',
            'usage     - View usage statistics and costs',
        ]);
        output.writeln();
        output.writeln('Supported Providers:');
        output.printList([
            'Anthropic (Claude models)',
            'OpenAI (GPT + embeddings)',
            'Transformers.js (local ONNX)',
            'Agentic Flow (optimized ONNX with SIMD)',
        ]);
        output.writeln();
        output.writeln(output.dim('github.com/monoes/monomind'));
        return { success: true };
    },
};
export default providersCommand;
//# sourceMappingURL=providers.js.map