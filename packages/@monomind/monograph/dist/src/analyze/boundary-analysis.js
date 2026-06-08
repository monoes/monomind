import { classifyZone, isImportAllowed } from '../config/boundary-config.js';
import { ModuleNodeFlags } from '../graph/node-types.js';
function isReachableOrEntry(mod) {
    return ((mod.flags & ModuleNodeFlags.REACHABLE) !== 0 ||
        (mod.flags & ModuleNodeFlags.ENTRY_POINT) !== 0);
}
function hasRules(config, zoneName) {
    return config.rules.some(r => r.from.name === zoneName);
}
export function findBoundaryViolations(modules, config) {
    if (config.zones.length === 0)
        return [];
    const zoneCache = new Map();
    const classify = (filePath) => {
        if (zoneCache.has(filePath))
            return zoneCache.get(filePath);
        const zone = classifyZone(config, filePath);
        zoneCache.set(filePath, zone);
        return zone;
    };
    const filePathByPath = new Map(modules.map(m => [m.filePath, m]));
    const violations = [];
    for (const mod of modules) {
        if (!isReachableOrEntry(mod))
            continue;
        const fromZone = classify(mod.filePath);
        if (!fromZone)
            continue;
        if (!hasRules(config, fromZone))
            continue;
        for (const edge of mod.reExports) {
            const toPath = edge.toFile;
            const toZone = classify(toPath);
            if (!toZone)
                continue;
            if (fromZone === toZone)
                continue;
            if (!isImportAllowed(config, mod.filePath, toPath)) {
                violations.push({
                    fromPath: mod.filePath,
                    toPath,
                    fromZone,
                    toZone,
                    importSpecifier: toPath,
                    line: 1,
                    col: 0,
                });
            }
        }
    }
    return violations;
}
export function analyzeBoundaries(modules, config) {
    if (config.zones.length === 0) {
        return { violations: [], checkedEdges: 0, uncheckedFiles: 0 };
    }
    const zoneCache = new Map();
    const classify = (filePath) => {
        if (zoneCache.has(filePath))
            return zoneCache.get(filePath);
        const zone = classifyZone(config, filePath);
        zoneCache.set(filePath, zone);
        return zone;
    };
    const violations = [];
    let checkedEdges = 0;
    let uncheckedFiles = 0;
    for (const mod of modules) {
        if (!isReachableOrEntry(mod))
            continue;
        const fromZone = classify(mod.filePath);
        if (!fromZone) {
            uncheckedFiles++;
            continue;
        }
        if (!hasRules(config, fromZone))
            continue;
        for (const edge of mod.reExports) {
            const toPath = edge.toFile;
            checkedEdges++;
            const toZone = classify(toPath);
            if (!toZone)
                continue;
            if (fromZone === toZone)
                continue;
            if (!isImportAllowed(config, mod.filePath, toPath)) {
                violations.push({
                    fromPath: mod.filePath,
                    toPath,
                    fromZone,
                    toZone,
                    importSpecifier: toPath,
                    line: 1,
                    col: 0,
                });
            }
        }
    }
    return { violations, checkedEdges, uncheckedFiles };
}
//# sourceMappingURL=boundary-analysis.js.map