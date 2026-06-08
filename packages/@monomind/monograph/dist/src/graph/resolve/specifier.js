import * as path from 'node:path';
import * as fs from 'node:fs';
import { extractPackageNameFromNodeModulesPath } from './path-info.js';
const STYLE_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl']);
const JS_TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
export function isStyleFile(filePath) {
    return STYLE_EXTS.has(path.extname(filePath).toLowerCase());
}
export function isJsTsExtension(filePath) {
    return JS_TS_EXTS.has(path.extname(filePath).toLowerCase());
}
export function isPlainCssFile(filePath) {
    return path.extname(filePath).toLowerCase() === '.css';
}
export function isBareStyleSubpath(specifier) {
    return !specifier.startsWith('.') && STYLE_EXTS.has(path.extname(specifier).toLowerCase());
}
export function pathAliasPatternMatches(pattern, specifier) {
    if (pattern.endsWith('*')) {
        return specifier.startsWith(pattern.slice(0, -1));
    }
    return specifier === pattern;
}
export function matchesNearestTsconfigPathAlias(root, fromFile, specifier) {
    const tsconfigPath = nearestTsconfigPath(root, fromFile);
    if (!tsconfigPath)
        return false;
    try {
        const raw = fs.readFileSync(tsconfigPath, 'utf8');
        const json = JSON.parse(stripJsonComments(raw));
        const paths = json?.compilerOptions?.paths ?? {};
        return Object.keys(paths).some(p => pathAliasPatternMatches(p, specifier));
    }
    catch {
        return false;
    }
}
export function nearestTsconfigPath(root, fromFile) {
    let dir = path.dirname(fromFile);
    while (dir.startsWith(root)) {
        const candidate = path.join(dir, 'tsconfig.json');
        if (fs.existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
export function resolveSpecifier(ctx, fromFile, specifier, fromStyle) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const resolved = resolveRelative(ctx, fromFile, specifier);
        if (resolved)
            return resolved;
        if (fromStyle) {
            const scss = tryScssPartialFallback(ctx, fromFile, specifier);
            if (scss)
                return scss;
        }
        return { kind: 'Unresolvable', specifier };
    }
    for (const [pattern, target] of ctx.pathAliases) {
        if (pathAliasPatternMatches(pattern, specifier)) {
            const mapped = specifier.replace(pattern.replace('*', ''), target.replace('*', ''));
            const r = resolveRelative(ctx, ctx.root, mapped);
            if (r)
                return r;
        }
    }
    const pkg = extractPackageNameFromNodeModulesPath(specifier) ?? specifier.split('/')[0];
    return { kind: 'NpmPackage', name: pkg };
}
function resolveRelative(ctx, fromFile, specifier) {
    const fromDir = path.dirname(fromFile);
    const base = path.resolve(fromDir, specifier);
    const directId = ctx.pathToId.get(base) ?? ctx.rawPathToId.get(base);
    if (directId !== undefined)
        return { kind: 'InternalModule', fileId: directId };
    const exts = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of exts) {
        const id = ctx.pathToId.get(base + ext) ?? ctx.rawPathToId.get(base + ext);
        if (id !== undefined)
            return { kind: 'InternalModule', fileId: id };
    }
    for (const ext of exts) {
        const id = ctx.pathToId.get(path.join(base, 'index' + ext));
        if (id !== undefined)
            return { kind: 'InternalModule', fileId: id };
    }
    return null;
}
function tryScssPartialFallback(ctx, fromFile, specifier) {
    const fromDir = path.dirname(fromFile);
    const base = path.resolve(fromDir, specifier);
    const dir = path.dirname(base);
    const name = '_' + path.basename(base);
    for (const ext of ['.scss', '.sass', '.css']) {
        const id = ctx.pathToId.get(path.join(dir, name + ext));
        if (id !== undefined)
            return { kind: 'InternalModule', fileId: id };
    }
    return null;
}
function stripJsonComments(s) {
    return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
//# sourceMappingURL=specifier.js.map