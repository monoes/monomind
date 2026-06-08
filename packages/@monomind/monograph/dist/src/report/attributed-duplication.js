import * as path from 'node:path';
export function resolveOwnerFromDirectory(filePath, root) {
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    const parts = rel.split('/');
    return parts.length > 1 ? parts[0] : '(root)';
}
export function largestOwner(instances, fallback) {
    const counts = new Map();
    for (const inst of instances) {
        counts.set(inst.owner, (counts.get(inst.owner) ?? 0) + 1);
    }
    let best = fallback;
    let bestCount = 0;
    for (const [owner, count] of counts) {
        if (count > bestCount || (count === bestCount && owner < best)) {
            best = owner;
            bestCount = count;
        }
    }
    return best;
}
export function attributeCloneGroup(group, resolveOwner) {
    const instances = group.instances.map(inst => ({
        ...inst,
        owner: resolveOwner(inst.filePath),
    }));
    const primaryOwner = largestOwner(instances, instances[0]?.owner ?? '(unknown)');
    const lineCount = group.instances.reduce((s, i) => s + (i.endLine - i.startLine + 1), 0);
    const tokenCount = group.instances.reduce((s, i) => s + (i.tokenCount ?? 0), 0);
    return { primaryOwner, tokenCount, lineCount, instances };
}
export function buildDuplicationGrouping(groups, resolveOwner, modeLabel) {
    const attributed = groups.map(g => attributeCloneGroup(g, resolveOwner));
    const byOwner = new Map();
    for (const g of attributed) {
        const existing = byOwner.get(g.primaryOwner);
        if (existing)
            existing.push(g);
        else
            byOwner.set(g.primaryOwner, [g]);
    }
    const duplicationGroups = [...byOwner.entries()]
        .map(([owner, cloneGroups]) => ({
        key: owner,
        owner,
        totalDuplicatedLines: cloneGroups.reduce((s, g) => s + g.lineCount, 0),
        totalDuplicatedTokens: cloneGroups.reduce((s, g) => s + g.tokenCount, 0),
        cloneGroups,
    }))
        .sort((a, b) => b.totalDuplicatedLines - a.totalDuplicatedLines);
    return { modeLabel, groups: duplicationGroups };
}
export function formatDuplicationGroup(group, root) {
    const lines = [
        `${group.owner ?? group.key} — ${group.cloneGroups.length} clone groups, ${group.totalDuplicatedLines} duplicated lines`,
    ];
    for (const cg of group.cloneGroups) {
        lines.push(`  [${cg.primaryOwner}] ${cg.lineCount} lines, ${cg.instances.length} instances`);
        for (const inst of cg.instances) {
            const rel = path.relative(root, inst.filePath).replace(/\\/g, '/');
            lines.push(`    ${rel}:${inst.startLine}-${inst.endLine}`);
        }
    }
    return lines;
}
//# sourceMappingURL=attributed-duplication.js.map