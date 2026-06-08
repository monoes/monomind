export const CORPUS_WARN_MIN_WORDS = 50_000;
export const CORPUS_WARN_MAX_WORDS = 500_000;
export const CORPUS_WARN_MAX_FILES = 200;
export function checkCorpusHealth(stats) {
    const warnings = [];
    if (stats.wordCount < CORPUS_WARN_MIN_WORDS) {
        warnings.push(`Corpus too small: ${stats.wordCount.toLocaleString()} words (min ${CORPUS_WARN_MIN_WORDS.toLocaleString()}). ` +
            `Results may be low-quality on toy projects.`);
    }
    if (stats.wordCount > CORPUS_WARN_MAX_WORDS) {
        warnings.push(`Corpus too large: ${stats.wordCount.toLocaleString()} words (max ${CORPUS_WARN_MAX_WORDS.toLocaleString()}). ` +
            `Consider using --code-only or filtering to a subset.`);
    }
    if (stats.fileCount > CORPUS_WARN_MAX_FILES) {
        warnings.push(`Too many files: ${stats.fileCount} (max ${CORPUS_WARN_MAX_FILES}). ` +
            `Consider using --ignore patterns to exclude generated or vendor files.`);
    }
    return { healthy: warnings.length === 0, warnings, stats };
}
//# sourceMappingURL=corpus-health.js.map