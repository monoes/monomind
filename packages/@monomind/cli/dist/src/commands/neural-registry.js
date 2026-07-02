/**
 * Neural registry commands — list and import models from IPFS
 */
import { output } from '../output.js';
// ─── list subcommand ─────────────────────────────────────────────────────────
export const listCommand = {
    name: 'list',
    description: 'List available pre-trained models from the official registry',
    options: [
        { name: 'category', type: 'string', description: 'Filter by category (security, quality, performance, etc.)' },
        { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json, simple', default: 'table' },
        { name: 'cid', type: 'string', description: 'Custom registry CID (default: official registry)' },
    ],
    examples: [
        { command: 'monomind neural list', description: 'List all available models' },
        { command: 'monomind neural list --category security', description: 'List only security models' },
        { command: 'monomind neural list -f json', description: 'Output as JSON' },
    ],
    action: async (ctx) => {
        const category = ctx.flags.category;
        const format = ctx.flags.format || 'table';
        const customCid = ctx.flags.cid;
        const registryCid = customCid || 'QmNr1yYMKi7YBaL8JSztQyuB5ZUaTdRMLxJC1pBpGbjsTc';
        output.writeln();
        output.writeln(output.bold('Pre-trained Model Registry'));
        output.writeln(output.dim('─'.repeat(60)));
        const spinner = output.createSpinner({ text: 'Fetching model registry...', spinner: 'dots' });
        spinner.start();
        try {
            const gateways = ['https://gateway.pinata.cloud', 'https://ipfs.io', 'https://dweb.link'];
            let registry = null;
            for (const gateway of gateways) {
                try {
                    const response = await fetch(`${gateway}/ipfs/${registryCid}`, {
                        signal: AbortSignal.timeout(15000),
                        headers: { 'Accept': 'application/json' },
                    });
                    if (response.ok) {
                        const MAX_REGISTRY_BYTES = 50 * 1024 * 1024;
                        const buf = await response.arrayBuffer();
                        if (buf.byteLength > MAX_REGISTRY_BYTES)
                            throw new Error(`Registry response too large: ${buf.byteLength} bytes`);
                        registry = JSON.parse(new TextDecoder().decode(buf));
                        break;
                    }
                }
                catch {
                    continue;
                }
            }
            if (!registry || !registry.models) {
                spinner.fail('Could not fetch model registry');
                return { success: false, exitCode: 1 };
            }
            let models = registry.models;
            if (category) {
                models = models.filter(m => m.category === category ||
                    m.id.includes(category) ||
                    m.name.toLowerCase().includes(category.toLowerCase()));
                spinner.succeed(`Found ${models.length} models matching "${category}"`);
            }
            else {
                spinner.succeed(`Found ${registry.models.length} models`);
            }
            if (models.length === 0) {
                output.writeln(output.warning(`No models found for category: ${category}`));
                output.writeln(output.dim('Available categories: security, quality, performance, testing, api, debugging, refactoring, documentation'));
                return { success: false, exitCode: 1 };
            }
            output.writeln();
            if (format === 'json') {
                output.writeln(JSON.stringify(models, null, 2));
            }
            else if (format === 'simple') {
                for (const model of models) {
                    output.writeln(`${model.id} (${model.category}) - ${model.patterns.length} patterns, ${(model.metadata.accuracy * 100).toFixed(0)}% accuracy`);
                }
            }
            else {
                output.printTable({
                    columns: [
                        { key: 'id', header: 'Model ID', width: 35 },
                        { key: 'category', header: 'Category', width: 14 },
                        { key: 'patterns', header: 'Patterns', width: 10 },
                        { key: 'accuracy', header: 'Accuracy', width: 10 },
                        { key: 'usage', header: 'Usage', width: 10 },
                    ],
                    data: models.map(m => ({
                        id: m.id, category: m.category,
                        patterns: String(m.patterns.length),
                        accuracy: `${(m.metadata.accuracy * 100).toFixed(0)}%`,
                        usage: m.metadata.totalUsage.toLocaleString(),
                    })),
                });
                output.writeln();
                output.writeln(output.dim('Registry CID: ' + registryCid));
                output.writeln();
                output.writeln(output.bold('Import Commands:'));
                output.writeln(output.dim('  All models:      ') + `monomind neural import --cid ${registryCid}`);
                if (category) {
                    output.writeln(output.dim(`  ${category} only: `) + `monomind neural import --cid ${registryCid} --category ${category}`);
                }
                else {
                    output.writeln(output.dim('  By category:     ') + `monomind neural import --cid ${registryCid} --category <category>`);
                }
            }
            return { success: true };
        }
        catch (error) {
            spinner.fail(`Failed to list models: ${error instanceof Error ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    },
};
// ─── import subcommand ───────────────────────────────────────────────────────
export const importCommand = {
    name: 'import',
    description: 'Import trained models from IPFS with signature verification',
    options: [
        { name: 'cid', short: 'c', type: 'string', description: 'IPFS CID to import from' },
        { name: 'file', short: 'f', type: 'string', description: 'Local file to import' },
        { name: 'verify', short: 'v', type: 'boolean', description: 'Verify Ed25519 signature', default: 'true' },
        { name: 'merge', type: 'boolean', description: 'Merge with existing patterns (vs replace)', default: 'true' },
        { name: 'category', type: 'string', description: 'Only import patterns from specific category' },
    ],
    examples: [
        { command: 'monomind neural import --cid QmXxx...', description: 'Import from IPFS' },
        { command: 'monomind neural import -f ./patterns.json --verify', description: 'Import from file' },
        { command: 'monomind neural import --cid QmNr1yYMK... --category security', description: 'Import only security patterns' },
    ],
    action: async (ctx) => {
        const cid = ctx.flags.cid;
        const file = ctx.flags.file;
        const verifySignature = ctx.flags.verify !== false;
        const merge = ctx.flags.merge !== false;
        const categoryFilter = ctx.flags.category;
        if (!cid && !file) {
            output.writeln(output.error('Either --cid or --file is required'));
            return { success: false, exitCode: 1 };
        }
        output.writeln();
        output.writeln(output.bold('Secure Model Import'));
        output.writeln(output.dim('─'.repeat(50)));
        const spinner = output.createSpinner({ text: 'Fetching model...', spinner: 'dots' });
        spinner.start();
        try {
            const fs = await import('fs');
            const path = await import('path');
            const crypto = await import('crypto');
            let importData = null;
            if (cid) {
                const gateways = ['https://gateway.pinata.cloud', 'https://ipfs.io', 'https://dweb.link'];
                for (const gateway of gateways) {
                    try {
                        spinner.setText(`Fetching from ${gateway}...`);
                        const response = await fetch(`${gateway}/ipfs/${cid}`, {
                            signal: AbortSignal.timeout(30000),
                            headers: { 'Accept': 'application/json' },
                        });
                        if (response.ok) {
                            const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
                            const importBuf = await response.arrayBuffer();
                            if (importBuf.byteLength > MAX_IMPORT_BYTES)
                                throw new Error(`Import response too large: ${importBuf.byteLength} bytes`);
                            importData = JSON.parse(new TextDecoder().decode(importBuf));
                            break;
                        }
                    }
                    catch {
                        continue;
                    }
                }
                if (!importData) {
                    spinner.fail('Could not fetch from any IPFS gateway');
                    return { success: false, exitCode: 1 };
                }
            }
            else {
                if (!fs.existsSync(file)) {
                    spinner.fail(`File not found: ${file}`);
                    return { success: false, exitCode: 1 };
                }
                const stat = fs.statSync(file);
                const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
                if (stat.size > MAX_IMPORT_BYTES) {
                    spinner.fail(`Import file too large: ${stat.size} bytes (max ${MAX_IMPORT_BYTES})`);
                    return { success: false, exitCode: 1 };
                }
                importData = JSON.parse(fs.readFileSync(file, 'utf8'));
            }
            if (!importData) {
                spinner.fail('No import data available');
                return { success: false, exitCode: 1 };
            }
            // SECURITY: Verify signature — fail-CLOSED (no bypass if missing or malformed)
            if (verifySignature) {
                if (!importData.signature || !importData.publicKey) {
                    spinner.fail('SECURITY: --verify requested but payload is unsigned. Aborting (use --no-verify to override).');
                    return { success: false, exitCode: 1 };
                }
                spinner.setText('Verifying Ed25519 signature...');
                try {
                    const { webcrypto } = crypto;
                    const publicKeyHex = importData.publicKey.replace('ed25519:', '');
                    const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
                    const signatureBytes = Buffer.from(importData.signature, 'hex');
                    const publicKey = await webcrypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']);
                    const dataBytes = new TextEncoder().encode(JSON.stringify(importData.pinataContent));
                    const valid = await webcrypto.subtle.verify('Ed25519', publicKey, signatureBytes, dataBytes);
                    if (!valid) {
                        spinner.fail('Signature verification FAILED - data may be tampered');
                        return { success: false, exitCode: 1 };
                    }
                    output.writeln(output.success('Signature verified'));
                }
                catch (err) {
                    // FAIL-CLOSED: any error during verification must reject the import
                    spinner.fail(`SECURITY: Signature verification error: ${err instanceof Error ? err.message : String(err)}. Aborting.`);
                    return { success: false, exitCode: 1 };
                }
            }
            spinner.setText('Importing patterns...');
            const content = importData.pinataContent || importData;
            let patterns = [];
            const registry = content;
            if (registry.models && Array.isArray(registry.models)) {
                for (const model of registry.models) {
                    if (!categoryFilter || model.category === categoryFilter || model.id.includes(categoryFilter)) {
                        for (const pattern of model.patterns || []) {
                            patterns.push({ ...pattern, category: model.category });
                        }
                    }
                }
            }
            else {
                patterns = content.patterns || [];
            }
            if (categoryFilter && patterns.length > 0) {
                patterns = patterns.filter(p => p.category === categoryFilter || p.trigger.includes(categoryFilter));
            }
            // Validate patterns (security check)
            const suspicious = ['eval(', 'Function(', 'exec(', 'spawn(', 'child_process', 'rm -rf', 'sudo', '<script>', 'javascript:', 'data:'];
            const validPatterns = patterns.filter(p => {
                const c = JSON.stringify(p);
                return !suspicious.some(s => c.includes(s));
            });
            if (validPatterns.length < patterns.length) {
                output.writeln(output.warning(`Filtered ${patterns.length - validPatterns.length} suspicious patterns`));
            }
            const memoryDir = path.join(process.cwd(), '.monomind', 'neural');
            if (!fs.existsSync(memoryDir))
                fs.mkdirSync(memoryDir, { recursive: true });
            const patternsFile = path.join(memoryDir, 'patterns.json');
            let existingPatterns = [];
            if (merge && fs.existsSync(patternsFile) && fs.statSync(patternsFile).size <= 50 * 1024 * 1024) {
                existingPatterns = JSON.parse(fs.readFileSync(patternsFile, 'utf8'));
            }
            const existingIds = new Set(existingPatterns.map(p => p.id));
            const newPatterns = validPatterns.filter(p => !existingIds.has(p.id));
            const finalPatterns = merge ? [...existingPatterns, ...newPatterns] : validPatterns;
            const tmpPatterns = `${patternsFile}.${process.pid}.${Date.now()}.tmp`;
            fs.writeFileSync(tmpPatterns, JSON.stringify(finalPatterns, null, 2), { flag: 'wx' });
            fs.renameSync(tmpPatterns, patternsFile);
            spinner.succeed('Import complete');
            output.writeln();
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 25 },
                    { key: 'value', header: 'Value', width: 20 },
                ],
                data: [
                    { metric: 'Patterns Imported', value: String(validPatterns.length) },
                    { metric: 'New Patterns', value: String(newPatterns.length) },
                    { metric: 'Total Patterns', value: String(finalPatterns.length) },
                    { metric: 'Signature Verified', value: importData.signature ? 'Yes' : 'N/A' },
                    { metric: 'Merge Mode', value: merge ? 'Yes' : 'Replace' },
                ],
            });
            output.writeln();
            output.writeln(output.success('Patterns imported and ready to use'));
            output.writeln(output.dim('Run "monomind neural patterns --action list" to see imported patterns'));
            return { success: true };
        }
        catch (error) {
            spinner.fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    },
};
//# sourceMappingURL=neural-registry.js.map