import { isEntryPoint, ModuleNodeFlags } from '../graph/node-types.js';
function matchesIgnorePath(filePath, patterns) {
    for (const pattern of patterns) {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        if (new RegExp(escaped).test(filePath))
            return true;
    }
    return false;
}
function buildReferencedNamesMap(modules) {
    const referencedByFile = new Map();
    for (const mod of modules) {
        for (const ref of mod.references) {
            const target = ref.fromFile;
            if (!referencedByFile.has(target)) {
                referencedByFile.set(target, new Set());
            }
            referencedByFile.get(target).add(ref.name);
        }
    }
    return referencedByFile;
}
function buildReExportedNamesMap(modules) {
    const reExportedByFile = new Map();
    for (const mod of modules) {
        for (const edge of mod.reExports) {
            if (!reExportedByFile.has(edge.fromFile)) {
                reExportedByFile.set(edge.fromFile, new Set());
            }
            if (edge.symbol) {
                reExportedByFile.get(edge.fromFile).add(edge.symbol);
            }
        }
    }
    return reExportedByFile;
}
function isModuleEntryPoint(mod, opts) {
    if (opts.isEntryPoint && opts.isEntryPoint(mod.filePath))
        return true;
    return isEntryPoint(mod);
}
function hasCjsExports(mod) {
    return (mod.flags & ModuleNodeFlags.CJS_EXPORTS) !== 0;
}
export function findUnusedExports(modules, opts = {}) {
    const { ignorePaths = [], includeTypeOnlyExports = true, } = opts;
    const referencedByFile = buildReferencedNamesMap(modules);
    const reExportedNames = buildReExportedNamesMap(modules);
    const reachableFileIds = new Set(modules
        .filter(m => (m.flags & ModuleNodeFlags.REACHABLE) !== 0)
        .map(m => m.filePath));
    const results = [];
    for (const mod of modules) {
        if (isModuleEntryPoint(mod, opts))
            continue;
        if (ignorePaths.length > 0 && matchesIgnorePath(mod.filePath, ignorePaths))
            continue;
        if (hasCjsExports(mod) && mod.exports.length === 0)
            continue;
        const reachable = reachableFileIds.has(mod.filePath);
        const referenced = referencedByFile.get(mod.filePath) ?? new Set();
        const reExportedHere = reExportedNames.get(mod.filePath) ?? new Set();
        for (const exp of mod.exports) {
            if (!includeTypeOnlyExports && exp.isType)
                continue;
            const isReferenced = referenced.has(exp.name);
            if (isReferenced)
                continue;
            const isReExport = exp.isReExport || reExportedHere.has(exp.name);
            if (!reachable && !isReExport)
                continue;
            const line = exp.line ?? 1;
            results.push({
                filePath: mod.filePath,
                line,
                col: 0,
                exportName: exp.name,
                spanStart: 0,
                isReExport,
                isTypeOnly: exp.isType,
            });
        }
    }
    return results;
}
export function findDuplicateExports(modules) {
    const byName = new Map();
    for (const mod of modules) {
        for (const exp of mod.exports) {
            if (!byName.has(exp.name)) {
                byName.set(exp.name, []);
            }
            byName.get(exp.name).push({
                filePath: mod.filePath,
                line: exp.line ?? 1,
                col: 0,
            });
        }
    }
    const results = [];
    for (const [name, files] of byName) {
        if (files.length > 1) {
            results.push({ name, files });
        }
    }
    return results;
}
//# sourceMappingURL=unused-exports.js.map