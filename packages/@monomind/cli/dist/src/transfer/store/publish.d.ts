/**
 * Pattern Publish Service
 * Publish and contribute patterns to decentralized registry
 */
import type { PublishOptions, PublishResult, StoreConfig } from './types.js';
import type { CFPFormat } from '../types.js';
/**
 * Pattern Publisher
 * Handles publishing patterns to IPFS and registry
 */
export declare class PatternPublisher {
    private config;
    constructor(config?: Partial<StoreConfig>);
    /**
     * Publish a pattern to IPFS and registry
     */
    publishPattern(cfp: CFPFormat, options: PublishOptions): Promise<PublishResult>;
    /**
     * Sign content with Ed25519 private key
     */
    private signContent;
    /**
     * Get current author info
     */
    private getAuthor;
    /**
     * Validate pattern before publish
     */
    validateForPublish(cfp: CFPFormat, options: PublishOptions): string[];
    /**
     * Create publish preview
     */
    createPreview(cfp: CFPFormat, options: PublishOptions): object;
}
/**
 * Submit contribution request
 * For contributing to official registry
 */
export interface ContributionRequest {
    patternCid: string;
    name: string;
    displayName: string;
    description: string;
    categories: string[];
    tags: string[];
    authorId: string;
    signature: string;
    publicKey: string;
    message?: string;
}
/**
 * Submit a contribution to the registry
 */
export declare function submitContribution(request: ContributionRequest): Promise<{
    success: boolean;
    submissionId: string;
    message: string;
}>;
/**
 * Check contribution status
 */
export declare function checkContributionStatus(submissionId: string): Promise<{
    status: 'pending' | 'reviewing' | 'approved' | 'rejected';
    message: string;
    reviewedAt?: string;
    reviewer?: string;
}>;
/**
 * Create publisher with default config
 */
export declare function createPublisher(config?: Partial<StoreConfig>): PatternPublisher;
/**
 * Quick publish helper
 */
export declare function quickPublish(cfp: CFPFormat, name: string, description: string, tags: string[], config?: Partial<StoreConfig>): Promise<PublishResult>;
//# sourceMappingURL=publish.d.ts.map