// Augments the module graph with synthetic npm-package import edges for
// style-only packages (.css/.scss/.sass under node_modules).
const STYLE_EXTS = ['.css', '.scss', '.sass', '.less'];
const AT_IMPORT_RE = /@import\s+['"]([^'"]+)['"]/g;
/** Returns true if a path looks like a trackable external stylesheet. */
export function isTrackableExternalStylePath(path) {
    const norm = path.replace(/\\/g, '/');
    if (!norm.includes('node_modules/'))
        return false;
    return STYLE_EXTS.some(ext => norm.endsWith(ext));
}
/** Extract the npm package name from a node_modules path. */
export function packageNameFromPath(path) {
    const norm = path.replace(/\\/g, '/');
    const idx = norm.lastIndexOf('node_modules/');
    if (idx === -1)
        return '';
    const rest = norm.slice(idx + 'node_modules/'.length);
    const parts = rest.split('/');
    if (parts[0].startsWith('@') && parts.length >= 2)
        return `${parts[0]}/${parts[1]}`;
    return parts[0];
}
/** Scan @import statements in a stylesheet source, yielding resolved paths. */
export function scanStyleImports(source) {
    const results = [];
    let m;
    AT_IMPORT_RE.lastIndex = 0;
    while ((m = AT_IMPORT_RE.exec(source)) !== null)
        results.push(m[1]);
    return results;
}
/** Walk a list of resolved import paths and return synthetic external-style package edges. */
export function augmentExternalStylePackageUsage(importEdges, getSource) {
    const injectedEdges = [];
    const visited = new Set();
    let scannedFiles = 0;
    let skippedCycles = 0;
    function processStyleFile(importingFile, stylePath) {
        if (!isTrackableExternalStylePath(stylePath))
            return;
        const packageName = packageNameFromPath(stylePath);
        if (!packageName)
            return;
        injectedEdges.push({ importingFile, stylePath, packageName });
        if (getSource && !visited.has(stylePath)) {
            if (visited.size > 500) {
                skippedCycles++;
                return;
            }
            visited.add(stylePath);
            scannedFiles++;
            const src = getSource(stylePath);
            if (src) {
                for (const imp of scanStyleImports(src)) {
                    processStyleFile(stylePath, imp);
                }
            }
        }
    }
    for (const edge of importEdges) {
        processStyleFile(edge.importingFile, edge.resolvedPath);
    }
    return { injectedEdges, scannedFiles, skippedCycles };
}
//# sourceMappingURL=external-style-usage.js.map