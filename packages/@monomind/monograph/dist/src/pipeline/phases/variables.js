// Regex for top-level variable declarations.
// We detect nesting depth by counting braces before the match.
const TOP_LEVEL_VAR = /^(export\s+)?(const|let|var)\s+(\w+)\s*[=:]/gm;
/**
 * Strip string literals, template literals, and comments from source text before
 * brace-depth counting, so braces inside those constructs don't skew the depth.
 */
function stripNonCodeBraces(src) {
    // Replace content inside single/double-quoted strings and block comments with
    // equal-length spaces (preserving offsets/line numbers), then strip line comments.
    return src
        .replace(/`[^`\\]*(?:\\[\s\S][^`\\]*)*`/g, m => ' '.repeat(m.length))
        .replace(/"(?:[^"\\]|\\.)*"/g, m => ' '.repeat(m.length))
        .replace(/'(?:[^'\\]|\\.)*'/g, m => ' '.repeat(m.length))
        .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
        .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}
export function extractVariables(source, filePath) {
    const results = [];
    let match;
    TOP_LEVEL_VAR.lastIndex = 0;
    // Pre-process: strip string/comment content so braces inside them don't count
    const stripped = stripNonCodeBraces(source);
    while ((match = TOP_LEVEL_VAR.exec(source)) !== null) {
        const before = stripped.slice(0, match.index);
        // Count brace depth — top-level means depth == 0
        let depth = 0;
        for (const ch of before) {
            if (ch === '{')
                depth++;
            else if (ch === '}')
                depth--;
        }
        if (depth !== 0)
            continue;
        const isExported = !!match[1];
        const name = match[3];
        const line = before.split('\n').length;
        results.push({ name, isExported, line, filePath });
    }
    return results;
}
export function variableToNode(v) {
    return {
        id: `var:${v.filePath}:${v.name}`,
        label: 'Variable',
        name: v.name,
        normLabel: v.name.toLowerCase(),
        filePath: v.filePath,
        startLine: v.line,
        endLine: v.line,
        isExported: v.isExported,
    };
}
//# sourceMappingURL=variables.js.map