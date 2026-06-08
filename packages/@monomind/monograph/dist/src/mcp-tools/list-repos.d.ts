export interface ListReposResult {
    repos: Array<{
        name: string;
        path: string;
        dbPath: string;
        exists: boolean;
        indexedAt?: string;
    }>;
}
export declare const listReposTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
        required: string[];
    };
    handler(_args: Record<string, unknown>): Promise<ListReposResult>;
};
//# sourceMappingURL=list-repos.d.ts.map