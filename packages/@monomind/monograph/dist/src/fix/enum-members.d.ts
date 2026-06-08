export declare function declaresExportedEnum(line: string): {
    name: string;
} | null;
export declare function findEnumDeclarationRange(lines: string[], enumName: string): [number, number] | null;
export declare function isEnumBodyEmpty(lines: string[], range: [number, number]): boolean;
export declare function removeEnumMember(source: string, memberName: string, enumName: string): string;
export interface EnumMemberFix {
    filePath: string;
    enumName: string;
    memberName: string;
}
export interface EnumMemberFixResult {
    fixed: EnumMemberFix[];
    errors: Array<{
        fix: EnumMemberFix;
        error: string;
    }>;
}
export declare function fixEnumMembers(fixes: EnumMemberFix[]): EnumMemberFixResult;
//# sourceMappingURL=enum-members.d.ts.map