/**
 * @monobrain/mcp - Tool Registry
 *
 * High-performance tool management with O(1) lookup
 */
import { EventEmitter } from 'events';
import { validateSchema, formatValidationErrors } from './schema-validator.js';
export class ToolRegistry extends EventEmitter {
    logger;
    tools = new Map();
    categoryIndex = new Map();
    tagIndex = new Map();
    defaultContext;
    totalRegistrations = 0;
    totalLookups = 0;
    totalExecutions = 0;
    constructor(logger) {
        super();
        this.logger = logger;
    }
    register(tool, options = {}) {
        const startTime = performance.now();
        if (this.tools.has(tool.name) && !options.override) {
            this.logger.warn('Tool already registered', { name: tool.name });
            return false;
        }
        if (options.validate !== false) {
            const validation = this.validateTool(tool);
            if (!validation.valid) {
                this.logger.error('Tool validation failed', {
                    name: tool.name,
                    errors: validation.errors,
                });
                return false;
            }
        }
        const metadata = {
            tool,
            registeredAt: new Date(),
            callCount: 0,
            avgExecutionTime: 0,
            errorCount: 0,
        };
        this.tools.set(tool.name, metadata);
        this.totalRegistrations++;
        if (tool.category) {
            if (!this.categoryIndex.has(tool.category)) {
                this.categoryIndex.set(tool.category, new Set());
            }
            this.categoryIndex.get(tool.category).add(tool.name);
        }
        if (tool.tags) {
            for (const tag of tool.tags) {
                if (!this.tagIndex.has(tag)) {
                    this.tagIndex.set(tag, new Set());
                }
                this.tagIndex.get(tag).add(tool.name);
            }
        }
        const duration = performance.now() - startTime;
        this.logger.debug('Tool registered', {
            name: tool.name,
            category: tool.category,
            duration: `${duration.toFixed(2)}ms`,
        });
        this.emit('tool:registered', tool.name);
        return true;
    }
    registerBatch(tools, options = {}) {
        const startTime = performance.now();
        const failed = [];
        let registered = 0;
        for (const tool of tools) {
            if (this.register(tool, options)) {
                registered++;
            }
            else {
                failed.push(tool.name);
            }
        }
        const duration = performance.now() - startTime;
        this.logger.info('Batch registration complete', {
            total: tools.length,
            registered,
            failed: failed.length,
            duration: `${duration.toFixed(2)}ms`,
        });
        return { registered, failed };
    }
    unregister(name) {
        const metadata = this.tools.get(name);
        if (!metadata) {
            return false;
        }
        if (metadata.tool.category) {
            const categoryTools = this.categoryIndex.get(metadata.tool.category);
            categoryTools?.delete(name);
            if (categoryTools?.size === 0) {
                this.categoryIndex.delete(metadata.tool.category);
            }
        }
        if (metadata.tool.tags) {
            for (const tag of metadata.tool.tags) {
                const tagTools = this.tagIndex.get(tag);
                tagTools?.delete(name);
                if (tagTools?.size === 0) {
                    this.tagIndex.delete(tag);
                }
            }
        }
        this.tools.delete(name);
        this.logger.debug('Tool unregistered', { name });
        this.emit('tool:unregistered', name);
        return true;
    }
    getTool(name) {
        this.totalLookups++;
        return this.tools.get(name)?.tool;
    }
    hasTool(name) {
        return this.tools.has(name);
    }
    getToolCount() {
        return this.tools.size;
    }
    getToolNames() {
        return Array.from(this.tools.keys());
    }
    listTools() {
        return Array.from(this.tools.values()).map(({ tool }) => ({
            name: tool.name,
            description: tool.description,
            category: tool.category,
            tags: tool.tags,
            deprecated: tool.deprecated,
        }));
    }
    search(options) {
        let results;
        if (options.category) {
            const categoryTools = this.categoryIndex.get(options.category);
            if (!categoryTools)
                return [];
            results = new Set(categoryTools);
        }
        if (options.tags && options.tags.length > 0) {
            for (const tag of options.tags) {
                const tagTools = this.tagIndex.get(tag);
                if (!tagTools)
                    return [];
                if (results) {
                    results = new Set([...results].filter((name) => tagTools.has(name)));
                }
                else {
                    results = new Set(tagTools);
                }
            }
        }
        if (!results) {
            results = new Set(this.tools.keys());
        }
        const tools = [];
        for (const name of results) {
            const metadata = this.tools.get(name);
            if (!metadata)
                continue;
            const tool = metadata.tool;
            if (options.deprecated !== undefined && tool.deprecated !== options.deprecated) {
                continue;
            }
            if (options.cacheable !== undefined && tool.cacheable !== options.cacheable) {
                continue;
            }
            tools.push(tool);
        }
        return tools;
    }
    getByCategory(category) {
        const toolNames = this.categoryIndex.get(category);
        if (!toolNames)
            return [];
        return Array.from(toolNames)
            .map((name) => this.tools.get(name)?.tool)
            .filter((tool) => tool !== undefined);
    }
    getByTag(tag) {
        const toolNames = this.tagIndex.get(tag);
        if (!toolNames)
            return [];
        return Array.from(toolNames)
            .map((name) => this.tools.get(name)?.tool)
            .filter((tool) => tool !== undefined);
    }
    getCategories() {
        return Array.from(this.categoryIndex.keys());
    }
    getTags() {
        return Array.from(this.tagIndex.keys());
    }
    async execute(name, input, context) {
        const startTime = performance.now();
        const metadata = this.tools.get(name);
        if (!metadata) {
            return {
                content: [{ type: 'text', text: `Tool not found: ${name}` }],
                isError: true,
            };
        }
        // Validate input against schema (security feature)
        if (metadata.tool.inputSchema) {
            const validation = validateSchema(input, metadata.tool.inputSchema);
            if (!validation.valid) {
                const errorMsg = formatValidationErrors(validation.errors);
                this.logger.warn('Tool input validation failed', {
                    name,
                    errors: validation.errors,
                });
                return {
                    content: [{ type: 'text', text: `Invalid input: ${errorMsg}` }],
                    isError: true,
                };
            }
        }
        const execContext = {
            sessionId: context?.sessionId || this.defaultContext?.sessionId || 'default-session',
            ...this.defaultContext,
            ...context,
        };
        this.totalExecutions++;
        metadata.callCount++;
        metadata.lastCalled = new Date();
        try {
            this.emit('tool:called', { name, input });
            const result = await metadata.tool.handler(input, execContext);
            const duration = performance.now() - startTime;
            this.updateAverageExecutionTime(metadata, duration);
            this.logger.debug('Tool executed', {
                name,
                duration: `${duration.toFixed(2)}ms`,
                success: true,
            });
            this.emit('tool:completed', { name, duration, success: true });
            return {
                content: [{
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    }],
                isError: false,
            };
        }
        catch (error) {
            const duration = performance.now() - startTime;
            metadata.errorCount++;
            this.logger.error('Tool execution failed', { name, error });
            this.emit('tool:error', { name, error, duration });
            return {
                content: [{
                        type: 'text',
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                isError: true,
            };
        }
    }
    setDefaultContext(context) {
        this.defaultContext = context;
    }
    getMetadata(name) {
        return this.tools.get(name);
    }
    getStats() {
        const topTools = Array.from(this.tools.entries())
            .map(([name, metadata]) => ({ name, calls: metadata.callCount }))
            .sort((a, b) => b.calls - a.calls)
            .slice(0, 10);
        return {
            totalTools: this.tools.size,
            totalCategories: this.categoryIndex.size,
            totalTags: this.tagIndex.size,
            totalRegistrations: this.totalRegistrations,
            totalLookups: this.totalLookups,
            totalExecutions: this.totalExecutions,
            topTools,
        };
    }
    validateTool(tool) {
        const errors = [];
        if (!tool.name || typeof tool.name !== 'string') {
            errors.push('Tool name is required and must be a string');
        }
        else if (!/^[a-zA-Z][a-zA-Z0-9_/:-]*$/.test(tool.name)) {
            errors.push('Tool name must start with a letter and contain only alphanumeric characters, underscores, slashes, colons, and hyphens');
        }
        if (!tool.description || typeof tool.description !== 'string') {
            errors.push('Tool description is required and must be a string');
        }
        if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
            errors.push('Tool inputSchema is required and must be an object');
        }
        else {
            const schemaErrors = this.validateSchema(tool.inputSchema);
            errors.push(...schemaErrors);
        }
        if (typeof tool.handler !== 'function') {
            errors.push('Tool handler is required and must be a function');
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
    validateSchema(schema, path = '') {
        const errors = [];
        if (!schema.type) {
            errors.push(`${path || 'schema'}: type is required`);
        }
        if (schema.type === 'object' && schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                const propPath = path ? `${path}.${key}` : key;
                errors.push(...this.validateSchema(propSchema, propPath));
            }
        }
        if (schema.type === 'array' && schema.items) {
            errors.push(...this.validateSchema(schema.items, `${path}[]`));
        }
        return errors;
    }
    updateAverageExecutionTime(metadata, duration) {
        const n = metadata.callCount;
        metadata.avgExecutionTime =
            ((metadata.avgExecutionTime * (n - 1)) + duration) / n;
    }
    clear() {
        this.tools.clear();
        this.categoryIndex.clear();
        this.tagIndex.clear();
        this.logger.info('Tool registry cleared');
        this.emit('registry:cleared');
    }
}
export function createToolRegistry(logger) {
    return new ToolRegistry(logger);
}
export function defineTool(name, description, inputSchema, handler, options) {
    return {
        name,
        description,
        inputSchema,
        handler,
        ...options,
    };
}
//# sourceMappingURL=tool-registry.js.map