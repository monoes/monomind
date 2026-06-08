export const UNOWNED_LABEL = '(unowned)';
export const NO_SECTION_LABEL = '(no section)';
export function ownerCountOf(co, relativePath) {
    if (co.ownerAndRuleOf) {
        const match = co.ownerAndRuleOf(relativePath);
        if (!match)
            return null;
        return match.ownerCount;
    }
    const owners = co.ownersOf(relativePath);
    if (owners === null)
        return null;
    return owners.length;
}
export function sectionOf(co, relativePath) {
    if (!co.sectionAndOwnersOf)
        return undefined;
    const match = co.sectionAndOwnersOf(relativePath);
    if (!match)
        return undefined;
    return match.sectionName;
}
export function sectionAndOwnersOf(co, relativePath) {
    if (!co.sectionAndOwnersOf)
        return null;
    return co.sectionAndOwnersOf(relativePath) ?? null;
}
export function hasGitLabSections(co) {
    return co.hasSections ?? false;
}
export function ownerLabel(co, relativePath) {
    const owners = co.ownersOf(relativePath);
    if (owners === null)
        return UNOWNED_LABEL;
    if (owners.length === 0) {
        const section = sectionOf(co, relativePath);
        if (section === null)
            return NO_SECTION_LABEL;
        return UNOWNED_LABEL;
    }
    return owners[0];
}
//# sourceMappingURL=codeowners-extended.js.map