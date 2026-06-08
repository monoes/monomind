export interface CodeOwnerRuleMatch {
    ownerCount: number;
    owners: string[];
    sectionName: string | null;
    matchedRule: string;
}
export interface SectionMatch {
    sectionName: string | null;
    sectionOwners: string[];
    matchedRule: string;
}
export interface CodeOwnersLike {
    ownerAndRuleOf?: (path: string) => CodeOwnerRuleMatch | null;
    sectionAndOwnersOf?: (path: string) => SectionMatch | null;
    hasSections?: boolean;
    ownersOf: (path: string) => string[] | null;
}
export declare const UNOWNED_LABEL = "(unowned)";
export declare const NO_SECTION_LABEL = "(no section)";
export declare function ownerCountOf(co: CodeOwnersLike, relativePath: string): number | null;
export declare function sectionOf(co: CodeOwnersLike, relativePath: string): string | null | undefined;
export declare function sectionAndOwnersOf(co: CodeOwnersLike, relativePath: string): SectionMatch | null;
export declare function hasGitLabSections(co: CodeOwnersLike): boolean;
export declare function ownerLabel(co: CodeOwnersLike, relativePath: string): string;
//# sourceMappingURL=codeowners-extended.d.ts.map