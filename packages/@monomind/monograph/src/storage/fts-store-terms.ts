// ── Intent-to-identifier extraction ──────────────────────────────────────────
// File-size sweep: split out of fts-store.ts.

export const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',
  'am',
  'it',
  'its',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'their',
  'this',
  'that',
  'these',
  'those',
  'of',
  'in',
  'to',
  'for',
  'with',
  'on',
  'at',
  'from',
  'by',
  'about',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'out',
  'off',
  'over',
  'under',
  'again',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'both',
  'each',
  'every',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'because',
  'but',
  'and',
  'or',
  'if',
  'while',
  'what',
  'which',
  'who',
  'whom',
  'up',
  'down',
  'get',
  'set',
  'add',
  'use',
  'find',
  'show',
  'make',
  'let',
  'want',
  'need',
  'like',
  'look',
  'also',
  'new',
  'old',
]);

/**
 * Extract code-relevant search terms from a natural-language query.
 * Strips stopwords, splits camelCase/PascalCase/snake_case, and strips
 * file extensions (so "CLAUDE.md" also tries "CLAUDE").
 * Returns an empty array when the query is already a bare identifier.
 */
export function extractSearchTerms(query: string): string[] {
  const words = query.split(/[\s,;:!?()[\]{}'"]+/).filter(Boolean);
  // If query is a single token, it's already a bare identifier query — nothing to extract.
  // (We used to also bail out for short, stopword-free multi-token queries under the
  // assumption they were "already an identifier query", but that misfires for queries
  // like "ExtensionBridge keepalive reconnect" — three distinct identifier-ish tokens
  // that FTS5 MATCH ANDs together and fails to find as a single row. Since this function
  // only runs as a fallback after the raw MATCH already returned zero rows, there's no
  // extra cost to always extracting terms for multi-token queries.)
  if (words.length <= 1) return [];

  const terms = new Set<string>();
  for (const word of words) {
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    if (word.length < 3) continue;

    // Strip file extensions: "CLAUDE.md" → also add "CLAUDE"
    const dotIdx = word.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < word.length - 1) {
      terms.add(word.slice(0, dotIdx));
      terms.add(word);
    }

    // Split camelCase/PascalCase: "ExtensionBridge" → "Extension", "Bridge"
    const camelParts = word
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_-]+/)
      .filter((p) => p.length >= 3 && !STOPWORDS.has(p.toLowerCase()));
    if (camelParts.length > 1) {
      for (const part of camelParts) terms.add(part);
    }

    // Keep the original word
    terms.add(word);
  }

  return Array.from(terms);
}
