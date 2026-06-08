// Configuration types for suppressing unused-class-member findings.
export function nameRule(pattern) {
    return { kind: 'name', pattern };
}
export function scopedRule(rule) {
    return { kind: 'scoped', rule };
}
export function matchesHeritage(rule, classExtends, classImplements) {
    const extendsMatch = !rule.extends?.length || rule.extends.some(e => classExtends.includes(e));
    const implMatch = !rule.implements?.length || rule.implements.some(i => classImplements.includes(i));
    return extendsMatch && implMatch;
}
export function isMemberSuppressed(rules, memberName, classExtends = [], classImplements = []) {
    for (const rule of rules) {
        if (rule.kind === 'name') {
            if (memberName === rule.pattern || memberMatchesGlob(memberName, rule.pattern))
                return true;
        }
        else {
            if (matchesHeritage(rule.rule, classExtends, classImplements) && rule.rule.members.includes(memberName))
                return true;
        }
    }
    return false;
}
function memberMatchesGlob(name, pattern) {
    if (!pattern.includes('*'))
        return name === pattern;
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(name);
}
//# sourceMappingURL=used-class-members.js.map