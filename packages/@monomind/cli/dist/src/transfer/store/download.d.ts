/**
 * Pattern Download Service
 * Secure download and verification of patterns from IPFS
 */
import type { PatternEntry, DownloadOptions, DownloadResult, StoreConfig } from './types.js';
/**
 * Download progress callback
 */
export type DownloadProgressCallback = (progress: {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
}) => void;
export declare class PatternDownloader {
    private config;
    private downloadCache;
    constructor(config?: Partial<StoreConfig>);
    /**
     * Download a pattern from IPFS
     */
    downloadPattern(pattern: PatternEntry, options?: DownloadOptions, onProgress?: DownloadProgressCallback): Promise<DownloadResult>;
    /**
     * Fetch content from IPFS gateway or GCS
     */
    private fetchFromIPFS;
    /**
     * Fetch content from Google Cloud Storage
     */
    private fetchFromGCS;
    /**
     * Verify content checksum
     */
    private verifyChecksum;
    /**
     * Verify content signature using real Ed25519.
     *
     * CRITICAL FIX: Previously this used HMAC-SHA256 keyed with the *public* key —
     * which is a no-op for security since the key is, by definition, public.
     * Anyone reading the registry could recompute a valid "signature".
     * The fallback at the bottom returned true for length>20, which made the
     * function effectively a length check rather than a signature check.
     * Now uses @noble/ed25519 verifyAsync, the same library used in publish.ts,
     * and fails closed on any error.
     */
    private verifySignature;
    /**
     * Resolve output path for pattern.
     *
     * CRITICAL: pattern.name and pattern.version come from registry data fetched
     * over the network. Without strict validation, an attacker who controls the
     * registry response can write to arbitrary paths (e.g. ~/.claude/helpers/
     * hook-handler.cjs) via traversal sequences in pattern.name.
     */
    private resolveOutputPath;
    /**
     * Import downloaded pattern
     */
    private importPattern;
    /**
     * Clear download cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        count: number;
        totalSize: number;
    };
}
/**
 * Batch download multiple patterns
 */
export declare function batchDownload(patterns: PatternEntry[], options?: DownloadOptions, config?: Partial<StoreConfig>): Promise<DownloadResult[]>;
/**
 * Create downloader with default config
 */
export declare function createDownloader(config?: Partial<StoreConfig>): PatternDownloader;
//# sourceMappingURL=download.d.ts.map