export type LLMProvider = 'anthropic' | 'openai' | 'ollama';
export interface LLMConfig {
    provider: LLMProvider;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}
export interface LLMResponse {
    text: string;
    inputTokens?: number;
    outputTokens?: number;
}
/**
 * Call an LLM provider with the given prompt and configuration.
 * Supports anthropic, openai, and ollama providers.
 */
export declare function callLLM(prompt: string, config: LLMConfig): Promise<LLMResponse>;
//# sourceMappingURL=providers.d.ts.map