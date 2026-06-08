export function flagUseToFeatureFlag(flagUse, filePath, line) {
    return {
        name: flagUse.name,
        filePath,
        isEnabled: flagUse.isEnabled,
        condition: flagUse.condition,
        line,
    };
}
export function groupFlagsByName(flags) {
    const map = new Map();
    for (const flag of flags) {
        const existing = map.get(flag.name);
        if (existing)
            existing.push(flag);
        else
            map.set(flag.name, [flag]);
    }
    return map;
}
export function formatFlagsText(result, top) {
    const lines = [
        `Feature flags: ${result.totalFlags} across ${result.totalFiles} files`,
        '',
    ];
    const entries = [...groupFlagsByName(result.flags).entries()];
    const sorted = entries.sort((a, b) => b[1].length - a[1].length);
    const limited = top !== undefined ? sorted.slice(0, top) : sorted;
    for (const [name, uses] of limited) {
        lines.push(`  ${name} (${uses.length} uses)`);
        for (const u of uses)
            lines.push(`    ${u.filePath}${u.line !== undefined ? `:${u.line}` : ''}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=flags.js.map