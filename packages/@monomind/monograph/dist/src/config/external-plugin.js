// Loads and discovers external monograph plugins from node_modules.
// External plugins declare entry points and used exports to suppress false positives.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export const PLUGIN_MANIFEST_KEY = 'monograph-plugin';
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
export function discoverExternalPlugins(root) {
    const nmDir = join(root, 'node_modules');
    if (!existsSync(nmDir))
        return [];
    const plugins = [];
    try {
        const entries = readdirSync(nmDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const pkgPath = join(nmDir, entry.name, 'package.json');
            const pkg = readJson(pkgPath);
            if (!pkg)
                continue;
            const manifest = pkg[PLUGIN_MANIFEST_KEY];
            if (!manifest || typeof manifest !== 'object')
                continue;
            const m = manifest;
            plugins.push({
                name: pkg['name'] ?? entry.name,
                version: pkg['version'] ?? '0.0.0',
                entryPoints: m['entryPoints'] ?? [],
                usedExports: m['usedExports'] ?? [],
                suppressPatterns: m['suppressPatterns'] ?? [],
            });
        }
    }
    catch { /* skip */ }
    return plugins;
}
export function mergePluginSuppressPatterns(plugins) {
    const seen = new Set();
    const result = [];
    for (const p of plugins) {
        for (const pat of p.suppressPatterns) {
            if (!seen.has(pat)) {
                seen.add(pat);
                result.push(pat);
            }
        }
    }
    return result;
}
//# sourceMappingURL=external-plugin.js.map