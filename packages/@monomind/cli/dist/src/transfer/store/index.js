/**
 * Pattern Store Module
 * Decentralized pattern marketplace using IPFS
 */
// Registry
export { REGISTRY_VERSION, BOOTSTRAP_REGISTRIES, DEFAULT_STORE_CONFIG, createRegistry, getDefaultCategories, addPatternToRegistry, removePatternFromRegistry, serializeRegistry, deserializeRegistry, signRegistry, verifyRegistrySignature, mergeRegistries, generatePatternId, } from './registry.js';
export { PatternDiscovery, createDiscoveryService } from './discovery.js';
// Search
export { searchPatterns, getFeaturedPatterns, getTrendingPatterns, getNewestPatterns, getPatternById, getPatternByName, getPatternsByAuthor, getPatternsByCategory, getSimilarPatterns, getCategoryStats, getTagCloud, getSearchSuggestions, } from './search.js';
export { PatternDownloader, batchDownload, createDownloader, } from './download.js';
export { PatternPublisher, submitContribution, checkContributionStatus, createPublisher, quickPublish, } from './publish.js';
import { searchPatterns as doSearchPatterns, getFeaturedPatterns as doGetFeaturedPatterns, getTrendingPatterns as doGetTrendingPatterns, getNewestPatterns as doGetNewestPatterns, } from './search.js';
/**
 * Pattern Store - High-level API
 */
export class PatternStore {
    discovery = null;
    downloader = null;
    publisher = null;
    registry = null;
    config;
    constructor(config = {}) {
        this.config = config;
    }
    /**
     * Initialize store and load registry
     */
    async initialize(registryName) {
        // Dynamic imports to avoid ESM/CommonJS issues
        const { PatternDiscovery } = await import('./discovery.js');
        const { PatternDownloader } = await import('./download.js');
        const { PatternPublisher } = await import('./publish.js');
        this.discovery = new PatternDiscovery(this.config);
        this.downloader = new PatternDownloader(this.config);
        this.publisher = new PatternPublisher(this.config);
        const result = await this.discovery.discoverRegistry(registryName);
        if (result.success && result.registry) {
            this.registry = result.registry;
            return true;
        }
        return false;
    }
    /**
     * Search patterns
     */
    search(options = {}) {
        if (!this.registry) {
            throw new Error('Store not initialized. Call initialize() first.');
        }
        return doSearchPatterns(this.registry, options);
    }
    /**
     * Get pattern by ID
     */
    getPattern(patternId) {
        if (!this.registry) {
            throw new Error('Store not initialized. Call initialize() first.');
        }
        return this.registry.patterns.find(p => p.id === patternId);
    }
    /**
     * Download pattern
     */
    async download(patternId, options = {}) {
        const pattern = this.getPattern(patternId);
        if (!pattern) {
            throw new Error(`Pattern not found: ${patternId}`);
        }
        if (!this.downloader) {
            throw new Error('Store not initialized. Call initialize() first.');
        }
        return this.downloader.downloadPattern(pattern, options);
    }
    /**
     * Publish pattern
     */
    async publish(cfp, options) {
        if (!this.publisher) {
            throw new Error('Store not initialized. Call initialize() first.');
        }
        return this.publisher.publishPattern(cfp, options);
    }
    /**
     * Get featured patterns
     */
    getFeatured() {
        if (!this.registry)
            return [];
        return doGetFeaturedPatterns(this.registry);
    }
    /**
     * Get trending patterns
     */
    getTrending() {
        if (!this.registry)
            return [];
        return doGetTrendingPatterns(this.registry);
    }
    /**
     * Get newest patterns
     */
    getNewest() {
        if (!this.registry)
            return [];
        return doGetNewestPatterns(this.registry);
    }
    /**
     * Get categories
     */
    getCategories() {
        if (!this.registry)
            return [];
        return this.registry.categories;
    }
    /**
     * Get available registries
     */
    getRegistries() {
        if (!this.discovery)
            return [];
        return this.discovery.listRegistries();
    }
    /**
     * Refresh registry
     */
    async refresh() {
        if (this.discovery) {
            this.discovery.clearCache();
        }
        return this.initialize();
    }
    /**
     * Get store statistics
     */
    getStats() {
        if (!this.registry) {
            return { totalPatterns: 0, totalDownloads: 0, totalAuthors: 0, categories: 0 };
        }
        return {
            totalPatterns: this.registry.totalPatterns,
            totalDownloads: this.registry.totalDownloads,
            totalAuthors: this.registry.totalAuthors,
            categories: this.registry.categories.length,
        };
    }
}
/**
 * Create pattern store instance
 */
export function createPatternStore(config) {
    return new PatternStore(config);
}
//# sourceMappingURL=index.js.map