/**
 * Context Provider — interfaces and base class for dynamic prompt assembly.
 *
 * Each provider contributes a named section of context to the assembled prompt.
 * Providers are prioritised (0-100) and budget-aware via token estimation.
 */
/**
 * Convenience base class that implements the ContextProvider contract and
 * supplies a rough token-truncation helper (approx 4 chars per token).
 */
export class BaseContextProvider {
    maxTokens = 500;
    required = false;
    /**
     * Truncate `text` so that it fits within `maxTokens` (4 chars/token).
     */
    truncateToTokens(text, maxTokens) {
        const maxChars = maxTokens * 4;
        if (text.length <= maxChars) {
            return text;
        }
        return text.slice(0, maxChars);
    }
}
//# sourceMappingURL=context-provider.js.map