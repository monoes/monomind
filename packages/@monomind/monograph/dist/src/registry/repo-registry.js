/**
 * Global Repo Registry
 *
 * Persists at ~/.monograph/registry.json and tracks all repos indexed by monograph.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
// ── Core functions ────────────────────────────────────────────────────────────
/**
 * Returns the path to the global registry file: ~/.monograph/registry.json
 */
export function getRegistryPath() {
    if (process.env.MONOGRAPH_REGISTRY_PATH)
        return process.env.MONOGRAPH_REGISTRY_PATH;
    return join(homedir(), '.monograph', 'registry.json');
}
/**
 * Reads the registry file. Returns { repos: [] } if the file does not exist.
 */
export function loadRegistry() {
    const registryPath = getRegistryPath();
    if (!existsSync(registryPath)) {
        return { repos: [] };
    }
    try {
        const raw = readFileSync(registryPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed &&
            typeof parsed === 'object' &&
            'repos' in parsed &&
            Array.isArray(parsed.repos)) {
            return parsed;
        }
        return { repos: [] };
    }
    catch {
        return { repos: [] };
    }
}
/**
 * Writes the registry atomically (write to temp file then rename).
 * Creates the parent directory if it does not exist.
 */
export function saveRegistry(registry) {
    const registryPath = getRegistryPath();
    mkdirSync(dirname(registryPath), { recursive: true });
    const tmpPath = registryPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
    // Rename is atomic on POSIX systems
    const { renameSync } = require('fs');
    renameSync(tmpPath, registryPath);
}
/**
 * Upsert a repo entry. If an entry for the same path already exists, it is
 * updated; otherwise a new entry is appended.
 *
 * @param repoPath - Absolute path to the repo
 * @param stats    - Optional node/edge counts to store alongside
 */
export function registerRepo(repoPath, stats) {
    const registry = loadRegistry();
    const now = new Date().toISOString();
    const existing = registry.repos.find((r) => r.path === repoPath);
    if (existing) {
        existing.lastIndexed = now;
        if (stats?.nodeCount !== undefined)
            existing.nodeCount = stats.nodeCount;
        if (stats?.edgeCount !== undefined)
            existing.edgeCount = stats.edgeCount;
    }
    else {
        const entry = {
            path: repoPath,
            name: basename(repoPath),
            lastIndexed: now,
            ...(stats?.nodeCount !== undefined ? { nodeCount: stats.nodeCount } : {}),
            ...(stats?.edgeCount !== undefined ? { edgeCount: stats.edgeCount } : {}),
        };
        registry.repos.push(entry);
    }
    saveRegistry(registry);
}
/**
 * Remove a repo from the registry by its absolute path.
 * No-ops silently if the path is not registered.
 */
export function unregisterRepo(repoPath) {
    const registry = loadRegistry();
    registry.repos = registry.repos.filter((r) => r.path !== repoPath);
    saveRegistry(registry);
}
/**
 * Return a sorted list of all registered repos (alphabetically by name, then path).
 */
export function listRepos() {
    const registry = loadRegistry();
    return [...registry.repos].sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name);
        return nameCmp !== 0 ? nameCmp : a.path.localeCompare(b.path);
    });
}
//# sourceMappingURL=repo-registry.js.map