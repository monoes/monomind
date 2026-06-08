const TS_DECORATOR_RE = /^([ \t]*)@([\w.]+)([ \t]*\()?/gm;
const PY_DECORATOR_RE = /^([ \t]*)@([\w.]+)([ \t]*\()?/gm;
const JAVA_ANNOTATION_RE = /^([ \t]*)@([A-Z]\w*)([ \t]*\()?/gm;
function extractWithRegex(source, filePath, re) {
    const results = [];
    const lines = source.split('\n');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
        const charsBefore = source.slice(0, m.index);
        const lineNum = (charsBefore.match(/\n/g)?.length ?? 0) + 1;
        const nextLine = lines[lineNum] ?? '';
        let targetName = null;
        const targetMatch = /(?:class|def|function|public|private|protected|export)\s+(\w+)/.exec(nextLine);
        if (targetMatch)
            targetName = targetMatch[1] ?? null;
        results.push({
            decoratorName: m[2],
            targetName,
            hasArguments: !!m[3]?.trim(),
            line: lineNum,
            filePath,
        });
    }
    return results;
}
export function extractNamedBindings(source, filePath, language) {
    switch (language) {
        case 'typescript':
        case 'javascript':
            return extractWithRegex(source, filePath, TS_DECORATOR_RE);
        case 'python':
            return extractWithRegex(source, filePath, PY_DECORATOR_RE);
        case 'java':
        case 'kotlin':
            return extractWithRegex(source, filePath, JAVA_ANNOTATION_RE);
        default:
            return [];
    }
}
//# sourceMappingURL=named-bindings.js.map