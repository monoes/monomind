import { extname, basename, relative } from 'node:path';
const SOURCE_EXTENSIONS = new Set([
    'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
    'vue', 'svelte', 'astro', 'mdx', 'css', 'scss',
]);
const CONFIG_FILENAMES = new Set([
    'package.json', '.fallowrc.json', '.fallowrc.jsonc',
    'fallow.toml', '.fallow.toml', 'tsconfig.json',
    'monograph.json', 'monograph.config.json', '.monographrc.json',
]);
export function isRelevantSource(filePath) {
    const ext = extname(filePath).replace('.', '');
    return SOURCE_EXTENSIONS.has(ext);
}
export function isRelevantConfig(filePath) {
    return CONFIG_FILENAMES.has(basename(filePath));
}
export function collectChangedPaths(rawPaths, root) {
    const seen = new Set();
    const result = [];
    for (const p of rawPaths) {
        if (!isRelevantSource(p) && !isRelevantConfig(p))
            continue;
        const rel = relative(root, p);
        if (!seen.has(rel)) {
            seen.add(rel);
            result.push(rel);
        }
    }
    return result;
}
export async function reloadConfigOrKeepPrevious(current, loader, onError) {
    try {
        return await loader();
    }
    catch (err) {
        onError?.(err);
        return current;
    }
}
export function debounce(fn, ms) {
    let timer = null;
    return ((...args) => {
        if (timer !== null)
            clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, ms);
    });
}
//# sourceMappingURL=watch-runner.js.map