export function matchGlob(pattern, filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    const escaped = pattern
        .replace(/\\/g, '/')
        .replace(/[.+^${}()|[\]]/g, '\\$&')
        .replace(/\*\*/g, '\x00')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\x00/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    if (regex.test(normalized))
        return true;
    const basename = normalized.split('/').pop() ?? normalized;
    const baseEscaped = pattern
        .replace(/\\/g, '/')
        .replace(/[.+^${}()|[\]]/g, '\\$&')
        .replace(/\*\*/g, '\x00')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\x00/g, '.*');
    if (!pattern.includes('/')) {
        return new RegExp(`^${baseEscaped}$`).test(basename);
    }
    return false;
}
function isInstalled(pluginName, installedPackages) {
    return installedPackages.some((pkg) => pkg === pluginName || pkg.startsWith(pluginName + '/'));
}
export function createPluginRegistry(plugins) {
    return {
        getConfigPatterns(installedPackages) {
            const seen = new Set();
            const result = [];
            for (const plugin of plugins) {
                if (!isInstalled(plugin.name, installedPackages))
                    continue;
                for (const pat of plugin.configPatterns) {
                    if (!seen.has(pat)) {
                        seen.add(pat);
                        result.push(pat);
                    }
                }
            }
            return result;
        },
        getToolingPackages(installedPackages) {
            const seen = new Set();
            const result = [];
            for (const plugin of plugins) {
                if (!isInstalled(plugin.name, installedPackages))
                    continue;
                for (const pkg of plugin.toolingPackages ?? []) {
                    if (!seen.has(pkg)) {
                        seen.add(pkg);
                        result.push(pkg);
                    }
                }
            }
            return result;
        },
        getEntryPatterns(installedPackages) {
            const seen = new Set();
            const result = [];
            for (const plugin of plugins) {
                if (!isInstalled(plugin.name, installedPackages))
                    continue;
                for (const pat of plugin.entryPatterns ?? []) {
                    if (!seen.has(pat)) {
                        seen.add(pat);
                        result.push(pat);
                    }
                }
            }
            return result;
        },
        isAlwaysUsed(filePath, installedPackages) {
            const patterns = this.getConfigPatterns(installedPackages);
            return patterns.some((pat) => matchGlob(pat, filePath));
        },
    };
}
//# sourceMappingURL=registry.js.map