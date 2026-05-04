// Configuration types for suppressing unused-class-member findings.

export type UsedClassMemberRuleKind = 'name' | 'scoped';

export interface ScopedUsedClassMemberRule {
  extends?: string[];
  implements?: string[];
  members: string[];
}

export type UsedClassMemberRule =
  | { kind: 'name'; pattern: string }
  | { kind: 'scoped'; rule: ScopedUsedClassMemberRule };

export function nameRule(pattern: string): UsedClassMemberRule {
  return { kind: 'name', pattern };
}

export function scopedRule(rule: ScopedUsedClassMemberRule): UsedClassMemberRule {
  return { kind: 'scoped', rule };
}

export function matchesHeritage(
  rule: ScopedUsedClassMemberRule,
  classExtends: string[],
  classImplements: string[],
): boolean {
  const extendsMatch = !rule.extends?.length || rule.extends.some(e => classExtends.includes(e));
  const implMatch = !rule.implements?.length || rule.implements.some(i => classImplements.includes(i));
  return extendsMatch && implMatch;
}

export function isMemberSuppressed(
  rules: UsedClassMemberRule[],
  memberName: string,
  classExtends: string[] = [],
  classImplements: string[] = [],
): boolean {
  for (const rule of rules) {
    if (rule.kind === 'name') {
      if (memberName === rule.pattern || memberMatchesGlob(memberName, rule.pattern)) return true;
    } else {
      if (matchesHeritage(rule.rule, classExtends, classImplements) && rule.rule.members.includes(memberName)) return true;
    }
  }
  return false;
}

function memberMatchesGlob(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(name);
}
