/**
 * CLI Smart Error Suggestions
 * Levenshtein distance and command suggestions
 *
 * github.com/monoes/monomind
 */
/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a, b) {
    const m = a.length;
    const n = b.length;
    // Early termination for empty strings
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    // Bound input length — the Wagner-Fischer matrix is O(m × n) memory.
    // Without this cap, any caller that passes a long stdin-derived string
    // (shell completion of a malformed command, untrusted CLI arg) can OOM
    // the process. For ranking purposes the worst-case distance is `max(m,n)`,
    // so returning that is safe.
    const MAX_LEN = 256;
    if (m > MAX_LEN || n > MAX_LEN || Math.abs(m - n) > 64) {
        return Math.max(m, n);
    }
    // Create distance matrix
    const d = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    // Initialize first column
    for (let i = 0; i <= m; i++) {
        d[i][0] = i;
    }
    // Initialize first row
    for (let j = 0; j <= n; j++) {
        d[0][j] = j;
    }
    // Fill in the rest of the matrix
    for (let j = 1; j <= n; j++) {
        for (let i = 1; i <= m; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, // deletion
            d[i][j - 1] + 1, // insertion
            d[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return d[m][n];
}
/**
 * Calculate similarity score (0-1) between two strings
 */
export function similarityScore(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0)
        return 1;
    const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
    return 1 - distance / maxLen;
}
/**
 * Find similar strings from a list
 */
export function findSimilar(input, candidates, options = {}) {
    const { maxSuggestions = 3, minSimilarity = 0.4, maxDistance = 3 } = options;
    const inputLower = input.toLowerCase();
    // Score all candidates
    const scored = candidates
        .map(candidate => ({
        candidate,
        distance: levenshteinDistance(inputLower, candidate.toLowerCase()),
        similarity: similarityScore(inputLower, candidate),
        // Boost prefix matches
        prefixBoost: candidate.toLowerCase().startsWith(inputLower) ? 0.3 : 0
    }))
        .filter(s => s.distance <= maxDistance || s.similarity >= minSimilarity)
        .map(s => ({
        ...s,
        score: s.similarity + s.prefixBoost
    }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSuggestions);
    return scored.map(s => s.candidate);
}
/**
 * Format suggestion message for CLI errors
 */
export function formatSuggestion(invalidInput, suggestions, context = 'command') {
    if (suggestions.length === 0) {
        return '';
    }
    const contextMap = {
        command: 'Did you mean',
        subcommand: 'Available subcommands',
        option: 'Did you mean',
        value: 'Valid values'
    };
    const prefix = contextMap[context];
    if (suggestions.length === 1) {
        return `\n  ${prefix}: ${suggestions[0]}`;
    }
    return `\n  ${prefix}:\n${suggestions.map(s => `    - ${s}`).join('\n')}`;
}
/**
 * Common typos and their corrections
 */
export const COMMON_TYPOS = {
    'init': 'init',
    'initi': 'init',
    'inizialize': 'init',
    'staus': 'status',
    'stauts': 'status',
    'stats': 'stats',
    'stat': 'status',
    'swarrm': 'swarm',
    'swarn': 'swarm',
    'agnet': 'agent',
    'agen': 'agent',
    'memroy': 'memory',
    'mem': 'memory',
    'memmory': 'memory',
    'confg': 'config',
    'conf': 'config',
    'configu': 'config',
    'hook': 'hooks',
    'hoks': 'hooks',
    'hive': 'hive-mind',
    'hivemind': 'hive-mind',
    'hive_mind': 'hive-mind',
    'neurl': 'neural',
    'nueral': 'neural',
    'securty': 'security',
    'sec': 'security',
    'perf': 'performance',
    'performace': 'performance',
    'provider': 'providers',
    'dep': 'deployment',
    'depoly': 'deployment',
    'deploy': 'deployment',
    'claim': 'claims',
    'embed': 'embeddings',
    'embeding': 'embeddings',
    'daemon': 'daemon',
    'deamon': 'daemon',
    'doc': 'doctor',
    'docter': 'doctor',
    'complete': 'completions',
    'completion': 'completions',
    'comp': 'completions',
    'task': 'task',
    'taks': 'task',
    'sessio': 'session',
    'sess': 'session',
    'sesssion': 'session',
    'workflow': 'workflow',
    'wf': 'workflow',
    'wokflow': 'workflow'
};
/**
 * Get corrected command if it's a common typo
 */
export function getTypoCorrection(input) {
    return COMMON_TYPOS[input.toLowerCase()];
}
/**
 * Smart command suggestion for unknown commands
 */
export function suggestCommand(unknownCommand, availableCommands) {
    // Check for common typo first
    const correction = getTypoCorrection(unknownCommand);
    if (correction && availableCommands.includes(correction)) {
        return {
            correction,
            suggestions: [correction],
            message: `Did you mean "${correction}"?`
        };
    }
    // Find similar commands
    const suggestions = findSimilar(unknownCommand, availableCommands, {
        maxSuggestions: 3,
        minSimilarity: 0.3,
        maxDistance: 4
    });
    if (suggestions.length === 0) {
        return {
            suggestions: [],
            message: 'Run "monomind --help" to see available commands.'
        };
    }
    if (suggestions.length === 1) {
        return {
            suggestions,
            message: `Did you mean "${suggestions[0]}"?`
        };
    }
    return {
        suggestions,
        message: `Did you mean one of these?\n${suggestions.map(s => `  - ${s}`).join('\n')}`
    };
}
export default {
    levenshteinDistance,
    similarityScore,
    findSimilar,
    formatSuggestion,
    suggestCommand,
    getTypoCorrection,
    COMMON_TYPOS
};
//# sourceMappingURL=suggest.js.map