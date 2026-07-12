/**
 * Config File Manager
 * Shared JSON config file persistence with atomic writes and Zod validation
 */
/**
 * Default config values.
 *
 * IMPORTANT: never hand this object (or a shallow `{ ...DEFAULT_CONFIG }`
 * copy) out directly — its nested sections (`agents`, `swarm`, `memory`, ...)
 * would be shared-by-reference with every caller, so one caller mutating
 * `config.swarm.maxAgents` would silently corrupt this module-level constant
 * for the rest of the process. Always hand out `cloneDefaultConfig()`.
 */
declare const DEFAULT_CONFIG: Record<string, unknown>;
/** Exposed read-only for callers (e.g. config-adapter.ts) that need to
 * agree with this module's defaults instead of hardcoding their own. */
export { DEFAULT_CONFIG };
export declare class ConfigFileManager {
    private configPath;
    private config;
    /** Find config file in search paths starting from cwd */
    findConfig(cwd: string): string | null;
    /**
     * Load config from an EXACT file path (used by `--config <file>` / `-c`).
     * Unlike load()/findConfig(), this never falls back to directory search —
     * an explicitly-named config file that doesn't exist or fails to parse is
     * an error, not a silent fallback to defaults or an unrelated file in the
     * same directory.
     */
    loadExact(filePath: string): Record<string, unknown>;
    /** Load config from file, returns null if not found */
    load(cwd: string): Record<string, unknown> | null;
    /** Get the current config, loading if needed */
    getConfig(cwd: string): Record<string, unknown>;
    /** Get a nested config value by dot-separated key */
    get(cwd: string, key: string): unknown;
    /** Set a nested config value by dot-separated key.
     * Enforces top-level section allowlist (mirroring importFrom) and recursively
     * sanitises the value to strip prototype-pollution keys before persistence.
     *
     * Re-reads the file from disk inside the write to guard against the
     * read-modify-write credential-clobber race. Without the re-read, two
     * concurrent `monomind providers configure` calls would each see the
     * original config, mutate locally, and the second writer would silently
     * drop the first writer's API key.
     */
    set(cwd: string, key: string, value: unknown): void;
    /** Create a new config file with defaults */
    create(cwd: string, overrides?: Record<string, unknown>, force?: boolean): string;
    /** Reset config to defaults */
    reset(cwd: string): string;
    /** Export config to a specific path */
    exportTo(cwd: string, exportPath: string): void;
    /** Import config from a specific path */
    importFrom(cwd: string, importPath: string): void;
    /** Get the path to the current config file */
    getConfigPath(): string | null;
    /** Get default config */
    getDefaults(): Record<string, unknown>;
    /** Atomic write with restrictive 0o600 mode.
     * SECURITY: this config file may contain API keys (per `commands/providers.ts`).
     * Without explicit mode the file inherits the umask (typically 0o644 →
     * world-readable). Set 0o600 on tmp file BEFORE rename, then re-chmod after
     * rename in case the rename target had a more permissive mode.
     */
    private writeAtomic;
}
/** Parse a string value to the appropriate type */
export declare function parseConfigValue(value: string): unknown;
/** Singleton instance */
export declare const configManager: ConfigFileManager;
//# sourceMappingURL=config-file-manager.d.ts.map