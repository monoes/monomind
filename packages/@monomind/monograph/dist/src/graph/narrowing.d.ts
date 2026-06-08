export interface AccessedMembers {
    members: Set<string>;
    hasNamespaceAccess: boolean;
}
export declare function isUnusedImportBinding(importedName: string, accessedMembers: Set<string>): boolean;
export declare function extractAccessedMembers(usages: string[]): AccessedMembers;
export declare function markAllExportsReferenced(exports: string[]): Set<string>;
export declare function markMemberExportsReferenced(exports: string[], accessed: AccessedMembers): Set<string>;
//# sourceMappingURL=narrowing.d.ts.map