export function listBoundaries(config) {
    const rules = [];
    for (const zone of config.zones ?? []) {
        for (const dep of zone.allowedDeps ?? []) {
            rules.push({ fromZone: zone.name, toZone: dep, allowed: true });
        }
        for (const dep of zone.deniedDeps ?? []) {
            rules.push({ fromZone: zone.name, toZone: dep, allowed: false });
        }
    }
    return rules;
}
export function listPlugins(config) {
    return (config.plugins ?? []).map((p) => ({
        name: p.name,
        version: p.version ?? '0.0.0',
        hooks: p.hooks ?? [],
    }));
}
export function listEntryPoints(config) {
    return config.entryPoints ?? [];
}
export function formatListHuman(items, columns) {
    if (items.length === 0)
        return '';
    // Calculate column widths from header and values
    const widths = columns.map((col) => {
        const headerLen = col.length;
        const maxValueLen = items.reduce((max, item) => {
            const val = item[col] !== undefined && item[col] !== null ? String(item[col]) : '';
            return Math.max(max, val.length);
        }, 0);
        return Math.max(headerLen, maxValueLen);
    });
    const pad = (str, width) => str.padEnd(width);
    const header = columns.map((col, i) => pad(col, widths[i])).join('  ');
    const separator = widths.map((w) => '-'.repeat(w)).join('  ');
    const rows = items.map((item) => columns.map((col, i) => {
        const val = item[col] !== undefined && item[col] !== null ? String(item[col]) : '';
        return pad(val, widths[i]);
    }).join('  '));
    return [header, separator, ...rows].join('\n');
}
//# sourceMappingURL=list.js.map