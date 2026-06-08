/**
 * Group Config
 *
 * Parses a group.yaml file that describes a multi-repo group for cross-repo analysis.
 *
 * Format:
 *   name: my-org
 *   repos:
 *     backend: /path/to/backend
 *     frontend: /path/to/frontend
 */
import { readFileSync, existsSync } from 'fs';
/**
 * Simple YAML key-value parser for the group.yaml format.
 * Handles top-level scalar keys and one level of indented key: value pairs.
 * Does not require any external yaml library.
 */
function parseSimpleYaml(content) {
    const lines = content.split('\n');
    const result = {};
    let currentKey = null;
    let currentMap = null;
    for (const raw of lines) {
        // Skip comments and blank lines
        const line = raw.trimEnd();
        if (!line || line.trimStart().startsWith('#'))
            continue;
        const indent = line.length - line.trimStart().length;
        if (indent === 0) {
            // Top-level key
            const match = line.match(/^(\w[\w-]*):\s*(.*)?$/);
            if (!match)
                continue;
            const key = match[1];
            const val = (match[2] ?? '').trim();
            if (val === '' || val === null) {
                // This key will have children
                currentMap = {};
                currentKey = key;
                result[key] = currentMap;
            }
            else {
                result[key] = val;
                currentMap = null;
                currentKey = null;
            }
        }
        else if (indent > 0 && currentMap !== null && currentKey !== null) {
            // Indented child key-value
            const trimmed = line.trimStart();
            const match = trimmed.match(/^(\w[\w-]*):\s*(.*)?$/);
            if (!match)
                continue;
            currentMap[match[1]] = (match[2] ?? '').trim();
        }
    }
    return result;
}
/**
 * Parse a group.yaml config file.
 * Missing or invalid repo paths are warned and skipped.
 *
 * @param configPath - Absolute path to group.yaml
 * @returns Parsed GroupConfig
 */
export function parseGroupConfig(configPath) {
    if (!existsSync(configPath)) {
        throw new Error(`Group config not found: ${configPath}`);
    }
    const content = readFileSync(configPath, 'utf8');
    const raw = parseSimpleYaml(content);
    const name = raw['name'] ?? 'unnamed-group';
    const reposRaw = raw['repos'];
    const repos = [];
    if (reposRaw && typeof reposRaw === 'object' && !Array.isArray(reposRaw)) {
        for (const [repoName, repoPath] of Object.entries(reposRaw)) {
            if (typeof repoPath !== 'string' || !repoPath) {
                console.warn(`[group-config] Skipping repo "${repoName}": missing path`);
                continue;
            }
            if (!existsSync(repoPath)) {
                console.warn(`[group-config] Skipping repo "${repoName}": path does not exist: ${repoPath}`);
                continue;
            }
            repos.push({ name: repoName, path: repoPath });
        }
    }
    return { name, repos };
}
//# sourceMappingURL=group-config.js.map