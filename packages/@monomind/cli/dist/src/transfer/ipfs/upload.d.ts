/**
 * IPFS Upload Module
 * Real upload support via web3.storage, Pinata, or local IPFS
 *
 * @module @monomind/cli/transfer/ipfs/upload
 * @version 3.0.0
 */
import type { PinningService } from '../types.js';
/**
 * IPFS upload options
 */
export interface IPFSUploadOptions {
    pin?: boolean;
    pinningService?: PinningService;
    gateway?: string;
    name?: string;
    wrapWithDirectory?: boolean;
    apiKey?: string;
    apiSecret?: string;
}
/**
 * IPFS upload result
 */
export interface IPFSUploadResult {
    cid: string;
    size: number;
    gateway: string;
    pinnedAt?: string;
    url: string;
}
/**
 * Upload content to IPFS
 *
 * Supports (in order of preference):
 * - Local/Custom IPFS node (IPFS_API_URL) - FREE, your own node
 * - web3.storage (WEB3_STORAGE_TOKEN) - Free 5GB tier
 * - Pinata (PINATA_API_KEY + PINATA_API_SECRET) - Free 1GB tier
 * - Demo mode (generates deterministic CIDs when no credentials)
 */
export declare function uploadToIPFS(content: Buffer, options?: IPFSUploadOptions): Promise<IPFSUploadResult>;
/**
 * Pin content by CID
 */
export declare function pinContent(cid: string, options?: {
    service?: PinningService;
    name?: string;
}): Promise<{
    success: boolean;
    pinnedAt: string;
}>;
/**
 * Unpin content by CID
 */
export declare function unpinContent(cid: string, options?: {
    service?: PinningService;
}): Promise<{
    success: boolean;
}>;
/**
 * Check if content exists on IPFS
 */
export declare function checkContent(cid: string, gateway?: string): Promise<{
    exists: boolean;
    size?: number;
}>;
/**
 * Get gateway URL for CID
 */
export declare function getGatewayURL(cid: string, gateway?: string): string;
/**
 * Get IPNS URL for name
 */
export declare function getIPNSURL(name: string, gateway?: string): string;
/**
 * Check if local IPFS node is available
 */
declare function checkLocalIPFSNode(): Promise<boolean>;
/**
 * Check if real IPFS credentials are available
 */
export declare function hasIPFSCredentials(): boolean;
/**
 * Get IPFS service status
 */
export declare function getIPFSServiceStatus(): {
    service: 'local' | 'web3storage' | 'pinata' | 'demo';
    configured: boolean;
    message: string;
    apiUrl?: string;
};
/**
 * Export the local IPFS check for external use
 */
export { checkLocalIPFSNode };
//# sourceMappingURL=upload.d.ts.map