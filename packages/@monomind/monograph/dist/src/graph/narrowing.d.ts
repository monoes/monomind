export interface AccessedMembers {
    members: Set<string>;
    hasNamespaceAccess: boolean;
}
export declare function isUnusedImportBinding(importedName: string, accessedMembers: Set<string>): boolean;
export declare function extractAccessedMembers(usages: string[]): AccessedMembers;
export declare function markAllExportsReferenced(exports: string[]): Set<string>;
export declare function markMemberExportsReferenced(exports: string[], accessed: AccessedMembers): Set<string>;
export interface NarrowingReport {
    filePath: string;
    totalExports: number;
    referencedExports: string[];
    unusedExports: string[];
}
/**
 * Given a file's exports and the accessed members from all import sites,
 * return a report of which exports are unused.
 */
export declare function filterUnusedExports(filePath: string, exports: string[], accessed: AccessedMembers): NarrowingReport;
/**
 * Format narrowing reports as structured text for LLM dead-import diagnostics.
 */
export declare function formatNarrowingReport(reports: NarrowingReport[]): string;
//# sourceMappingURL=narrowing.d.ts.map