import { createHash } from 'crypto';

export interface Encoder {
  encode(text: string): Promise<number[]>;
  encodeAll(texts: string[]): Promise<number[][]>;
}

/**
 * Local encoder that produces deterministic pseudo-embeddings from text.
 * Uses n-gram hashing to spread tokens across a fixed-dimensional vector.
 * NOTE: Real semantic routing requires a real embedding model.
 * In production, replace with HNSWEncoder backed by a proper embedding model.
 */
export class LocalEncoder implements Encoder {
  private readonly DIM = 256;
  private cache = new Map<string, number[]>();

  async encode(text: string): Promise<number[]> {
    const key = createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
    if (this.cache.has(key)) return this.cache.get(key)!;

    const vector = new Array(this.DIM).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    // Unigrams
    for (const word of words) {
      const hash = createHash('md5').update(word).digest();
      for (let i = 0; i < Math.min(hash.length, this.DIM); i++) {
        vector[i % this.DIM] += (hash[i] - 128) / 128;
      }
    }

    // Bigrams for better phrase sensitivity
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      const hash = createHash('md5').update(bigram).digest();
      for (let j = 0; j < Math.min(hash.length, this.DIM); j++) {
        vector[(j + this.DIM / 2) % this.DIM] += (hash[j] - 128) / 128 * 0.5;
      }
    }

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    const normalized = vector.map(v => v / norm);
    this.cache.set(key, normalized);
    return normalized;
  }

  async encodeAll(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.encode(t)));
  }
}

/**
 * Production encoder backed by a real embedding model.
 *
 * The model is injected by the host (the CLI wires in a local
 * `@huggingface/transformers` feature-extraction pipeline) so this package
 * carries no model dependency. When no embedder is injected it degrades to the
 * deterministic {@link LocalEncoder}.
 */
export class HNSWEncoder implements Encoder {
  private fallback = new LocalEncoder();
  private embed?: (text: string) => Promise<number[]>;

  /**
   * @param embed Optional real embedding function. When provided it is used
   *   exclusively — the hash-based LocalEncoder is NOT mixed in, since combining
   *   vectors of different dimensionality would break cosine comparison.
   */
  constructor(embed?: (text: string) => Promise<number[]>) {
    this.embed = embed;
  }

  async encode(text: string): Promise<number[]> {
    return this.embed ? this.embed(text) : this.fallback.encode(text);
  }

  async encodeAll(texts: string[]): Promise<number[][]> {
    if (!this.embed) return this.fallback.encodeAll(texts);
    // Sequential: the underlying transformers pipeline is single-threaded, so
    // Promise.all would not parallelise — it would only inflate peak memory.
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}
