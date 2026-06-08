const NON_CORE_KINDS = new Set([
    'complexity', 'coverage-gaps', 'feature-flag', 'code-duplication',
    'unused-dependency', 'unused-dev-dependency', 'unlisted-dependency',
    'type-only-dependency', 'test-only-dependency', 'stale-suppression',
]);
export class SuppressionContext {
    byFile;
    constructor(modules) {
        this.byFile = new Map();
        for (const m of modules) {
            if (m.suppressions.length > 0) {
                this.byFile.set(m.filePath, { suppressions: m.suppressions, used: new Array(m.suppressions.length).fill(false) });
            }
        }
    }
    isSuppressed(filePath, line, kind) {
        const rec = this.byFile.get(filePath);
        if (!rec)
            return false;
        for (let i = 0; i < rec.suppressions.length; i++) {
            const s = rec.suppressions[i];
            const matched = s.line === 0 ? (s.kind === null || s.kind === kind) : (s.line === line && (s.kind === null || s.kind === kind));
            if (matched) {
                rec.used[i] = true;
                return true;
            }
        }
        return false;
    }
    isFileSuppressed(filePath, kind) {
        const rec = this.byFile.get(filePath);
        if (!rec)
            return false;
        for (let i = 0; i < rec.suppressions.length; i++) {
            const s = rec.suppressions[i];
            if (s.line === 0 && (s.kind === null || s.kind === kind)) {
                rec.used[i] = true;
                return true;
            }
        }
        return false;
    }
    get(filePath) { return this.byFile.get(filePath)?.suppressions; }
    usedCount() {
        let n = 0;
        for (const rec of this.byFile.values())
            n += rec.used.filter(Boolean).length;
        return n;
    }
    findStale() {
        const stale = [];
        for (const [filePath, rec] of this.byFile) {
            for (let i = 0; i < rec.suppressions.length; i++) {
                if (rec.used[i])
                    continue;
                const s = rec.suppressions[i];
                if (s.kind !== null && NON_CORE_KINDS.has(s.kind))
                    continue;
                stale.push({ path: filePath, line: s.commentLine, col: 0, isFileLevel: s.line === 0, issueKind: s.kind });
            }
        }
        return stale;
    }
}
export function isSuppressed(suppressions, line, kind) {
    return suppressions.some(s => s.line === 0 ? (s.kind === null || s.kind === kind) : (s.line === line && (s.kind === null || s.kind === kind)));
}
export function isFileSuppressed(suppressions, kind) {
    return suppressions.some(s => s.line === 0 && (s.kind === null || s.kind === kind));
}
//# sourceMappingURL=suppression-context.js.map