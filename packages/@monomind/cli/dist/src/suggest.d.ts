/**
 * CLI Smart Error Suggestions
 * Levenshtein distance and command suggestions
 *
 * github.com/monoes/monomind
 */
/**
 * Calculate Levenshtein distance between two strings
 */
export declare function levenshteinDistance(a: string, b: string): number;
/**
 * Calculate similarity score (0-1) between two strings
 */
export declare function similarityScore(a: string, b: string): number;
/**
 * Find similar strings from a list
 */
export declare function findSimilar(input: string, candidates: string[], options?: {
    maxSuggestions?: number;
    minSimilarity?: number;
    maxDistance?: number;
}): string[];
/**
 * Format suggestion message for CLI errors
 */
export declare function formatSuggestion(invalidInput: string, suggestions: string[], context?: 'command' | 'subcommand' | 'option' | 'value'): string;
/**
 * Common typos and their corrections
 */
export declare const COMMON_TYPOS: Record<string, string>;
/**
 * Get corrected command if it's a common typo
 */
export declare function getTypoCorrection(input: string): string | undefined;
/**
 * Smart command suggestion for unknown commands
 */
export declare function suggestCommand(unknownCommand: string, availableCommands: string[]): {
    correction?: string;
    suggestions: string[];
    message: string;
};
declare const _default: {
    levenshteinDistance: typeof levenshteinDistance;
    similarityScore: typeof similarityScore;
    findSimilar: typeof findSimilar;
    formatSuggestion: typeof formatSuggestion;
    suggestCommand: typeof suggestCommand;
    getTypoCorrection: typeof getTypoCorrection;
    COMMON_TYPOS: Record<string, string>;
};
export default _default;
//# sourceMappingURL=suggest.d.ts.map