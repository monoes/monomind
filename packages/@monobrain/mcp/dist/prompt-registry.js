/**
 * @monobrain/mcp - Prompt Registry
 *
 * MCP 2025-11-25 compliant prompt management
 * Supports: list, get, arguments, templates, embedded resources
 */
import { EventEmitter } from 'events';
export class PromptRegistry extends EventEmitter {
    logger;
    prompts = new Map();
    options;
    constructor(logger, options = {}) {
        super();
        this.logger = logger;
        this.options = {
            maxPrompts: options.maxPrompts ?? 1000,
            validateArguments: options.validateArguments ?? true,
        };
    }
    /**
     * Register a prompt
     */
    register(prompt) {
        if (this.prompts.size >= this.options.maxPrompts) {
            this.logger.error('Maximum prompts reached', { max: this.options.maxPrompts });
            return false;
        }
        if (this.prompts.has(prompt.name)) {
            this.logger.warn('Prompt already registered', { name: prompt.name });
            return false;
        }
        this.prompts.set(prompt.name, prompt);
        this.logger.debug('Prompt registered', { name: prompt.name });
        this.emit('prompt:registered', { name: prompt.name });
        this.emitListChanged();
        return true;
    }
    /**
     * Unregister a prompt
     */
    unregister(name) {
        if (!this.prompts.has(name)) {
            return false;
        }
        this.prompts.delete(name);
        this.logger.debug('Prompt unregistered', { name });
        this.emit('prompt:unregistered', { name });
        this.emitListChanged();
        return true;
    }
    /**
     * List prompts with pagination
     */
    list(cursor, pageSize = 50) {
        const allPrompts = Array.from(this.prompts.values()).map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description,
            arguments: p.arguments,
        }));
        let startIndex = 0;
        if (cursor) {
            const decoded = this.decodeCursor(cursor);
            startIndex = decoded.offset;
        }
        const endIndex = Math.min(startIndex + pageSize, allPrompts.length);
        const prompts = allPrompts.slice(startIndex, endIndex);
        const result = { prompts };
        if (endIndex < allPrompts.length) {
            result.nextCursor = this.encodeCursor({ offset: endIndex });
        }
        return result;
    }
    /**
     * Get a prompt with arguments
     */
    async get(name, args = {}) {
        const prompt = this.prompts.get(name);
        if (!prompt) {
            throw new Error(`Prompt not found: ${name}`);
        }
        // Validate required arguments
        if (this.options.validateArguments && prompt.arguments) {
            for (const arg of prompt.arguments) {
                if (arg.required && !(arg.name in args)) {
                    throw new Error(`Missing required argument: ${arg.name}`);
                }
            }
        }
        const messages = await prompt.handler(args);
        this.emit('prompt:get', { name, argCount: Object.keys(args).length });
        return {
            description: prompt.description,
            messages,
        };
    }
    /**
     * Get prompt by name
     */
    getPrompt(name) {
        const prompt = this.prompts.get(name);
        if (!prompt)
            return undefined;
        return {
            name: prompt.name,
            title: prompt.title,
            description: prompt.description,
            arguments: prompt.arguments,
        };
    }
    /**
     * Check if prompt exists
     */
    hasPrompt(name) {
        return this.prompts.has(name);
    }
    /**
     * Get prompt count
     */
    getPromptCount() {
        return this.prompts.size;
    }
    /**
     * Get stats
     */
    getStats() {
        let promptsWithArgs = 0;
        for (const prompt of this.prompts.values()) {
            if (prompt.arguments && prompt.arguments.length > 0) {
                promptsWithArgs++;
            }
        }
        return {
            totalPrompts: this.prompts.size,
            promptsWithArgs,
        };
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
        this.emit('prompts:listChanged');
    }
}
export function createPromptRegistry(logger, options) {
    return new PromptRegistry(logger, options);
}
/**
 * Helper to define a prompt
 */
export function definePrompt(name, description, handler, options) {
    return {
        name,
        description,
        title: options?.title,
        arguments: options?.arguments,
        handler,
    };
}
/**
 * Helper to create a text message
 */
export function textMessage(role, text) {
    return {
        role,
        content: {
            type: 'text',
            text,
        },
    };
}
/**
 * Helper to create a message with embedded resource
 */
export function resourceMessage(role, resource) {
    return {
        role,
        content: {
            type: 'resource',
            resource,
        },
    };
}
/**
 * Template string interpolation for prompts
 */
export function interpolate(template, args) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return args[key] ?? match;
    });
}
//# sourceMappingURL=prompt-registry.js.map