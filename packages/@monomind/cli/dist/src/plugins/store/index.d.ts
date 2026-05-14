/**
 * Plugin Store Module
 * Decentralized plugin marketplace using IPFS
 *
 * Provides:
 * - Plugin discovery via IPNS
 * - Search with filters
 * - Download with verification
 * - Publish with signing
 */
export * from './types.js';
export { PluginDiscoveryService, createPluginDiscoveryService, DEFAULT_PLUGIN_STORE_CONFIG, type PluginDiscoveryResult, } from './discovery.js';
export { searchPlugins, getPluginSearchSuggestions, getPluginTagCloud, getPluginCategoryStats, findSimilarPlugins, getFeaturedPlugins, getTrendingPlugins, getNewestPlugins, getOfficialPlugins, getPluginsByPermission, } from './search.js';
import type { PluginRegistry, PluginEntry, PluginSearchOptions, PluginSearchResult, PluginStoreConfig } from './types.js';
import { PluginDiscoveryService } from './discovery.js';
/**
 * High-level Plugin Store API
 */
export declare class PluginStore {
    private discovery;
    private registry;
    constructor(config?: Partial<PluginStoreConfig>);
    /**
     * Initialize the store by discovering the registry
     */
    initialize(registryName?: string): Promise<boolean>;
    /**
     * Check if store is initialized
     */
    isInitialized(): boolean;
    /**
     * Get the current registry
     */
    getRegistry(): PluginRegistry | null;
    /**
     * Search plugins
     */
    search(options?: PluginSearchOptions): PluginSearchResult;
    /**
     * Get a plugin by ID
     */
    getPlugin(pluginId: string): PluginEntry | undefined;
    /**
     * Get similar plugins
     */
    getSimilarPlugins(pluginId: string, limit?: number): PluginEntry[];
    /**
     * Get featured plugins
     */
    getFeatured(): PluginEntry[];
    /**
     * Get official plugins
     */
    getOfficial(): PluginEntry[];
    /**
     * Get trending plugins
     */
    getTrending(): PluginEntry[];
    /**
     * Get newest plugins
     */
    getNewest(): PluginEntry[];
    /**
     * Get discovery service
     */
    getDiscovery(): PluginDiscoveryService;
    /**
     * Refresh registry
     */
    refresh(registryName?: string): Promise<boolean>;
}
/**
 * Create a new plugin store instance
 */
export declare function createPluginStore(config?: Partial<PluginStoreConfig>): PluginStore;
//# sourceMappingURL=index.d.ts.map