import { CapabilityManager } from '../capabilities/manager.js';
import { loadFingerprint, listFiles } from '../capabilities/scanner.js';
import { codeCapability } from '../capabilities/cap-code.js';
import { documentsCapability } from '../capabilities/cap-documents.js';
import { mediaCapability } from '../capabilities/cap-media.js';
import { dataCapability } from '../capabilities/cap-data.js';
import { graphCapability } from '../capabilities/cap-graph.js';
import { timelineCapability } from '../capabilities/cap-timeline.js';
import path from 'path';
const TYPE_ICONS = {
    documents: '📄',
    media: '📷',
    data: '📊',
    code: '💻',
    graph: '🔗',
    timeline: '📅',
};
const TYPE_LABELS = {
    documents: 'Documents',
    media: 'Photos & Media',
    data: 'Data Files',
    code: 'Code',
    graph: 'Related Files',
    timeline: 'Timeline',
};
export function groupByType(results) {
    const grouped = {};
    for (const r of results) {
        if (!grouped[r.type])
            grouped[r.type] = [];
        grouped[r.type].push(r);
    }
    return grouped;
}
export function formatSearchResults(results) {
    if (results.length === 0)
        return 'No results found.';
    const grouped = groupByType(results);
    const lines = [];
    for (const [type, items] of Object.entries(grouped)) {
        const icon = TYPE_ICONS[type] ?? '📁';
        const label = TYPE_LABELS[type] ?? type;
        lines.push(`\n${label}:`);
        for (const item of items) {
            lines.push(`  ${icon} ${item.path} — ${item.snippet}`);
        }
    }
    return lines.join('\n');
}
export const searchUniversalCommand = {
    name: 'search',
    description: 'Search across all content types',
    options: [
        { name: 'limit', description: 'Max results', type: 'number' },
        { name: 'type', description: 'Filter by type (documents, media, data, code)', type: 'string' },
    ],
    action: async (ctx) => {
        const query = ctx.args.join(' ');
        if (!query) {
            return { success: false, message: 'Usage: monomind search <query>' };
        }
        const monomindDir = path.join(ctx.cwd, '.monomind');
        const fingerprint = await loadFingerprint(monomindDir);
        if (!fingerprint) {
            console.log('No directory scan found. Run `monomind init` or `monomind scan` first.');
            return { success: true };
        }
        const mgr = new CapabilityManager();
        mgr.register(codeCapability);
        mgr.register(documentsCapability);
        mgr.register(mediaCapability);
        mgr.register(dataCapability);
        mgr.register(graphCapability);
        mgr.register(timelineCapability);
        try {
            await mgr.activateFromScan(fingerprint, ctx.cwd, false);
            const files = listFiles(ctx.cwd);
            for (const module of mgr.getActive()) {
                await module.index(files);
            }
        }
        catch (err) {
            return { success: false, message: `Failed to load capabilities: ${err instanceof Error ? err.message : String(err)}` };
        }
        const limit = ctx.flags.limit ?? 20;
        const results = await mgr.search(query, limit);
        const typeFilter = ctx.flags.type;
        const filteredResults = typeFilter
            ? results.filter((r) => r.type === typeFilter)
            : results;
        const output = formatSearchResults(filteredResults);
        console.log(output);
        return { success: true };
    },
};
export default searchUniversalCommand;
//# sourceMappingURL=search-universal.js.map