/**
 * Parse a JSONL (newline-delimited JSON) string, skipping malformed lines.
 * Never throws — bad lines are silently dropped.
 */
export function parseJsonl(content) {
    if (!content.trim())
        return [];
    return content
        .split('\n')
        .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return [];
        try {
            return [JSON.parse(trimmed)];
        }
        catch {
            return [];
        }
    });
}
//# sourceMappingURL=parse-jsonl.js.map