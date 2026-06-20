export declare const UNOWNED_LABEL = "UNOWNED";
export declare const NO_SECTION_LABEL = "(no section)";
export declare const CODEOWNERS_PROBE_PATHS: string[];
export interface SectionHeader {
    name: string;
    optional: boolean;
    minApprovals?: number;
    defaultOwners: string[];
}
export declare function parseSectionHeader(line: string): SectionHeader | null;
export interface CodeownersEntry {
    pattern: string;
    owners: string[];
    section?: string;
    negated: boolean;
}
export declare function parseCodeownersWithSections(content: string): CodeownersEntry[];
export declare function matchOwners(entries: CodeownersEntry[], filePath: string): {
    owners: string[];
    section?: string;
};
/** Single-call helper — avoids triple matchOwners invocations when callers need all three fields. */
export declare function singleFileOwnership(entries: CodeownersEntry[], filePath: string): {
    section: string;
    owners: string[];
    ownerCount: number;
};
export declare function ownerCountOf(entries: CodeownersEntry[], filePath: string): number;
export declare function sectionOf(entries: CodeownersEntry[], filePath: string): string;
export declare function sectionAndOwnersOf(entries: CodeownersEntry[], filePath: string): {
    section: string;
    owners: string[];
};
export declare function hasSections(entries: CodeownersEntry[]): boolean;
export interface CodeownersGitlabReport {
    totalEntries: number;
    hasSections: boolean;
    sectionNames: string[];
    ownershipSummary: Array<{
        file: string;
        section: string;
        owners: string[];
    }>;
}
/**
 * Format a batch file-ownership report for LLM consumption.
 * Uses singleFileOwnership() to avoid N*3 matchOwners scans.
 */
export declare function formatCodeownersGitlab(entries: CodeownersEntry[], filePaths: string[]): string;
//# sourceMappingURL=codeowners-gitlab.d.ts.map