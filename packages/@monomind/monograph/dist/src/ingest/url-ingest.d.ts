export type UrlType = 'paper' | 'github' | 'video' | 'webpage' | 'pdf' | 'image';
export interface IngestResult {
    id: string;
    url: string;
    type: UrlType;
    title: string;
    snippet: string;
    fetchedAt: string;
}
export interface IngestOptions {
    fetch?: typeof globalThis.fetch;
    maxBytes?: number;
}
export declare function classifyUrlType(url: string): UrlType;
export declare function ingestUrl(url: string, options?: IngestOptions): Promise<IngestResult>;
//# sourceMappingURL=url-ingest.d.ts.map