import type { MonographDb } from '../storage/db.js';
export interface QueryResult {
    id: string;
    label: string;
    name: string;
    filePath?: string;
    score: number;
    isProcess: boolean;
}
export interface MonographQueryOutput {
    query: string;
    results: QueryResult[];
    processCount: number;
    symbolCount: number;
}
export declare const monographQueryTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            repoPath: {
                type: string;
                description: string;
            };
            topK: {
                type: string;
                description: string;
            };
            includeProcesses: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    handler(args: {
        query: string;
        repoPath?: string;
        topK?: number;
        includeProcesses?: boolean;
        db?: MonographDb;
    }): Promise<MonographQueryOutput>;
};
//# sourceMappingURL=query.d.ts.map