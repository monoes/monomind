/**
 * @monobrain/mcp - Resource Registry
 *
 * MCP 2025-11-25 compliant resource management
 * Supports: list, read, subscribe, templates, pagination
 */
import { EventEmitter } from 'events';
import type { MCPResource, ResourceContent, ResourceTemplate, ResourceListResult, ResourceReadResult, ILogger, ContentAnnotations } from './types.js';
export type ResourceHandler = (uri: string) => Promise<ResourceContent[]>;
export type SubscriptionCallback = (uri: string, content: ResourceContent[]) => void;
export interface ResourceRegistryOptions {
    enableSubscriptions?: boolean;
    maxSubscriptionsPerResource?: number;
    cacheEnabled?: boolean;
    cacheTTL?: number;
    maxCacheSize?: number;
}
export declare class ResourceRegistry extends EventEmitter {
    private readonly logger;
    private resources;
    private templates;
    private handlers;
    private subscriptions;
    private cache;
    private subscriptionCounter;
    private readonly options;
    constructor(logger: ILogger, options?: ResourceRegistryOptions);
    /**
     * Register a static resource
     */
    registerResource(resource: MCPResource, handler: ResourceHandler): boolean;
    /**
     * Register a resource template (dynamic URIs)
     */
    registerTemplate(template: ResourceTemplate, handler: ResourceHandler): boolean;
    /**
     * Unregister a resource
     */
    unregisterResource(uri: string): boolean;
    /**
     * List resources with pagination
     */
    list(cursor?: string, pageSize?: number): ResourceListResult;
    /**
     * Read resource content
     */
    read(uri: string): Promise<ResourceReadResult>;
    /**
     * Subscribe to resource updates
     */
    subscribe(uri: string, callback: SubscriptionCallback): string;
    /**
     * Unsubscribe from resource updates
     */
    unsubscribe(subscriptionId: string): boolean;
    /**
     * Notify subscribers of resource update
     */
    notifyUpdate(uri: string): Promise<void>;
    /**
     * Get resource by URI
     */
    getResource(uri: string): MCPResource | undefined;
    /**
     * Check if resource exists
     */
    hasResource(uri: string): boolean;
    /**
     * Get resource count
     */
    getResourceCount(): number;
    /**
     * Get all templates
     */
    getTemplates(): ResourceTemplate[];
    /**
     * Get subscription count for a resource
     */
    getSubscriptionCount(uri: string): number;
    /**
     * Get stats
     */
    getStats(): {
        totalResources: number;
        totalTemplates: number;
        totalSubscriptions: number;
        cacheSize: number;
    };
    /**
     * Clear cache
     */
    clearCache(): void;
    /**
     * Find handler for template URI
     */
    private findTemplateHandler;
    /**
     * Escape regex metacharacters to prevent ReDoS attacks
     * SECURITY: Critical for preventing regex denial of service
     */
    private escapeRegex;
    /**
     * Check if URI matches any template
     * SECURITY: Uses escaped regex to prevent ReDoS
     */
    private matchesTemplate;
    /**
     * Encode cursor for pagination
     */
    private encodeCursor;
    /**
     * Decode cursor for pagination
     */
    private decodeCursor;
    /**
     * Emit listChanged notification
     */
    private emitListChanged;
}
export declare function createResourceRegistry(logger: ILogger, options?: ResourceRegistryOptions): ResourceRegistry;
/**
 * Helper to create a static text resource
 */
export declare function createTextResource(uri: string, name: string, text: string, options?: {
    description?: string;
    mimeType?: string;
    annotations?: ContentAnnotations;
}): {
    resource: MCPResource;
    handler: ResourceHandler;
};
/**
 * Helper to create a file resource
 * SECURITY: Validates path to prevent path traversal attacks
 */
export declare function createFileResource(uri: string, name: string, filePath: string, options?: {
    description?: string;
    mimeType?: string;
    allowedBasePaths?: string[];
}): {
    resource: MCPResource;
    handler: ResourceHandler;
};
//# sourceMappingURL=resource-registry.d.ts.map