export function isUnusedImportBinding(importedName, accessedMembers) {
    return !accessedMembers.has(importedName);
}
export function extractAccessedMembers(usages) {
    const members = new Set();
    let hasNamespaceAccess = false;
    for (const usage of usages) {
        const dotIdx = usage.indexOf('.');
        if (dotIdx === -1) {
            hasNamespaceAccess = true;
        }
        else {
            const member = usage.slice(dotIdx + 1);
            if (member)
                members.add(member);
        }
    }
    return { members, hasNamespaceAccess };
}
export function markAllExportsReferenced(exports) {
    return new Set(exports);
}
export function markMemberExportsReferenced(exports, accessed) {
    if (accessed.hasNamespaceAccess) {
        return new Set(exports);
    }
    const result = new Set();
    for (const exp of exports) {
        if (accessed.members.has(exp)) {
            result.add(exp);
        }
    }
    return result;
}
//# sourceMappingURL=narrowing.js.map