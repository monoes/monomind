export class HttpEmbedder {
    config;
    constructor(config) {
        this.config = {
            model: '',
            apiKey: '',
            timeoutMs: 30_000,
            batchSize: 32,
            ...config,
        };
    }
    async embedOne(text) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const headers = {
                'Content-Type': 'application/json',
            };
            if (this.config.apiKey) {
                headers['Authorization'] = `Bearer ${this.config.apiKey}`;
            }
            const body = { prompt: text };
            if (this.config.model) {
                body['model'] = this.config.model;
            }
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`HTTP embedder: ${response.status} ${response.statusText}`);
            }
            const data = (await response.json());
            if (!data.embedding) {
                throw new Error('HTTP embedder: no embedding in response');
            }
            return data.embedding;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async embedBatch(texts) {
        const results = [];
        const batchSize = this.config.batchSize;
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            for (const text of batch) {
                results.push(await this.embedOne(text));
            }
        }
        return results;
    }
}
//# sourceMappingURL=http-embedder.js.map