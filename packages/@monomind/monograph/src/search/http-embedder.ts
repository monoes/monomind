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

export class HttpEmbedder {
  private config: Required<HttpEmbedderConfig>;

  constructor(config: HttpEmbedderConfig) {
    this.config = {
      model: '',
      apiKey: '',
      timeoutMs: 30_000,
      batchSize: 32,
      ...config,
    };
  }

  async embedOne(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const body: Record<string, unknown> = { prompt: text };
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

      const data = (await response.json()) as Partial<EmbedResponse>;
      if (!data.embedding) {
        throw new Error('HTTP embedder: no embedding in response');
      }

      return data.embedding;
    } finally {
      clearTimeout(timer);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
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
