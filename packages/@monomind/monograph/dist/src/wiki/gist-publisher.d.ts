export interface GistPublishConfig {
    token: string;
    gistId?: string;
    description?: string;
    public?: boolean;
}
export interface GistPublishResult {
    gistId: string;
    url: string;
    filesPublished: number;
}
/**
 * Publishes a map of filename→content to GitHub Gist.
 * files: Record<filename, markdown content>
 */
export declare function publishToGist(files: Record<string, string>, config: GistPublishConfig): Promise<GistPublishResult>;
//# sourceMappingURL=gist-publisher.d.ts.map