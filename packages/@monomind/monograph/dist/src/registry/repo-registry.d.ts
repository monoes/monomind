/**
 * Global Repo Registry
 *
 * Persists at ~/.monograph/registry.json and tracks all repos indexed by monograph.
 */
export interface RepoRegistryEntry {
    path: string;
    name: string;
    lastIndexed?: string;
    nodeCount?: number;
    edgeCount?: number;
}
export interface RepoRegistry {
    repos: RepoRegistryEntry[];
}
/**
 * Returns the path to the global registry file: ~/.monograph/registry.json
 */
export declare function getRegistryPath(): string;
/**
 * Reads the registry file. Returns { repos: [] } if the file does not exist.
 */
export declare function loadRegistry(): RepoRegistry;
/**
 * Writes the registry atomically (write to temp file then rename).
 * Creates the parent directory if it does not exist.
 */
export declare function saveRegistry(registry: RepoRegistry): void;
/**
 * Upsert a repo entry. If an entry for the same path already exists, it is
 * updated; otherwise a new entry is appended.
 *
 * @param repoPath - Absolute path to the repo
 * @param stats    - Optional node/edge counts to store alongside
 */
export declare function registerRepo(repoPath: string, stats?: {
    nodeCount?: number;
    edgeCount?: number;
}): void;
/**
 * Remove a repo from the registry by its absolute path.
 * No-ops silently if the path is not registered.
 */
export declare function unregisterRepo(repoPath: string): void;
/**
 * Return a sorted list of all registered repos (alphabetically by name, then path).
 */
export declare function listRepos(): RepoRegistryEntry[];
//# sourceMappingURL=repo-registry.d.ts.map