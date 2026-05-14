/**
 * TaskHistoryProvider — searches memory for previously completed tasks that
 * are similar to the current one and formats them as markdown context.
 */
import { BaseContextProvider, type RunContext } from './context-provider.js';
export interface SearchResult {
    metadata: Record<string, unknown>;
    value: string;
    score: number;
}
export type SearchFn = (query: string, options: {
    namespace: string;
    limit: number;
    minScore: number;
}) => Promise<SearchResult[]>;
export declare class TaskHistoryProvider extends BaseContextProvider {
    private readonly search;
    readonly name: "task-history";
    readonly priority = 50;
    readonly maxTokens = 600;
    constructor(search: SearchFn);
    provide(ctx: RunContext): Promise<string>;
}
//# sourceMappingURL=task-history-provider.d.ts.map