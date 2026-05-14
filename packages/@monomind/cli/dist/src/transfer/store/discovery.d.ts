/**
 * IPFS-Based Pattern Discovery
 * Secure discovery mechanism for finding patterns in decentralized environment
 */
import type { PatternRegistry, KnownRegistry, StoreConfig } from './types.js';
/**
 * Discovery result
 */
export interface DiscoveryResult {
    success: boolean;
    registry?: PatternRegistry;
    source: string;
    fromCache: boolean;
    cid?: string;
    error?: string;
}
/**
 * Resolved IPNS result
 */
export interface IPNSResolution {
    ipnsName: string;
    cid: string;
    resolvedAt: string;
    expiresAt: string;
}
/**
 * Pattern Store Discovery Service
 * Handles secure discovery of pattern registries via IPFS/IPNS
 */
export declare class PatternDiscovery {
    private config;
    private cache;
    private ipnsCache;
    constructor(config?: Partial<StoreConfig>);
    /**
     * Discover and load the pattern registry
     */
    discoverRegistry(registryName?: string): Promise<DiscoveryResult>;
    /**
     * Resolve IPNS name to CID via real IPFS gateway
     */
    resolveIPNS(ipnsName: string): Promise<IPNSResolution | null>;
    /**
     * Generate deterministic fallback CID for offline/demo mode
     */
    private generateFallbackCID;
    /**
     * Fetch registry from IPFS gateway
     */
    fetchRegistry(cid: string, gateway: string): Promise<PatternRegistry | null>;
    /**
     * Get built-in genesis registry (always available offline)
     */
    private getGenesisRegistry;
    /**
     * Verify registry signature.
     *
     * DEPRECATED: Do not use this method. It was a length-only stub. Real
     * verification must use `verifyRegistrySignature` from registry.ts which
     * performs Ed25519 verification. This stub is preserved only to avoid
     * breaking callers that imported it; it now always returns false.
     */
    verifyRegistry(_registry: PatternRegistry, _expectedPublicKey: string): boolean;
    /**
     * Get cached registry
     */
    getCachedRegistry(ipnsName: string): PatternRegistry | null;
    /**
     * Cache registry
     */
    private static readonly MAX_REGISTRY_CACHE;
    private static readonly MAX_IPNS_CACHE;
    cacheRegistry(ipnsName: string, registry: PatternRegistry): void;
    /**
     * Clear cache
     */
    clearCache(): void;
    /**
     * List all known registries
     */
    listRegistries(): KnownRegistry[];
    /**
     * Add a custom registry
     */
    addRegistry(registry: KnownRegistry): void;
}
/**
 * Create discovery service with default config
 */
export declare function createDiscoveryService(config?: Partial<StoreConfig>): PatternDiscovery;
//# sourceMappingURL=discovery.d.ts.map