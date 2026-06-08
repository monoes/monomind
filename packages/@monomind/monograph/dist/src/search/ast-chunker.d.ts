export interface ChunkOptions {
    maxTokens?: number;
    overlap?: number;
    minTokens?: number;
}
export interface Chunk {
    text: string;
    startLine: number;
    endLine: number;
    kind: 'function' | 'class' | 'block' | 'comment' | 'import' | 'other';
}
export declare function chunkSource(source: string, options?: ChunkOptions): Chunk[];
//# sourceMappingURL=ast-chunker.d.ts.map