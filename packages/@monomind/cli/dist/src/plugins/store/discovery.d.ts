/**
 * Plugin Discovery Service
 * Discovers plugin registries via IPNS and fetches from IPFS
 * Parallel implementation to pattern store for plugins
 */
import type { PluginRegistry, KnownPluginRegistry, PluginStoreConfig } from './types.js';
/**
 * Default plugin store configuration
 */
/**
 * Live IPFS Registry CID - Updated 2026-01-24
 * This is the current pinned registry on Pinata
 */
export declare const LIVE_REGISTRY_CID = "QmXbfEAaR7D2Ujm4GAkbwcGZQMHqAMpwDoje4583uNP834";
/**
 * Pre-trained Model Registry CID - Updated 2026-01-24
 * Contains 8 pre-trained learning pattern models with 40 patterns
 * Trained on 110,600+ examples with 90.5% average accuracy
 */
export declare const MODEL_REGISTRY_CID = "QmNr1yYMKi7YBaL8JSztQyuB5ZUaTdRMLxJC1pBpGbjsTc";
export declare const DEFAULT_PLUGIN_STORE_CONFIG: PluginStoreConfig;
/**
 * Discovery result
 */
export interface PluginDiscoveryResult {
    success: boolean;
    registry?: PluginRegistry;
    cid?: string;
    source?: string;
    fromCache?: boolean;
    error?: string;
}
/**
 * Plugin Discovery Service
 */
export declare class PluginDiscoveryService {
    private config;
    private cache;
    constructor(config?: Partial<PluginStoreConfig>);
    /**
     * Discover plugin registry via IPNS
     */
    discoverRegistry(registryName?: string): Promise<PluginDiscoveryResult>;
    /**
     * Create demo plugin registry with real npm stats
     */
    private createDemoRegistryAsync;
    /**
     * Get demo plugins
     */
    private getDemoPlugins;
    /**
     * Get demo plugins with real npm stats
     */
    private getDemoPluginsWithStats;
    /**
     * Verify registry signature using real Ed25519
     */
    private verifyRegistrySignature;
    /**
     * List available registries
     */
    listRegistries(): KnownPluginRegistry[];
    /**
     * Add a new registry
     */
    addRegistry(registry: KnownPluginRegistry): void;
    /**
     * Remove a registry
     */
    removeRegistry(name: string): boolean;
    /**
     * Clear cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        entries: number;
        registries: string[];
    };
}
/**
 * Create discovery service with default config
 */
export declare function createPluginDiscoveryService(config?: Partial<PluginStoreConfig>): PluginDiscoveryService;
//# sourceMappingURL=discovery.d.ts.map