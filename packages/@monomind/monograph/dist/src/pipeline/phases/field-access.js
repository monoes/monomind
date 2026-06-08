function escapeRegexChars(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function extractFieldAccesses(source, varName, filePath) {
    const results = [];
    const lines = source.split('\n');
    const escapedName = escapeRegexChars(varName);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Write: varName.field = or varName.field +=/-=/*=
        const writeRe = new RegExp(`\\b${escapedName}\\.(\\w+)\\s*(?:\\+|-|\\*|\\/|%)?=(?!=)`, 'g');
        // Read: varName.field NOT followed by assignment operator
        const readRe = new RegExp(`\\b${escapedName}\\.(\\w+)`, 'g');
        const writeFields = new Set();
        let m;
        while ((m = writeRe.exec(line)) !== null) {
            writeFields.add(m[1]);
            results.push({ varName, field: m[1], reason: 'write', line: i + 1 });
        }
        while ((m = readRe.exec(line)) !== null) {
            if (!writeFields.has(m[1])) {
                results.push({ varName, field: m[1], reason: 'read', line: i + 1 });
            }
        }
    }
    return results;
}
//# sourceMappingURL=field-access.js.map