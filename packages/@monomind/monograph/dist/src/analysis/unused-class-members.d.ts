export type MemberKind = 'method' | 'property' | 'getter' | 'setter' | 'staticMethod' | 'staticProperty';
export interface UnusedMember {
    filePath: string;
    parentName: string;
    memberName: string;
    kind: MemberKind;
    line: number;
    col: number;
}
export interface UnusedMembersResult {
    unusedMembers: UnusedMember[];
    totalScanned: number;
    filesAffected: number;
}
export interface ClassMemberAllowlistEntry {
    pattern: string;
    classExtends?: string[];
    classImplements?: string[];
}
export declare function isClassMemberSuppressed(member: UnusedMember, allowlist: ClassMemberAllowlistEntry[], classHeritage: {
    extends: string[];
    implements: string[];
}): boolean;
export declare function summarizeUnusedMembers(members: UnusedMember[]): UnusedMembersResult;
export declare function groupUnusedMembersByFile(members: UnusedMember[]): Map<string, UnusedMember[]>;
export declare function formatUnusedMembersReport(result: UnusedMembersResult): string;
//# sourceMappingURL=unused-class-members.d.ts.map