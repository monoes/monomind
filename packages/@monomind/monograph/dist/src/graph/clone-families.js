export const MODULE_EXTRACTION_THRESHOLD_LINES = 50;
function fileSetKey(files) {
    return [...files].sort().join('|');
}
function generateSuggestions(family) {
    const suggestions = [];
    const lines = family.totalDuplicatedLines;
    if (lines < MODULE_EXTRACTION_THRESHOLD_LINES) {
        suggestions.push({
            kind: 'ExtractFunction',
            description: `Extract ${lines} duplicated lines into a shared function`,
            estimatedLines: lines,
            files: family.files,
        });
    }
    else {
        // Check if all files are in the same directory → MergeDirectories
        const dirs = [...new Set(family.files.map(f => {
                const parts = f.replace(/\\/g, '/').split('/');
                return parts.slice(0, -1).join('/');
            }))];
        if (dirs.length > 1 && family.files.length >= 3) {
            suggestions.push({
                kind: 'MergeDirectories',
                description: `Consider merging ${dirs.length} directories with ${lines} shared lines`,
                estimatedLines: lines,
                files: family.files,
            });
        }
        else {
            suggestions.push({
                kind: 'ExtractModule',
                description: `Extract ${lines} duplicated lines into a shared module`,
                estimatedLines: lines,
                files: family.files,
            });
        }
    }
    return suggestions;
}
export function groupIntoFamilies(groups) {
    const familyMap = new Map();
    for (const group of groups) {
        const files = group.instances.map(i => i.filePath);
        const key = fileSetKey(files);
        if (!familyMap.has(key)) {
            familyMap.set(key, { files: new Set(files), groups: [] });
        }
        familyMap.get(key).groups.push(group);
    }
    return [...familyMap.values()].map(({ files, groups }) => {
        const fileList = [...files].sort();
        const totalDuplicatedLines = groups.reduce((s, g) => s + g.duplicatedLines, 0);
        const base = { files: fileList, groups, totalDuplicatedLines };
        return { ...base, suggestions: generateSuggestions(base) };
    }).sort((a, b) => b.totalDuplicatedLines - a.totalDuplicatedLines);
}
export function cloneFamilySummary(families) {
    const byKind = {
        ExtractFunction: 0, ExtractModule: 0, MergeDirectories: 0,
    };
    for (const f of families) {
        for (const s of f.suggestions)
            byKind[s.kind]++;
    }
    return {
        totalFamilies: families.length,
        totalDuplicatedLines: families.reduce((s, f) => s + f.totalDuplicatedLines, 0),
        byKind,
    };
}
//# sourceMappingURL=clone-families.js.map