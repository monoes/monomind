const IMPORT_RE = /^(import\s|export\s*\{[^}]*\}\s*from)/;
const FUNCTION_RE = /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/;
const CLASS_RE = /^(export\s+)?(abstract\s+)?class\s+\w+/;
const COMMENT_RE = /^(\/\/|\/\*| \*)/;
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function classifyLine(line) {
    const trimmed = line.trimStart();
    if (IMPORT_RE.test(trimmed))
        return 'import';
    if (FUNCTION_RE.test(trimmed))
        return 'function';
    if (CLASS_RE.test(trimmed))
        return 'class';
    if (COMMENT_RE.test(trimmed))
        return 'comment';
    return 'other';
}
function groupLines(sourceLines) {
    const groups = [];
    let i = 0;
    while (i < sourceLines.length) {
        const line = sourceLines[i];
        const trimmed = line.trim();
        // Skip blank lines (treat them as other with 0 tokens — they'll be filtered)
        if (trimmed === '') {
            i++;
            continue;
        }
        const kind = classifyLine(trimmed);
        // For groupable kinds (import, comment), collect consecutive matching lines
        if (kind === 'import' || kind === 'comment') {
            const startIdx = i;
            const collected = [line];
            i++;
            while (i < sourceLines.length) {
                const next = sourceLines[i].trim();
                if (next === '')
                    break;
                const nextKind = classifyLine(next);
                if (nextKind === kind) {
                    collected.push(sourceLines[i]);
                    i++;
                }
                else {
                    break;
                }
            }
            groups.push({ lines: collected, startLine: startIdx + 1, kind });
        }
        else if (kind === 'function' || kind === 'class') {
            // Collect the block: track brace depth
            const startIdx = i;
            const collected = [line];
            i++;
            let depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            // If no opening brace on the first line yet, keep reading until we have one
            while (i < sourceLines.length && depth <= 0) {
                const cur = sourceLines[i];
                collected.push(cur);
                depth += (cur.match(/\{/g) || []).length - (cur.match(/\}/g) || []).length;
                i++;
            }
            // Now consume until depth returns to 0
            while (i < sourceLines.length && depth > 0) {
                const cur = sourceLines[i];
                collected.push(cur);
                depth += (cur.match(/\{/g) || []).length - (cur.match(/\}/g) || []).length;
                i++;
            }
            groups.push({ lines: collected, startLine: startIdx + 1, kind });
        }
        else {
            // 'other': collect consecutive non-blank other lines into one group
            const startIdx = i;
            const collected = [line];
            i++;
            while (i < sourceLines.length) {
                const next = sourceLines[i].trim();
                if (next === '')
                    break;
                const nextKind = classifyLine(next);
                if (nextKind === 'other') {
                    collected.push(sourceLines[i]);
                    i++;
                }
                else {
                    break;
                }
            }
            groups.push({ lines: collected, startLine: startIdx + 1, kind });
        }
    }
    return groups;
}
function splitGroupIntoChunks(group, maxTokens, overlap) {
    const lines = group.lines;
    const result = [];
    // Tokens per line (estimated)
    const lineTokens = lines.map(l => estimateTokens(l));
    let start = 0; // index into lines[]
    while (start < lines.length) {
        let tokenCount = 0;
        let end = start;
        while (end < lines.length && tokenCount + lineTokens[end] <= maxTokens) {
            tokenCount += lineTokens[end];
            end++;
        }
        // If we couldn't advance even one line (single line exceeds maxTokens), force include it
        if (end === start) {
            end = start + 1;
        }
        const chunkLines = lines.slice(start, end);
        const text = chunkLines.join('\n');
        const startLine = group.startLine + start;
        const endLine = group.startLine + end - 1;
        result.push({ text, startLine, endLine, kind: group.kind });
        if (end >= lines.length)
            break;
        // Calculate how many lines from the end of this chunk to include as overlap
        // for the next chunk's start. Count back until overlap token budget is met.
        let overlapTokens = 0;
        let overlapLineCount = 0;
        for (let j = end - 1; j >= start; j--) {
            if (overlapTokens + lineTokens[j] > overlap)
                break;
            overlapTokens += lineTokens[j];
            overlapLineCount++;
        }
        // Next start is (end - overlapLineCount), but must be strictly > start to avoid looping
        const nextStart = Math.max(start + 1, end - overlapLineCount);
        start = nextStart;
    }
    return result;
}
export function chunkSource(source, options) {
    const maxTokens = options?.maxTokens ?? 512;
    const overlap = options?.overlap ?? 50;
    const minTokens = options?.minTokens ?? 5;
    if (!source || source.trim() === '')
        return [];
    const sourceLines = source.split('\n');
    const groups = groupLines(sourceLines);
    const chunks = [];
    for (const group of groups) {
        const text = group.lines.join('\n');
        const tokens = estimateTokens(text);
        if (tokens <= maxTokens) {
            chunks.push({
                text,
                startLine: group.startLine,
                endLine: group.startLine + group.lines.length - 1,
                kind: group.kind,
            });
        }
        else {
            // Split into sub-chunks with overlap
            const subChunks = splitGroupIntoChunks(group, maxTokens, overlap);
            chunks.push(...subChunks);
        }
    }
    // Discard chunks below minTokens
    return chunks.filter(c => estimateTokens(c.text) >= minTokens);
}
//# sourceMappingURL=ast-chunker.js.map