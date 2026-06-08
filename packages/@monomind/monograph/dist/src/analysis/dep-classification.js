function isExternalPackage(tgtName, tgtFilePath) {
    // External if the file_path doesn't start with '/' or '.'
    // and doesn't look like a relative import
    if (!tgtFilePath) {
        // Fall back to name heuristic: starts with alpha, no path separators
        return /^[a-zA-Z@]/.test(tgtName) && !tgtName.includes('/') || /^@[a-zA-Z]/.test(tgtName);
    }
    return !tgtFilePath.startsWith('/') && !tgtFilePath.startsWith('.');
}
function extractPackageName(tgt) {
    // Handle scoped packages like @scope/name
    if (tgt.startsWith('@')) {
        const parts = tgt.split('/');
        return parts.slice(0, 2).join('/');
    }
    // Plain packages: take only the package name portion (before any '/')
    return tgt.split('/')[0];
}
export function classifyDependencies(db) {
    const rows = db.prepare(`
    SELECT e.relation, e.confidence, n_src.file_path as src, n_tgt.file_path as tgt, n_tgt.name as tgt_name, e.properties
    FROM edges e
    JOIN nodes n_src ON n_src.id = e.source_id
    JOIN nodes n_tgt ON n_tgt.id = e.target_id
    WHERE e.relation = 'IMPORTS'
  `).all();
    // Aggregate per external package
    const packageMap = new Map();
    for (const row of rows) {
        const tgtPath = row.tgt ?? '';
        const tgtName = row.tgt_name ?? '';
        if (!isExternalPackage(tgtName, tgtPath))
            continue;
        const packageName = extractPackageName(tgtName || tgtPath);
        if (!packageName)
            continue;
        // Check if type-only: parse properties JSON for isTypeOnly flag
        let isTypeOnly = false;
        if (row.properties) {
            try {
                const props = JSON.parse(row.properties);
                isTypeOnly = props['isTypeOnly'] === true;
            }
            catch {
                // fall through — infer from confidence
            }
        }
        // Note: INFERRED confidence is NOT a reliable signal for type-only imports —
        // re-export propagation and wildcard synthesis both emit INFERRED edges for real
        // runtime imports. Only trust the explicit isTypeOnly property.
        const existing = packageMap.get(packageName) ?? { valueImports: 0, typeImports: 0 };
        if (isTypeOnly) {
            existing.typeImports++;
        }
        else {
            existing.valueImports++;
        }
        packageMap.set(packageName, existing);
    }
    const packages = [];
    for (const [packageName, counts] of packageMap) {
        const usedAsValue = counts.valueImports > 0;
        const usedAsTypeOnly = counts.typeImports > 0;
        let recommendation;
        if (usedAsValue && usedAsTypeOnly) {
            recommendation = 'keep-as-dep';
        }
        else if (usedAsValue && !usedAsTypeOnly) {
            recommendation = 'keep-as-dep';
        }
        else if (!usedAsValue && usedAsTypeOnly) {
            recommendation = 'type-only';
        }
        else {
            recommendation = 'unused';
        }
        packages.push({
            packageName,
            usedAsValue,
            usedAsTypeOnly,
            recommendation,
            importCount: counts.valueImports + counts.typeImports,
            typeOnlyImportCount: counts.typeImports,
        });
    }
    // Sort: 'type-only' first, then 'unused', then rest
    const ORDER = { 'type-only': 0, 'unused': 1, 'move-to-devdeps': 2, 'keep-as-dep': 3 };
    packages.sort((a, b) => (ORDER[a.recommendation] ?? 3) - (ORDER[b.recommendation] ?? 3));
    const typeOnlyCount = packages.filter(p => p.recommendation === 'type-only').length;
    const mixedCount = packages.filter(p => p.usedAsValue && p.usedAsTypeOnly).length;
    const valueOnlyCount = packages.filter(p => p.usedAsValue && !p.usedAsTypeOnly).length;
    return {
        packages,
        typeOnlyCount,
        mixedCount,
        valueOnlyCount,
    };
}
//# sourceMappingURL=dep-classification.js.map