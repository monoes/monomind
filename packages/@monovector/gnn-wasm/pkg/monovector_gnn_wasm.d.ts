/* tslint:disable */
/* eslint-disable */

export class JsRuvectorLayer {
    free(): void;
    [Symbol.dispose](): void;
    forward(node_embedding: Float32Array, neighbor_embeddings: any, edge_weights: Float32Array): Float32Array;
    constructor(input_dim: number, hidden_dim: number, heads: number, dropout: number);
    readonly outputDim: number;
}

export class JsTensorCompress {
    free(): void;
    [Symbol.dispose](): void;
    compress(embedding: Float32Array, access_freq: number): any;
    compressWithLevel(embedding: Float32Array, level: string): any;
    decompress(compressed: any): Float32Array;
    getCompressionRatio(access_freq: number): number;
    constructor();
}

export class SearchConfig {
    free(): void;
    [Symbol.dispose](): void;
    constructor(k: number, temperature: number);
    k: number;
    temperature: number;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number;

export function differentiableSearch(query: Float32Array, candidate_embeddings: any, config: SearchConfig): any;

export function hierarchicalForward(query: Float32Array, layer_embeddings: any, gnn_layers: JsRuvectorLayer[]): Float32Array;

export function init(): void;

export function version(): string;
