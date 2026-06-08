export function findUnusedDependencies(usedPackages, declaredDeps, config = {}) {
    const results = [];
    const categories = [
        { key: "dependencies" },
        { key: "devDependencies", skip: config.skipDev },
        { key: "optionalDependencies", skip: config.skipOptional },
        { key: "peerDependencies", skip: config.skipPeer },
    ];
    for (const { key, skip } of categories) {
        if (skip)
            continue;
        const deps = declaredDeps[key] ?? [];
        for (const dep of deps) {
            if (!usedPackages.has(dep)) {
                results.push({
                    name: dep,
                    category: key,
                    reason: `declared in ${key} but never imported`,
                });
            }
        }
    }
    return results;
}
export function findUnresolvedImports(importSpecifiers, resolvedPackages) {
    return importSpecifiers.filter(({ specifier }) => !resolvedPackages.has(specifier));
}
export function findTypeOnlyDependencies(usedInProduction, usedInTypes, deps) {
    return deps.filter((dep) => !usedInProduction.has(dep) && usedInTypes.has(dep));
}
//# sourceMappingURL=unused-deps.js.map