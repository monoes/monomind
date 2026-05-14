/**
 * Pattern Store Module
 * Decentralized pattern marketplace using IPFS
 */
export type { PatternEntry, PatternAuthor, PatternCategory, PatternRegistry, SearchOptions, SearchResult, PublishOptions, PublishResult, DownloadOptions, DownloadResult, KnownRegistry, StoreConfig, RatingSubmission, } from './types.js';
export { REGISTRY_VERSION, BOOTSTRAP_REGISTRIES, DEFAULT_STORE_CONFIG, createRegistry, getDefaultCategories, addPatternToRegistry, removePatternFromRegistry, serializeRegistry, deserializeRegistry, signRegistry, verifyRegistrySignature, mergeRegistries, generatePatternId, } from './registry.js';
export type { DiscoveryResult, IPNSResolution } from './discovery.js';
export { PatternDiscovery, createDiscoveryService } from './discovery.js';
export { searchPatterns, getFeaturedPatterns, getTrendingPatterns, getNewestPatterns, getPatternById, getPatternByName, getPatternsByAuthor, getPatternsByCategory, getSimilarPatterns, getCategoryStats, getTagCloud, getSearchSuggestions, } from './search.js';
export type { DownloadProgressCallback } from './download.js';
export { PatternDownloader, batchDownload, createDownloader, } from './download.js';
export type { ContributionRequest } from './publish.js';
export { PatternPublisher, submitContribution, checkContributionStatus, createPublisher, quickPublish, } from './publish.js';
import type { SearchOptions, SearchResult, DownloadOptions, DownloadResult, PublishOptions, PublishResult, PatternEntry, PatternCategory, KnownRegistry, StoreConfig } from './types.js';
import type { CFPFormat } from '../types.js';
/**
 * Pattern Store - High-level API
 */
export declare class PatternStore {
    private discovery;
    private downloader;
    private publisher;
    private registry;
    private config;
    constructor(config?: Partial<StoreConfig>);
    /**
     * Initialize store and load registry
     */
    initialize(registryName?: string): Promise<boolean>;
    /**
     * Search patterns
     */
    search(options?: SearchOptions): SearchResult;
    /**
     * Get pattern by ID
     */
    getPattern(patternId: string): PatternEntry | undefined;
    /**
     * Download pattern
     */
    download(patternId: string, options?: DownloadOptions): Promise<DownloadResult>;
    /**
     * Publish pattern
     */
    publish(cfp: CFPFormat, options: PublishOptions): Promise<PublishResult>;
    /**
     * Get featured patterns
     */
    getFeatured(): PatternEntry[];
    /**
     * Get trending patterns
     */
    getTrending(): PatternEntry[];
    /**
     * Get newest patterns
     */
    getNewest(): PatternEntry[];
    /**
     * Get categories
     */
    getCategories(): PatternCategory[];
    /**
     * Get available registries
     */
    getRegistries(): KnownRegistry[];
    /**
     * Refresh registry
     */
    refresh(): Promise<boolean>;
    /**
     * Get store statistics
     */
    getStats(): {
        totalPatterns: number;
        totalDownloads: number;
        totalAuthors: number;
        categories: number;
    };
}
/**
 * Create pattern store instance
 */
export declare function createPatternStore(config?: Partial<StoreConfig>): PatternStore;
//# sourceMappingURL=index.d.ts.map