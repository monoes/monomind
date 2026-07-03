import { describe, it, expect } from 'vitest';
import { formatSearchResults, groupByType } from '../../src/commands/search-universal.js';
import type { SearchResult } from '../../src/capabilities/types.js';

describe('search formatting', () => {
  it('groups results by type', () => {
    const results: SearchResult[] = [
      { path: 'report.pdf', score: 0.9, snippet: 'quarterly report', type: 'documents' },
      { path: 'photo.jpg', score: 0.7, snippet: 'office photo', type: 'media' },
      { path: 'report2.md', score: 0.6, snippet: 'meeting notes', type: 'documents' },
    ];

    const grouped = groupByType(results);
    expect(grouped.documents?.length).toBe(2);
    expect(grouped.media?.length).toBe(1);
  });

  it('formats results with type headers', () => {
    const results: SearchResult[] = [
      { path: 'report.pdf', score: 0.9, snippet: 'quarterly report', type: 'documents' },
    ];

    const output = formatSearchResults(results);
    expect(output).toContain('Documents');
    expect(output).toContain('report.pdf');
    expect(output).toContain('quarterly report');
  });

  it('returns empty message when no results', () => {
    const output = formatSearchResults([]);
    expect(output).toContain('No results');
  });
});
