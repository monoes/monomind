/**
 * @monobrain/mcp - Sampling (Server-Initiated LLM)
 *
 * MCP 2025-11-25 compliant sampling for server-initiated LLM calls
 */
import { EventEmitter } from 'events';
const DEFAULT_CONFIG = {
    defaultModelPreferences: {
        intelligencePriority: 0.5,
        speedPriority: 0.3,
        costPriority: 0.2,
    },
    maxTokensLimit: 4096,
    defaultTemperature: 0.7,
    timeout: 30000,
    enableLogging: true,
};
export class SamplingManager extends EventEmitter {
    logger;
    config;
    providers = new Map();
    defaultProvider;
    requestCount = 0;
    totalTokens = 0;
    constructor(logger, config = {}) {
        super();
        this.logger = logger;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Register an LLM provider
     */
    registerProvider(provider, isDefault = false) {
        this.providers.set(provider.name, provider);
        if (isDefault || !this.defaultProvider) {
            this.defaultProvider = provider.name;
        }
        this.logger.info('LLM provider registered', { name: provider.name, isDefault });
        this.emit('provider:registered', { name: provider.name });
    }
    /**
     * Unregister a provider
     */
    unregisterProvider(name) {
        const removed = this.providers.delete(name);
        if (removed && this.defaultProvider === name) {
            this.defaultProvider = this.providers.keys().next().value;
        }
        return removed;
    }
    /**
     * Create a message (sampling/createMessage)
     */
    async createMessage(request, context) {
        const startTime = Date.now();
        this.requestCount++;
        // Validate request
        this.validateRequest(request);
        // Select provider
        const provider = this.selectProvider(request.modelPreferences);
        if (!provider) {
            throw new Error('No LLM provider available');
        }
        // Apply defaults
        const fullRequest = this.applyDefaults(request);
        if (this.config.enableLogging) {
            this.logger.debug('Sampling request', {
                provider: provider.name,
                messageCount: request.messages.length,
                maxTokens: fullRequest.maxTokens,
                sessionId: context?.sessionId,
            });
        }
        this.emit('sampling:start', { provider: provider.name, context });
        try {
            // Call provider with timeout
            const result = await this.callWithTimeout(provider.createMessage(fullRequest), this.config.timeout);
            const duration = Date.now() - startTime;
            if (this.config.enableLogging) {
                this.logger.info('Sampling complete', {
                    provider: provider.name,
                    duration: `${duration}ms`,
                    stopReason: result.stopReason,
                });
            }
            this.emit('sampling:complete', {
                provider: provider.name,
                duration,
                result,
                context,
            });
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error('Sampling failed', {
                provider: provider.name,
                duration: `${duration}ms`,
                error,
            });
            this.emit('sampling:error', {
                provider: provider.name,
                duration,
                error,
                context,
            });
            throw error;
        }
    }
    /**
     * Check if sampling is available
     */
    async isAvailable() {
        if (this.providers.size === 0) {
            return false;
        }
        for (const provider of this.providers.values()) {
            if (await provider.isAvailable()) {
                return true;
            }
        }
        return false;
    }
    /**
     * Get available providers
     */
    getProviders() {
        return Array.from(this.providers.keys());
    }
    /**
     * Get stats
     */
    getStats() {
        return {
            requestCount: this.requestCount,
            totalTokens: this.totalTokens,
            providerCount: this.providers.size,
            defaultProvider: this.defaultProvider,
        };
    }
    /**
     * Validate sampling request
     */
    validateRequest(request) {
        if (!request.messages || request.messages.length === 0) {
            throw new Error('Messages are required');
        }
        if (request.maxTokens > this.config.maxTokensLimit) {
            throw new Error(`maxTokens exceeds limit of ${this.config.maxTokensLimit}`);
        }
        if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 2)) {
            throw new Error('Temperature must be between 0 and 2');
        }
    }
    /**
     * Select provider based on preferences
     */
    selectProvider(preferences) {
        // If hints provided, try to find matching provider
        if (preferences?.hints) {
            for (const hint of preferences.hints) {
                if (hint.name && this.providers.has(hint.name)) {
                    return this.providers.get(hint.name);
                }
            }
        }
        // Use default provider
        if (this.defaultProvider) {
            return this.providers.get(this.defaultProvider);
        }
        // Return first available
        return this.providers.values().next().value;
    }
    /**
     * Apply default values to request
     */
    applyDefaults(request) {
        return {
            ...request,
            modelPreferences: request.modelPreferences || this.config.defaultModelPreferences,
            temperature: request.temperature ?? this.config.defaultTemperature,
            maxTokens: Math.min(request.maxTokens, this.config.maxTokensLimit),
        };
    }
    /**
     * Call with timeout
     */
    async callWithTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Sampling timeout')), timeout);
            }),
        ]);
    }
}
export function createSamplingManager(logger, config) {
    return new SamplingManager(logger, config);
}
/**
 * Create a mock LLM provider for testing
 */
export function createMockProvider(name = 'mock') {
    return {
        name,
        async createMessage(request) {
            // Mock provider response delay
            await new Promise((r) => setTimeout(r, 100));
            return {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `Mock response to: ${JSON.stringify(request.messages[0]?.content)}`,
                },
                model: `${name}-model`,
                stopReason: 'endTurn',
            };
        },
        async isAvailable() {
            return true;
        },
    };
}
/**
 * Create an Anthropic provider (requires API key)
 */
export function createAnthropicProvider(apiKey) {
    return {
        name: 'anthropic',
        async createMessage(request) {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: request.maxTokens,
                    temperature: request.temperature,
                    system: request.systemPrompt,
                    messages: request.messages.map((m) => ({
                        role: m.role,
                        content: m.content.type === 'text' ? m.content.text : m.content,
                    })),
                }),
            });
            if (!response.ok) {
                throw new Error(`Anthropic API error: ${response.status}`);
            }
            const data = await response.json();
            return {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: data.content[0]?.text || '',
                },
                model: data.model,
                stopReason: data.stop_reason === 'end_turn' ? 'endTurn' : 'maxTokens',
            };
        },
        async isAvailable() {
            return !!apiKey;
        },
    };
}
//# sourceMappingURL=sampling.js.map