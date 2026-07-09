/**
 * Memory Transfer Commands
 * exportCommand, importCommand
 */
import { output } from '../output.js';
// Export command
export const exportCommand = {
    name: 'export',
    description: 'Export memory to file',
    options: [
        {
            name: 'output',
            short: 'o',
            description: 'Output file path',
            type: 'string',
            required: true
        },
        {
            name: 'format',
            short: 'f',
            description: 'Export format (json, csv, binary, okf)',
            type: 'string',
            choices: ['json', 'csv', 'binary', 'okf'],
            default: 'json'
        },
        {
            name: 'namespace',
            short: 'n',
            description: 'Export specific namespace',
            type: 'string'
        },
        {
            name: 'include-vectors',
            description: 'Include vector embeddings',
            type: 'boolean',
            default: true
        }
    ],
    examples: [
        { command: 'monomind memory export -o ./backup.json', description: 'Export all to JSON' },
        { command: 'monomind memory export -o ./data.csv -f csv', description: 'Export to CSV' },
        { command: 'monomind memory export -o ./knowledge -f okf', description: 'Export as OKF bundle (directory of .md files)' }
    ],
    action: async (ctx) => {
        const outputPath = ctx.flags.output;
        const format = ctx.flags.format || 'json';
        if (!outputPath) {
            output.printError('Output path is required. Use --output or -o');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Exporting memory to ${outputPath}...`);
        // OKF bundle: native export — directory of .md files with YAML frontmatter
        if (format === 'okf') {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const { listEntries, getEntry } = await import('../memory/memory-initializer.js');
                const namespace = ctx.flags.namespace;
                const listed = await listEntries({ namespace, limit: 10000 });
                if (!listed.success) {
                    output.printError(`Failed to list entries: ${listed.error}`);
                    return { success: false, exitCode: 1 };
                }
                let written = 0;
                for (const entry of listed.entries) {
                    const got = await getEntry({ key: entry.key, namespace: entry.namespace });
                    if (!got.found || !got.entry)
                        continue;
                    const { key, namespace: ns, content, tags, createdAt } = got.entry;
                    const safeKey = key.replace(/[/\\:*?"<>|]/g, '-');
                    const dir = path.join(outputPath, ns);
                    fs.mkdirSync(dir, { recursive: true });
                    const yamlEscape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const tagsLine = tags.length > 0 ? `tags: [${tags.join(', ')}]\n` : '';
                    const md = `---\ntype: Memory\nkey: "${yamlEscape(key)}"\nnamespace: "${yamlEscape(ns)}"\n${tagsLine}timestamp: ${createdAt}\n---\n\n${content}`;
                    fs.writeFileSync(path.join(dir, `${safeKey}.md`), md, 'utf-8');
                    written++;
                }
                output.printSuccess(`Exported ${written} entries to ${outputPath}`);
                if (listed.total > 10000) {
                    output.printInfo(`Note: only first 10000 of ${listed.total} entries exported`);
                }
                return { success: true, data: { written, outputPath } };
            }
            catch (error) {
                output.printError(`OKF export error: ${String(error)}`);
                return { success: false, exitCode: 1 };
            }
        }
        output.printError(`Unsupported export format: ${format}. Use --format okf for file-based export.`);
        return { success: false, exitCode: 1 };
    }
};
// Import command
export const importCommand = {
    name: 'import',
    description: 'Import memory from file',
    options: [
        {
            name: 'input',
            short: 'i',
            description: 'Input file path',
            type: 'string',
            required: true
        },
        {
            name: 'merge',
            short: 'm',
            description: 'Merge with existing (skip duplicates)',
            type: 'boolean',
            default: true
        },
        {
            name: 'namespace',
            short: 'n',
            description: 'Import into specific namespace',
            type: 'string'
        }
    ],
    examples: [
        { command: 'monomind memory import -i ./backup.json', description: 'Import from file' },
        { command: 'monomind memory import -i ./data.json -n archive', description: 'Import to namespace' }
    ],
    action: async (ctx) => {
        const inputPath = ctx.flags.input || ctx.args[0];
        if (!inputPath) {
            output.printError('Input path is required. Use --input or -i');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Importing memory from ${inputPath}...`);
        // OKF bundle: native import — detect directory of .md files with YAML frontmatter
        const fsCheck = await import('fs');
        const isDir = fsCheck.existsSync(inputPath) && fsCheck.statSync(inputPath).isDirectory();
        if (isDir) {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const { storeEntry } = await import('../memory/memory-initializer.js');
                function parseOkfFrontmatter(raw) {
                    if (!raw.startsWith('---\n'))
                        return { meta: {}, body: raw };
                    const end = raw.indexOf('\n---\n', 4);
                    if (end === -1)
                        return { meta: {}, body: raw };
                    const meta = {};
                    for (const line of raw.slice(4, end).split('\n')) {
                        const colon = line.indexOf(':');
                        if (colon <= 0)
                            continue;
                        const k = line.slice(0, colon).trim();
                        const rawV = line.slice(colon + 1).trim();
                        const isQuoted = rawV.startsWith('"') && rawV.endsWith('"') && rawV.length >= 2;
                        const v = isQuoted ? rawV.slice(1, -1).replace(/\\(["\\])/g, '$1') : rawV;
                        if (v.startsWith('[') && v.endsWith(']')) {
                            meta[k] = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
                        }
                        else {
                            meta[k] = v;
                        }
                    }
                    return { meta, body: raw.slice(end + 5) };
                }
                function findMdFiles(dir) {
                    const results = [];
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory())
                            results.push(...findMdFiles(full));
                        else if (entry.name.endsWith('.md'))
                            results.push(full);
                    }
                    return results;
                }
                const overrideNs = ctx.flags.namespace;
                const merge = ctx.flags.merge ?? true;
                const files = findMdFiles(inputPath);
                let imported = 0, skipped = 0;
                const start = Date.now();
                for (const file of files) {
                    const raw = fs.readFileSync(file, 'utf-8');
                    const { meta, body } = parseOkfFrontmatter(raw);
                    const key = meta['key'] || path.basename(file, '.md');
                    const ns = overrideNs || meta['namespace'] || path.basename(path.dirname(file));
                    const tags = Array.isArray(meta['tags']) ? meta['tags'] : meta['tags'] ? [meta['tags']] : [];
                    const result = await storeEntry({ key, value: body.trim(), namespace: ns, tags, upsert: !merge });
                    if (result.success)
                        imported++;
                    else
                        skipped++;
                }
                output.printSuccess(`Imported ${imported} entries from ${inputPath}`);
                if (skipped > 0)
                    output.printInfo(`Skipped ${skipped} entries (duplicates or errors)`);
                output.printInfo(`Duration: ${Date.now() - start}ms`);
                return { success: true, data: { imported, skipped } };
            }
            catch (error) {
                output.printError(`OKF import error: ${String(error)}`);
                return { success: false, exitCode: 1 };
            }
        }
        output.printError(`Unsupported import format. Provide a directory of .md files (OKF bundle) for file-based import.`);
        return { success: false, exitCode: 1 };
    }
};
//# sourceMappingURL=memory-transfer.js.map