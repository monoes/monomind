import * as path from 'node:path';
export const MAX_FLAT_ITEMS = 10;
export const MAX_GROUPED_FILES = 10;
export const DIR_ROLLUP_THRESHOLD = 200;
export function thousands(n) {
    return n.toLocaleString('en-US');
}
export function formatPercent(n, decimals = 1) {
    return `${n.toFixed(decimals)}%`;
}
export function formatPath(filePath, root) {
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    const lastSlash = rel.lastIndexOf('/');
    if (lastSlash === -1)
        return rel;
    const dir = rel.slice(0, lastSlash + 1);
    const filename = rel.slice(lastSlash + 1);
    return `${dir}${filename}`;
}
export function formatPathParts(filePath, root) {
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    const lastSlash = rel.lastIndexOf('/');
    if (lastSlash === -1)
        return { dir: '', filename: rel };
    return { dir: rel.slice(0, lastSlash + 1), filename: rel.slice(lastSlash + 1) };
}
export function buildSectionHeader(title, count) {
    return `${title} (${thousands(count)})`;
}
export function buildGroupedByFile(items, root, maxFiles = MAX_GROUPED_FILES, maxPerFile = MAX_FLAT_ITEMS) {
    const byFile = new Map();
    for (const item of items) {
        const existing = byFile.get(item.filePath);
        if (existing)
            existing.push(item);
        else
            byFile.set(item.filePath, [item]);
    }
    const sorted = [...byFile.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, maxFiles);
    return sorted.map(([filePath, fileItems]) => ({
        filePath,
        items: fileItems.slice(0, maxPerFile).map(i => ({
            name: i.exportName ?? i.memberName ?? filePath,
            line: i.line,
        })),
    }));
}
export function pluralize(count, singular, plural) {
    return count === 1 ? singular : (plural ?? singular + 's');
}
export function summarizeTruncation(shown, total, noun) {
    if (shown >= total)
        return null;
    return `… and ${thousands(total - shown)} more ${noun}`;
}
export function formatCircularCycle(cycle, root) {
    return cycle
        .map(f => path.relative(root, f).replace(/\\/g, '/'))
        .join(' → ');
}
export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60_000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
//# sourceMappingURL=number-format.js.map