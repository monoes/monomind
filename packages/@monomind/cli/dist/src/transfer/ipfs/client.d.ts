/**
 * IPFS Client Module
 * Low-level IPFS operations for discovery and fetching
 *
 * Supports multiple gateways with automatic fallback:
 * - Pinata (recommended for pinned content)
 * - Cloudflare IPFS
 * - Protocol Labs ipfs.io
 * - dweb.link (LibP2P)
 */
/**
 * Available IPFS gateways in priority order
 */
export declare const IPFS_GATEWAYS: string[];
/**
 * IPNS resolvers
 */
export declare const IPNS_RESOLVERS: string[];
/**
 * Gateway configuration
 */
export interface GatewayConfig {
    url: string;
    timeout?: number;
    headers?: Record<string, string>;
    priority?: number;
}
/**
 * Fetch result with metadata
 */
export interface FetchResult<T> {
    data: T;
    gateway: string;
    cid: string;
    cached: boolean;
    latencyMs: number;
}
/**
 * Resolve IPNS name to CID with fallback across multiple gateways
 *
 * @param ipnsName - IPNS key or DNSLink domain
 * @param preferredGateway - Optional preferred gateway to try first
 * @returns CID string or null if resolution fails
 */
export declare function resolveIPNS(ipnsName: string, preferredGateway?: string): Promise<string | null>;
/**
 * Fetch content from IPFS by CID with fallback across multiple gateways
 *
 * @param cid - Content Identifier
 * @param preferredGateway - Optional preferred gateway to try first
 * @returns Parsed JSON content or null if fetch fails
 */
export declare function fetchFromIPFS<T>(cid: string, preferredGateway?: string): Promise<T | null>;
/**
 * Fetch with full result metadata
 */
export declare function fetchFromIPFSWithMetadata<T>(cid: string, preferredGateway?: string): Promise<FetchResult<T> | null>;
/**
 * Check if CID is pinned/available on a gateway
 */
export declare function isPinned(cid: string, gateway?: string): Promise<boolean>;
/**
 * Check availability across multiple gateways
 */
export declare function checkAvailability(cid: string): Promise<{
    available: boolean;
    gateways: Array<{
        url: string;
        available: boolean;
        latencyMs: number;
    }>;
}>;
/**
 * Get IPFS gateway URL for a CID
 */
export declare function getGatewayUrl(cid: string, gateway?: string): string;
/**
 * Get multiple gateway URLs for redundancy
 */
export declare function getGatewayUrls(cid: string): string[];
/**
 * Validate CID format (CIDv0 and CIDv1)
 */
export declare function isValidCID(cid: string): boolean;
/**
 * Validate IPNS name format
 */
export declare function isValidIPNS(ipnsName: string): boolean;
/**
 * Generate content hash for verification
 */
export declare function hashContent(content: Buffer | string): string;
/**
 * Verify Ed25519 signature (async import to avoid bundling issues)
 */
export declare function verifyEd25519Signature(message: string, signature: string, publicKey: string): Promise<boolean>;
/**
 * Parse CID to extract metadata
 */
export declare function parseCID(cid: string): {
    version: 0 | 1;
    codec: string;
    hash: string;
} | null;
/**
 * Format bytes to human readable
 */
export declare function formatBytes(bytes: number): string;
//# sourceMappingURL=client.d.ts.map