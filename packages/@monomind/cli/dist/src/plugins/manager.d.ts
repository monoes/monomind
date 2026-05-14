/**
 * Plugin Manager
 * Handles actual plugin installation, persistence, and lifecycle
 * Bridges discovery service with file system persistence
 */
export interface InstalledPlugin {
    name: string;
    version: string;
    installedAt: string;
    enabled: boolean;
    source: 'npm' | 'local' | 'ipfs';
    path?: string;
    commands?: string[];
    hooks?: string[];
    config?: Record<string, unknown>;
}
export interface InstalledPluginsManifest {
    version: '1.0.0';
    lastUpdated: string;
    plugins: Record<string, InstalledPlugin>;
}
export interface PluginManagerConfig {
    pluginsDir: string;
    manifestPath: string;
}
/**
 * Manages plugin installation, persistence, and lifecycle.
 *
 * Unlike the simulated version, this actually:
 * - Persists plugins to disk
 * - Downloads from npm
 * - Tracks enabled/disabled state
 * - Loads plugin modules
 */
export declare class PluginManager {
    private config;
    private manifest;
    constructor(baseDir?: string);
    /**
     * Initialize the plugin manager, creating directories and loading manifest
     */
    initialize(): Promise<void>;
    private ensureDirectory;
    private loadManifest;
    private saveManifest;
    /**
     * Install a plugin from npm
     */
    installFromNpm(packageName: string, version?: string): Promise<{
        success: boolean;
        error?: string;
        plugin?: InstalledPlugin;
    }>;
    /**
     * Install a plugin from a local path
     */
    installFromLocal(sourcePath: string): Promise<{
        success: boolean;
        error?: string;
        plugin?: InstalledPlugin;
    }>;
    /**
     * Uninstall a plugin
     */
    uninstall(packageName: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Enable a plugin
     */
    enable(packageName: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Disable a plugin
     */
    disable(packageName: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Toggle a plugin's enabled state
     */
    toggle(packageName: string): Promise<{
        success: boolean;
        enabled?: boolean;
        error?: string;
    }>;
    /**
     * Get all installed plugins
     */
    getInstalled(): Promise<InstalledPlugin[]>;
    /**
     * Get enabled plugins
     */
    getEnabled(): Promise<InstalledPlugin[]>;
    /**
     * Check if a plugin is installed
     */
    isInstalled(packageName: string): Promise<boolean>;
    /**
     * Get a specific installed plugin
     */
    getPlugin(packageName: string): Promise<InstalledPlugin | undefined>;
    /**
     * Upgrade a plugin to a new version
     */
    upgrade(packageName: string, version?: string): Promise<{
        success: boolean;
        error?: string;
        plugin?: InstalledPlugin;
    }>;
    /**
     * Update plugin config
     */
    setConfig(packageName: string, config: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Get plugins directory path
     */
    getPluginsDir(): string;
    /**
     * Get manifest path
     */
    getManifestPath(): string;
}
export declare function getPluginManager(baseDir?: string): PluginManager;
export declare function resetPluginManager(): void;
//# sourceMappingURL=manager.d.ts.map