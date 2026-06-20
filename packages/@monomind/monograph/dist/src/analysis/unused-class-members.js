// Detect unused class methods and properties (distinct from enum members).
export function isClassMemberSuppressed(member, allowlist, classHeritage) {
    for (const entry of allowlist) {
        const nameMatch = member.memberName === entry.pattern || memberGlobMatch(member.memberName, entry.pattern);
        if (!nameMatch)
            continue;
        const extMatch = !entry.classExtends?.length || entry.classExtends.some(e => classHeritage.extends.includes(e));
        const implMatch = !entry.classImplements?.length || entry.classImplements.some(i => classHeritage.implements.includes(i));
        if (extMatch && implMatch)
            return true;
    }
    return false;
}
// Cache compiled glob regexes to avoid re-compilation on repeated allowlist checks
const _globReCache = new Map();
function memberGlobMatch(name, pattern) {
    if (!pattern.includes('*'))
        return name === pattern;
    let re = _globReCache.get(pattern);
    if (!re) {
        re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        _globReCache.set(pattern, re);
    }
    return re.test(name);
}
export function summarizeUnusedMembers(members) {
    const files = new Set(members.map(m => m.filePath));
    return {
        unusedMembers: members,
        totalScanned: members.length,
        filesAffected: files.size,
    };
}
export function groupUnusedMembersByFile(members) {
    const map = new Map();
    for (const m of members) {
        if (!map.has(m.filePath))
            map.set(m.filePath, []);
        map.get(m.filePath).push(m);
    }
    return map;
}
export function formatUnusedMembersReport(result) {
    if (result.unusedMembers.length === 0)
        return 'No unused class members found.';
    const lines = [`${result.unusedMembers.length} unused class member(s) in ${result.filesAffected} file(s):`];
    for (const m of result.unusedMembers) {
        lines.push(`  ${m.filePath}:${m.line} — ${m.parentName}.${m.memberName} (${m.kind})`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=unused-class-members.js.map