/**
 * TaskHistoryProvider — searches memory for previously completed tasks that
 * are similar to the current one and formats them as markdown context.
 */
import { BaseContextProvider } from './context-provider.js';
export class TaskHistoryProvider extends BaseContextProvider {
    search;
    name = 'task-history';
    priority = 50;
    maxTokens = 600;
    constructor(search) {
        super();
        this.search = search;
    }
    async provide(ctx) {
        const results = await this.search(ctx.taskDescription, {
            namespace: 'tasks',
            limit: 5,
            minScore: 0.6,
        });
        if (!results || results.length === 0) {
            return '';
        }
        const lines = ['**Similar past tasks:**'];
        for (const r of results) {
            const label = r.metadata?.['title'] ?? r.value.slice(0, 80);
            lines.push(`- (${(r.score * 100).toFixed(0)}%) ${label}`);
        }
        return this.truncateToTokens(lines.join('\n'), this.maxTokens);
    }
}
//# sourceMappingURL=task-history-provider.js.map