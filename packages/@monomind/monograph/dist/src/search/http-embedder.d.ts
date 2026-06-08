export interface HttpEmbedderConfig {
    endpoint: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    batchSize?: number;
}
export interface EmbedResponse {
    embedding: number[];
}
export declare class HttpEmbedder {
    private config;
    constructor(config: HttpEmbedderConfig);
    embedOne(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}
//# sourceMappingURL=http-embedder.d.ts.map