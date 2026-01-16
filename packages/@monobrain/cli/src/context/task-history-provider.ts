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

export type SearchFn = (
  query: string,
  options: { namespace: string; limit: number; minScore: number },
) => Promise<SearchResult[]>;

export class TaskHistoryProvider extends BaseContextProvider {
  readonly name = 'task-history' as const;
  readonly priority = 50;
  readonly maxTokens = 600;

  constructor(private readonly search: SearchFn) {
    super();
  }

  async provide(ctx: RunContext): Promise<string> {
    const results = await this.search(ctx.taskDescription, {
      namespace: 'tasks',
      limit: 5,
      minScore: 0.6,
    });

    if (!results || results.length === 0) {
      return '';
    }

    const lines: string[] = ['**Similar past tasks:**'];
    for (const r of results) {
      const label = (r.metadata?.['title'] as string) ?? r.value.slice(0, 80);
      lines.push(`- (${(r.score * 100).toFixed(0)}%) ${label}`);
    }

    return this.truncateToTokens(lines.join('\n'), this.maxTokens);
  }
}
