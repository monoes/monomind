/**
 * Neural core commands — status, patterns, predict
 */
import { output } from '../output.js';
// ─── status subcommand ───────────────────────────────────────────────────────
export const statusCommand = {
    name: 'status',
    description: 'Check pattern-learning status (JS intelligence layer)',
    options: [
        { name: 'verbose', short: 'v', type: 'boolean', description: 'Show detailed metrics' },
    ],
    examples: [
        { command: 'monomind neural status', description: 'Show pattern-learning status' },
        { command: 'monomind neural status -v', description: 'Show detailed metrics' },
    ],
    action: async (ctx) => {
        const verbose = ctx.flags.verbose === true;
        output.writeln();
        output.writeln(output.bold('Pattern Learning Status'));
        output.writeln(output.dim('─'.repeat(50)));
        const spinner = output.createSpinner({ text: 'Checking pattern-learning systems...', spinner: 'dots' });
        spinner.start();
        try {
            const { getIntelligenceStats, initializeIntelligence, getPersistenceStatus } = await import('../memory/intelligence.js');
            const { getHNSWStatus, loadEmbeddingModel } = await import('../memory/memory-initializer.js');
            await initializeIntelligence();
            const stats = getIntelligenceStats();
            const hnswStatus = getHNSWStatus();
            const persistence = getPersistenceStatus();
            const modelInfo = await loadEmbeddingModel({ verbose: false });
            spinner.succeed('Pattern-learning systems checked');
            output.writeln();
            output.printTable({
                columns: [
                    { key: 'component', header: 'Component', width: 22 },
                    { key: 'status', header: 'Status', width: 12 },
                    { key: 'details', header: 'Details', width: 34 },
                ],
                data: [
                    {
                        component: 'Pattern Learning',
                        status: stats.sonaEnabled ? output.success('Active') : output.warning('Inactive'),
                        details: stats.sonaEnabled ? 'JS pattern-learning layer initialized' : 'Not initialized',
                    },
                    {
                        component: 'ReasoningBank',
                        status: stats.reasoningBankSize > 0 ? output.success('Active') : output.dim('Empty'),
                        details: `${stats.patternsLearned} patterns stored`,
                    },
                    {
                        component: 'Pattern Index',
                        status: hnswStatus.available ? output.success('Ready') : output.dim('Empty'),
                        details: hnswStatus.available
                            ? `${hnswStatus.entryCount} vectors, ${hnswStatus.dimensions}-dim (ANN via LanceDB)`
                            : 'No vectors indexed yet',
                    },
                    {
                        component: 'Embedding Model',
                        status: modelInfo.success ? output.success('Loaded') : output.warning('Fallback'),
                        details: `${modelInfo.modelName} (${modelInfo.dimensions}-dim)`,
                    },
                    {
                        component: 'Persistence',
                        status: persistence.patternsExist ? output.success('Saved') : output.dim('None'),
                        details: persistence.patternsExist ? output.dim(persistence.dataDir) : 'No persisted patterns',
                    },
                ],
            });
            if (verbose) {
                output.writeln();
                output.writeln(output.bold('Detailed Metrics'));
                output.printTable({
                    columns: [
                        { key: 'metric', header: 'Metric', width: 28 },
                        { key: 'value', header: 'Value', width: 20 },
                    ],
                    data: [
                        { metric: 'Trajectories Recorded', value: String(stats.trajectoriesRecorded) },
                        { metric: 'Patterns Learned', value: String(stats.patternsLearned) },
                        { metric: 'ReasoningBank Size', value: String(stats.reasoningBankSize) },
                        { metric: 'Index Dimensions', value: String(hnswStatus.dimensions) },
                        { metric: 'Avg Adaptation Time', value: `${stats.avgAdaptationTime.toFixed(3)}ms` },
                        { metric: 'Last Adaptation', value: stats.lastAdaptation ? new Date(stats.lastAdaptation).toLocaleTimeString() : 'Never' },
                    ],
                });
            }
            return { success: true, data: { stats, hnswStatus, modelInfo, persistence } };
        }
        catch (error) {
            spinner.fail('Failed to check pattern-learning systems');
            output.printError(error instanceof Error ? error.message : String(error));
            return { success: false, exitCode: 1 };
        }
    },
};
// ─── patterns subcommand ─────────────────────────────────────────────────────
export const patternsCommand = {
    name: 'patterns',
    description: 'Analyze and manage cognitive patterns',
    options: [
        { name: 'action', short: 'a', type: 'string', description: 'Action: analyze, learn, predict, list', default: 'list' },
        { name: 'query', short: 'q', type: 'string', description: 'Pattern query for search' },
        { name: 'limit', short: 'l', type: 'number', description: 'Max patterns to return', default: '10' },
    ],
    examples: [
        { command: 'monomind neural patterns --action list', description: 'List all patterns' },
        { command: 'monomind neural patterns -a analyze -q "error handling"', description: 'Analyze patterns' },
    ],
    action: async (ctx) => {
        const action = ctx.flags.action || 'list';
        const query = ctx.flags.query;
        const limit = parseInt(ctx.flags.limit, 10) || 10;
        output.writeln();
        output.writeln(output.bold(`Neural Patterns - ${action}`));
        output.writeln(output.dim('─'.repeat(40)));
        try {
            const { initializeIntelligence, getIntelligenceStats, findSimilarPatterns, getAllPatterns, getPersistenceStatus } = await import('../memory/intelligence.js');
            await initializeIntelligence();
            const stats = getIntelligenceStats();
            const persistence = getPersistenceStatus();
            if (action === 'list') {
                const allPatterns = await getAllPatterns();
                const patterns = query ? await findSimilarPatterns(query, { k: limit }) : allPatterns.slice(0, limit);
                if (patterns.length === 0) {
                    output.writeln(output.dim('No patterns found. Train some patterns first with: neural train'));
                    output.writeln();
                    output.printBox([
                        `Total Patterns: ${stats.patternsLearned}`,
                        `Trajectories: ${stats.trajectoriesRecorded}`,
                        `ReasoningBank Size: ${stats.reasoningBankSize}`,
                        `Persistence: ${persistence.patternsExist ? 'Loaded from disk' : 'Not persisted'}`,
                        `Data Dir: ${persistence.dataDir}`,
                    ].join('\n'), 'Pattern Statistics');
                }
                else {
                    output.printTable({
                        columns: [
                            { key: 'id', header: 'ID', width: 20 },
                            { key: 'type', header: 'Type', width: 18 },
                            { key: 'confidence', header: 'Confidence', width: 12 },
                            { key: 'usage', header: 'Usage', width: 10 },
                        ],
                        data: patterns.map((p, i) => ({
                            id: (p.id || `P${String(i + 1).padStart(3, '0')}`).substring(0, 18),
                            type: output.highlight(p.type || 'unknown'),
                            confidence: `${((p.confidence || 0.5) * 100).toFixed(1)}%`,
                            usage: String(p.usageCount || 0),
                        })),
                    });
                }
                output.writeln();
                output.writeln(output.dim(`Total: ${allPatterns.length} patterns (persisted) | Trajectories: ${stats.trajectoriesRecorded}`));
                if (persistence.patternsExist)
                    output.writeln(output.success(`✓ Loaded from: ${persistence.patternsFile}`));
            }
            else if (action === 'analyze' && !query) {
                output.printError('--query is required when --action analyze is used.');
                return { success: false, exitCode: 1 };
            }
            else if (action === 'analyze' && query) {
                const related = await findSimilarPatterns(query, { k: limit });
                output.writeln(`Analyzing patterns related to: "${query}"`);
                output.writeln();
                if (related.length > 0) {
                    output.printTable({
                        columns: [
                            { key: 'content', header: 'Pattern', width: 40 },
                            { key: 'confidence', header: 'Confidence', width: 12 },
                            { key: 'type', header: 'Type', width: 15 },
                        ],
                        data: related.slice(0, 5).map(p => ({
                            content: (p.content || '').substring(0, 38) + (p.content?.length > 38 ? '...' : ''),
                            confidence: `${((p.confidence || 0) * 100).toFixed(0)}%`,
                            type: p.type || 'general',
                        })),
                    });
                }
                else {
                    output.writeln(output.dim('No related patterns found.'));
                }
            }
            return { success: true };
        }
        catch {
            output.writeln(output.dim('Intelligence system not initialized.'));
            output.writeln(output.dim('Run: monomind neural train --pattern-type general'));
            return { success: false };
        }
    },
};
// ─── predict subcommand ──────────────────────────────────────────────────────
export const predictCommand = {
    name: 'predict',
    description: 'Make AI predictions using trained models',
    options: [
        { name: 'input', short: 'i', type: 'string', description: 'Input text to predict routing for', required: true },
        { name: 'k', short: 'k', type: 'number', description: 'Number of top predictions', default: '5' },
        { name: 'format', short: 'f', type: 'string', description: 'Output format: json, table', default: 'table' },
    ],
    examples: [
        { command: 'monomind neural predict -i "implement authentication"', description: 'Predict routing for task' },
        { command: 'monomind neural predict -i "fix bug in login" -k 3', description: 'Get top 3 predictions' },
    ],
    action: async (ctx) => {
        const inputText = ctx.flags.input;
        const k = parseInt(ctx.flags.k || '5', 10);
        const format = ctx.flags.format || 'table';
        if (!inputText) {
            output.printError('--input is required');
            return { success: false, exitCode: 1 };
        }
        output.writeln();
        output.writeln(output.bold('Neural Prediction (Real)'));
        output.writeln(output.dim('─'.repeat(50)));
        const spinner = output.createSpinner({ text: 'Running inference...', spinner: 'dots' });
        spinner.start();
        try {
            const { initializeIntelligence, findSimilarPatterns } = await import('../memory/intelligence.js');
            await initializeIntelligence();
            const startSearch = performance.now();
            const matches = await findSimilarPatterns(inputText, { k });
            const searchTime = performance.now() - startSearch;
            spinner.succeed(`Prediction complete (search: ${searchTime.toFixed(1)}ms)`);
            output.writeln();
            if (matches.length === 0) {
                output.writeln(output.warning('No similar patterns found. Try training first: monomind neural train'));
                return { success: true, data: { matches: [] } };
            }
            if (format === 'json') {
                output.writeln(JSON.stringify(matches, null, 2));
            }
            else {
                const patternTypes = {};
                for (const match of matches) {
                    const type = match.type || 'unknown';
                    patternTypes[type] = (patternTypes[type] || 0) + match.similarity;
                }
                const sorted = Object.entries(patternTypes).sort((a, b) => b[1] - a[1]);
                const topType = sorted[0]?.[0] || 'unknown';
                const confidence = matches[0]?.similarity || 0;
                output.printBox([
                    `Input: ${inputText.substring(0, 60)}${inputText.length > 60 ? '...' : ''}`,
                    ``,
                    `Predicted Type: ${topType}`,
                    `Confidence: ${(confidence * 100).toFixed(1)}%`,
                    `Latency: ${searchTime.toFixed(1)}ms`,
                    ``,
                    `Top ${matches.length} Similar Patterns:`,
                ].join('\n'), 'Result');
                output.printTable({
                    columns: [
                        { key: 'rank', header: '#', width: 3 },
                        { key: 'id', header: 'Pattern ID', width: 20 },
                        { key: 'type', header: 'Type', width: 15 },
                        { key: 'similarity', header: 'Similarity', width: 12 },
                    ],
                    data: matches.slice(0, k).map((m, i) => ({
                        rank: String(i + 1),
                        id: m.id?.substring(0, 20) || 'unknown',
                        type: m.type || 'action',
                        similarity: `${(m.similarity * 100).toFixed(1)}%`,
                    })),
                });
            }
            return { success: true, data: { matches, searchTime } };
        }
        catch (error) {
            spinner.fail('Prediction failed');
            output.printError(error instanceof Error ? error.message : String(error));
            return { success: false, exitCode: 1 };
        }
    },
};
//# sourceMappingURL=neural-core.js.map