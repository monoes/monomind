/**
 * @monobrain/mcp - Resource Registry
 *
 * MCP 2025-11-25 compliant resource management
 * Supports: list, read, subscribe, templates, pagination
 */
import { EventEmitter } from 'events';
export class ResourceRegistry extends EventEmitter {
    logger;
    resources = new Map();
    templates = new Map();
    handlers = new Map();
    subscriptions = new Map();
    cache = new Map();
    subscriptionCounter = 0;
    options;
    constructor(logger, options = {}) {
        super();
        this.logger = logger;
        this.options = {
            enableSubscriptions: options.enableSubscriptions ?? true,
            maxSubscriptionsPerResource: options.maxSubscriptionsPerResource ?? 100,
            cacheEnabled: options.cacheEnabled ?? true,
            cacheTTL: options.cacheTTL ?? 60000, // 1 minute default
            maxCacheSize: options.maxCacheSize ?? 1000, // SECURITY: Default max 1000 entries
        };
    }
    /**
     * Register a static resource
     */
    registerResource(resource, handler) {
        if (this.resources.has(resource.uri)) {
            this.logger.warn('Resource already registered', { uri: resource.uri });
            return false;
        }
        this.resources.set(resource.uri, resource);
        this.handlers.set(resource.uri, handler);
        this.logger.debug('Resource registered', { uri: resource.uri, name: resource.name });
        this.emit('resource:registered', { uri: resource.uri });
        this.emitListChanged();
        return true;
    }
    /**
     * Register a resource template (dynamic URIs)
     */
    registerTemplate(template, handler) {
        if (this.templates.has(template.uriTemplate)) {
            this.logger.warn('Template already registered', { template: template.uriTemplate });
            return false;
        }
        this.templates.set(template.uriTemplate, template);
        this.handlers.set(template.uriTemplate, handler);
        this.logger.debug('Resource template registered', { template: template.uriTemplate });
        this.emit('template:registered', { template: template.uriTemplate });
        return true;
    }
    /**
     * Unregister a resource
     */
    unregisterResource(uri) {
        if (!this.resources.has(uri)) {
            return false;
        }
        this.resources.delete(uri);
        this.handlers.delete(uri);
        this.cache.delete(uri);
        // Cancel subscriptions for this resource
        const subs = this.subscriptions.get(uri) || [];
        for (const sub of subs) {
            this.emit('subscription:cancelled', { subscriptionId: sub.id, uri });
        }
        this.subscriptions.delete(uri);
        this.logger.debug('Resource unregistered', { uri });
        this.emit('resource:unregistered', { uri });
        this.emitListChanged();
        return true;
    }
    /**
     * List resources with pagination
     */
    list(cursor, pageSize = 50) {
        const allResources = Array.from(this.resources.values());
        let startIndex = 0;
        if (cursor) {
            const decoded = this.decodeCursor(cursor);
            startIndex = decoded.offset;
        }
        const endIndex = Math.min(startIndex + pageSize, allResources.length);
        const resources = allResources.slice(startIndex, endIndex);
        const result = { resources };
        if (endIndex < allResources.length) {
            result.nextCursor = this.encodeCursor({ offset: endIndex });
        }
        return result;
    }
    /**
     * Read resource content
     */
    async read(uri) {
        // Check cache first
        if (this.options.cacheEnabled) {
            const cached = this.cache.get(uri);
            if (cached && Date.now() - cached.cachedAt < cached.ttl) {
                this.logger.debug('Resource cache hit', { uri });
                return { contents: cached.content };
            }
        }
        // Find handler (exact match or template match)
        let handler = this.handlers.get(uri);
        if (!handler) {
            handler = this.findTemplateHandler(uri);
        }
        if (!handler) {
            throw new Error(`Resource not found: ${uri}`);
        }
        const contents = await handler(uri);
        // Cache the result with size limit (LRU eviction)
        if (this.options.cacheEnabled) {
            // SECURITY: Enforce max cache size to prevent memory exhaustion
            if (this.cache.size >= this.options.maxCacheSize) {
                // Remove oldest entry (first entry in Map iteration order)
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey) {
                    this.cache.delete(oldestKey);
                    this.logger.debug('Cache evicted oldest entry', { uri: oldestKey });
                }
            }
            this.cache.set(uri, {
                content: contents,
                cachedAt: Date.now(),
                ttl: this.options.cacheTTL,
            });
        }
        this.emit('resource:read', { uri, contentCount: contents.length });
        return { contents };
    }
    /**
     * Subscribe to resource updates
     */
    subscribe(uri, callback) {
        if (!this.options.enableSubscriptions) {
            throw new Error('Subscriptions are disabled');
        }
        const existingSubs = this.subscriptions.get(uri) || [];
        if (existingSubs.length >= this.options.maxSubscriptionsPerResource) {
            throw new Error(`Maximum subscriptions reached for resource: ${uri}`);
        }
        const subscriptionId = `sub-${++this.subscriptionCounter}-${Date.now()}`;
        const subscription = {
            id: subscriptionId,
            uri,
            callback,
            createdAt: new Date(),
        };
        existingSubs.push(subscription);
        this.subscriptions.set(uri, existingSubs);
        this.logger.debug('Subscription created', { subscriptionId, uri });
        this.emit('subscription:created', { subscriptionId, uri });
        return subscriptionId;
    }
    /**
     * Unsubscribe from resource updates
     */
    unsubscribe(subscriptionId) {
        for (const [uri, subs] of this.subscriptions) {
            const index = subs.findIndex((s) => s.id === subscriptionId);
            if (index !== -1) {
                subs.splice(index, 1);
                if (subs.length === 0) {
                    this.subscriptions.delete(uri);
                }
                this.logger.debug('Subscription removed', { subscriptionId, uri });
                this.emit('subscription:removed', { subscriptionId, uri });
                return true;
            }
        }
        return false;
    }
    /**
     * Notify subscribers of resource update
     */
    async notifyUpdate(uri) {
        const subs = this.subscriptions.get(uri);
        if (!subs || subs.length === 0) {
            return;
        }
        // Invalidate cache
        this.cache.delete(uri);
        // Read fresh content
        const { contents } = await this.read(uri);
        // Notify all subscribers
        for (const sub of subs) {
            try {
                sub.callback(uri, contents);
            }
            catch (error) {
                this.logger.error('Subscription callback error', { subscriptionId: sub.id, error });
            }
        }
        this.emit('resource:updated', { uri, subscriberCount: subs.length });
    }
    /**
     * Get resource by URI
     */
    getResource(uri) {
        return this.resources.get(uri);
    }
    /**
     * Check if resource exists
     */
    hasResource(uri) {
        return this.resources.has(uri) || this.matchesTemplate(uri);
    }
    /**
     * Get resource count
     */
    getResourceCount() {
        return this.resources.size;
    }
    /**
     * Get all templates
     */
    getTemplates() {
        return Array.from(this.templates.values());
    }
    /**
     * Get subscription count for a resource
     */
    getSubscriptionCount(uri) {
        return this.subscriptions.get(uri)?.length || 0;
    }
    /**
     * Get stats
     */
    getStats() {
        let totalSubscriptions = 0;
        for (const subs of this.subscriptions.values()) {
            totalSubscriptions += subs.length;
        }
        return {
            totalResources: this.resources.size,
            totalTemplates: this.templates.size,
            totalSubscriptions,
            cacheSize: this.cache.size,
        };
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        this.logger.debug('Resource cache cleared');
    }
    /**
     * Find handler for template URI
     */
    findTemplateHandler(uri) {
        for (const [template, handler] of this.handlers) {
            if (this.matchesTemplate(uri, template)) {
                return handler;
            }
        }
        return undefined;
    }
    /**
     * Escape regex metacharacters to prevent ReDoS attacks
     * SECURITY: Critical for preventing regex denial of service
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    /**
     * Check if URI matches any template
     * SECURITY: Uses escaped regex to prevent ReDoS
     */
    matchesTemplate(uri, template) {
        if (template) {
            // SECURITY: Escape regex metacharacters before converting template
            // First extract placeholders, escape the rest, then add placeholder pattern
            const escaped = this.escapeRegex(template);
            // Replace escaped placeholder braces with the pattern
            const pattern = escaped.replace(/\\\{[^}]+\\\}/g, '[^/]+');
            try {
                const regex = new RegExp('^' + pattern + '$');
                return regex.test(uri);
            }
            catch {
                // Invalid regex pattern - return false safely
                return false;
            }
        }
        for (const t of this.templates.keys()) {
            const escaped = this.escapeRegex(t);
            const pattern = escaped.replace(/\\\{[^}]+\\\}/g, '[^/]+');
            try {
                const regex = new RegExp('^' + pattern + '$');
                if (regex.test(uri)) {
                    return true;
                }
            }
            catch {
                // Skip invalid patterns
                continue;
            }
        }
        return false;
    }
    /**
     * Encode cursor for pagination
     */
    encodeCursor(data) {
        return Buffer.from(JSON.stringify(data)).toString('base64');
    }
    /**
     * Decode cursor for pagination
     */
    decodeCursor(cursor) {
        try {
            return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
        }
        catch {
            return { offset: 0 };
        }
    }
    /**
     * Emit listChanged notification
     */
    emitListChanged() {
        this.emit('resources:listChanged');
    }
}
export function createResourceRegistry(logger, options) {
    return new ResourceRegistry(logger, options);
}
/**
 * Helper to create a static text resource
 */
export function createTextResource(uri, name, text, options) {
    const resource = {
        uri,
        name,
        description: options?.description,
        mimeType: options?.mimeType || 'text/plain',
        annotations: options?.annotations,
    };
    const handler = async () => [
        {
            uri,
            mimeType: options?.mimeType || 'text/plain',
            text,
        },
    ];
    return { resource, handler };
}
/**
 * Helper to create a file resource
 * SECURITY: Validates path to prevent path traversal attacks
 */
export function createFileResource(uri, name, filePath, options) {
    const resource = {
        uri,
        name,
        description: options?.description,
        mimeType: options?.mimeType || 'application/octet-stream',
    };
    const handler = async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        // SECURITY: Normalize and validate the path
        const normalizedPath = path.normalize(filePath);
        // Prevent path traversal
        if (normalizedPath.includes('..') || normalizedPath.includes('\0')) {
            throw new Error('Invalid file path: path traversal detected');
        }
        // Prevent access to sensitive system paths
        const blockedPaths = ['/etc/', '/proc/', '/sys/', '/dev/', '/root/', '/var/log/'];
        const lowerPath = normalizedPath.toLowerCase();
        for (const blocked of blockedPaths) {
            if (lowerPath.startsWith(blocked) || lowerPath.includes('/.')) {
                throw new Error('Access to system paths is not allowed');
            }
        }
        // If allowedBasePaths specified, validate against them
        if (options?.allowedBasePaths && options.allowedBasePaths.length > 0) {
            const resolvedPath = path.resolve(normalizedPath);
            const isAllowed = options.allowedBasePaths.some((basePath) => {
                const resolvedBase = path.resolve(basePath);
                return resolvedPath.startsWith(resolvedBase);
            });
            if (!isAllowed) {
                throw new Error('File path is outside allowed directories');
            }
        }
        const content = await fs.readFile(normalizedPath);
        return [
            {
                uri,
                mimeType: options?.mimeType || 'application/octet-stream',
                blob: content.toString('base64'),
            },
        ];
    };
    return { resource, handler };
}
//# sourceMappingURL=resource-registry.js.map