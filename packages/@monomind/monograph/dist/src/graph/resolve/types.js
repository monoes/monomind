export const OUTPUT_DIRS = ['dist', 'build', 'out', 'esm', 'cjs', '.next', '.nuxt', '.svelte-kit'];
export const SOURCE_EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];
export const RN_PLATFORM_PREFIXES = ['.web', '.ios', '.android', '.native'];
export function getOrBuildCanonicalMap(fallback) {
    if (!fallback.map) {
        fallback.map = new Map(fallback.files
            .filter(f => f.canonicalPath)
            .map(f => [f.canonicalPath, f.fileId]));
    }
    return fallback.map;
}
export function makeResolvedModule(fileId, path) {
    return {
        fileId,
        path,
        resolvedImports: [],
        resolvedReExports: [],
        resolvedDynamicImports: [],
        resolvedDynamicPatterns: [],
        unusedImportBindings: new Set(),
        typeReferencedImportBindings: [],
        valueReferencedImportBindings: [],
        hasCjsExports: false,
    };
}
//# sourceMappingURL=types.js.map