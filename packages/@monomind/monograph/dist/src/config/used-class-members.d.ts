export type UsedClassMemberRuleKind = 'name' | 'scoped';
export interface ScopedUsedClassMemberRule {
    extends?: string[];
    implements?: string[];
    members: string[];
}
export type UsedClassMemberRule = {
    kind: 'name';
    pattern: string;
} | {
    kind: 'scoped';
    rule: ScopedUsedClassMemberRule;
};
export declare function nameRule(pattern: string): UsedClassMemberRule;
export declare function scopedRule(rule: ScopedUsedClassMemberRule): UsedClassMemberRule;
export declare function matchesHeritage(rule: ScopedUsedClassMemberRule, classExtends: string[], classImplements: string[]): boolean;
export declare function isMemberSuppressed(rules: UsedClassMemberRule[], memberName: string, classExtends?: string[], classImplements?: string[]): boolean;
//# sourceMappingURL=used-class-members.d.ts.map