// Config resolution system: merges base configs via extends chains.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export function parseExtendsValue(raw) {
    if (raw.startsWith('npm:'))
        return { kind: 'npm', packageName: raw.slice(4) };
    if (raw.startsWith('https://') || raw.startsWith('http://'))
        return { kind: 'url', url: raw };
    return { kind: 'file', path: raw };
}
export function resolveFileExtends(configPath, extendsPath) {
    const dir = dirname(resolve(configPath));
    const abs = resolve(dir, extendsPath);
    if (!existsSync(abs))
        return null;
    try {
        return JSON.parse(readFileSync(abs, 'utf8'));
    }
    catch {
        return null;
    }
}
export function resolveNpmExtends(root, packageName) {
    const candidates = ['monograph.json', 'monograph.config.json', '.monographrc.json'];
    let dir = root;
    while (true) {
        const pkgDir = resolve(dir, 'node_modules', packageName);
        if (existsSync(pkgDir)) {
            for (const name of candidates) {
                const path = resolve(pkgDir, name);
                if (existsSync(path)) {
                    try {
                        return JSON.parse(readFileSync(path, 'utf8'));
                    }
                    catch {
                        return null;
                    }
                }
            }
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
export function mergeConfigs(base, override) {
    const result = { ...base };
    for (const [key, val] of Object.entries(override)) {
        if (key === 'extends')
            continue;
        if (Array.isArray(val) && Array.isArray(result[key])) {
            result[key] = [...result[key], ...val];
        }
        else if (typeof val === 'object' && val !== null && typeof result[key] === 'object' && result[key] !== null) {
            result[key] = mergeConfigs(result[key], val);
        }
        else {
            result[key] = val;
        }
    }
    return result;
}
export async function resolveConfigExtends(config, configPath, root, depth = 0) {
    if (depth > 10)
        return config;
    const extendsVal = config['extends'];
    if (!extendsVal)
        return config;
    const sources = Array.isArray(extendsVal) ? extendsVal : [extendsVal];
    let resolved = { ...config };
    delete resolved['extends'];
    for (const src of sources) {
        const parsed = parseExtendsValue(src);
        let base = null;
        if (parsed.kind === 'file')
            base = resolveFileExtends(configPath, parsed.path);
        else if (parsed.kind === 'npm')
            base = resolveNpmExtends(root, parsed.packageName);
        if (base) {
            const resolvedBase = await resolveConfigExtends(base, configPath, root, depth + 1);
            resolved = mergeConfigs(resolvedBase, resolved);
        }
    }
    return resolved;
}
//# sourceMappingURL=resolution.js.map