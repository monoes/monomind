import { describe, it, expect } from 'vitest';
import {
  formatSearchResults,
  groupByType,
  needsCodeIndexHint,
} from '../../src/commands/search-universal.js';
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

describe('needsCodeIndexHint', () => {
  it('hints when code is active, unindexed, and search found nothing', () => {
    expect(needsCodeIndexHint(0, undefined, true, false)).toBe(true);
  });

  it('hints when the user explicitly filtered to --type code', () => {
    expect(needsCodeIndexHint(0, 'code', true, false)).toBe(true);
  });

  it('does not hint once the monograph DB exists (zero results is a real miss)', () => {
    expect(needsCodeIndexHint(0, undefined, true, true)).toBe(false);
  });

  it('does not hint when results were found', () => {
    expect(needsCodeIndexHint(3, undefined, true, false)).toBe(false);
  });

  it('does not hint when the code capability was never activated', () => {
    expect(needsCodeIndexHint(0, undefined, false, false)).toBe(false);
  });

  it('does not hint when the user filtered to a different type', () => {
    expect(needsCodeIndexHint(0, 'documents', true, false)).toBe(false);
  });
});
