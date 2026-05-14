/**
 * Package validator for update compatibility
 * Ensures updates don't break the ecosystem
 */
export interface ValidationResult {
    valid: boolean;
    incompatibilities: string[];
    warnings: string[];
    requiredPeerUpdates: string[];
}
export declare function validateUpdate(packageName: string, fromVersion: string, toVersion: string, installedPackages: Record<string, string>): ValidationResult;
export declare function validateBulkUpdate(updates: Array<{
    package: string;
    from: string;
    to: string;
}>, currentPackages: Record<string, string>): ValidationResult;
//# sourceMappingURL=validator.d.ts.map