// Partition analysis results into labeled groups by owner, directory, package, or section.
export function createPackageResolver(packages) {
    const sorted = [...packages].sort((a, b) => b.root.length - a.root.length);
    return {
        packages,
        resolve(filePath) {
            const normalized = filePath.replace(/\\/g, '/');
            const match = sorted.find(p => normalized.startsWith(p.root.replace(/\\/g, '/')));
            return match?.name ?? '(root)';
        },
    };
}
export function resolveDirectoryGroup(filePath, depth = 1) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.slice(0, depth + 1).join('/') || '(root)';
}
export function groupItemsByFile(items, resolve) {
    const map = new Map();
    for (const item of items) {
        const label = resolve(item.filePath);
        if (!map.has(label))
            map.set(label, []);
        map.get(label).push(item);
    }
    return [...map.entries()]
        .map(([label, its]) => ({ label, items: its }))
        .sort((a, b) => b.items.length - a.items.length);
}
/** Attribution: most instances wins, alphabetical tiebreak. */
export function largestOwner(instances, resolveOwner) {
    const counts = new Map();
    for (const inst of instances) {
        const owner = resolveOwner(inst.filePath);
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    if (counts.size === 0)
        return '(unknown)';
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
export function attributeCloneGroup(group, resolveOwner) {
    const attributed = group.instances.map(i => ({
        ...i,
        owner: resolveOwner(i.filePath),
    }));
    return {
        id: group.id,
        instances: attributed,
        primaryOwner: largestOwner(group.instances, resolveOwner),
        duplicatedLines: group.duplicatedLines,
    };
}
export function groupResultsByOwner(items, resolver) {
    const map = new Map();
    for (const item of items) {
        const fp = item.filePath ?? item['path'] ?? '';
        const key = resolver(fp);
        if (!map.has(key))
            map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}
export function partitionByOwner(items, resolver) {
    const grouped = groupResultsByOwner(items, resolver);
    const groups = [];
    for (const [key, results] of grouped) {
        const filePaths = new Set(results.map(r => r.filePath ?? r['path'] ?? ''));
        groups.push({ key, results, fileCount: filePaths.size });
    }
    return groups.sort((a, b) => b.results.length - a.results.length);
}
export function resolveWithPattern(filePath, ownerMap) {
    for (const [pattern, owner] of ownerMap) {
        if (filePath.includes(pattern))
            return { owner, pattern };
    }
    return { owner: 'unowned', pattern: null };
}
//# sourceMappingURL=grouping.js.map