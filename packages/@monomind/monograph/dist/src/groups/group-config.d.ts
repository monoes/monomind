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
export interface GroupRepo {
    name: string;
    path: string;
}
export interface GroupConfig {
    name: string;
    repos: GroupRepo[];
}
/**
 * Parse a group.yaml config file.
 * Missing or invalid repo paths are warned and skipped.
 *
 * @param configPath - Absolute path to group.yaml
 * @returns Parsed GroupConfig
 */
export declare function parseGroupConfig(configPath: string): GroupConfig;
//# sourceMappingURL=group-config.d.ts.map