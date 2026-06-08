import type Database from 'better-sqlite3';
export interface SarifRule {
    id: string;
    name: string;
    shortDescription: {
        text: string;
    };
    fullDescription: {
        text: string;
    };
    helpUri?: string;
}
export interface SarifResult {
    ruleId: string;
    level: 'error' | 'warning' | 'note';
    message: {
        text: string;
    };
    locations: Array<{
        physicalLocation: {
            artifactLocation: {
                uri: string;
            };
            region?: {
                startLine: number;
            };
        };
    }>;
    fingerprints?: {
        'monograph/v1': string;
    };
}
export interface SarifDocument {
    $schema: string;
    version: '2.1.0';
    runs: [
        {
            tool: {
                driver: {
                    name: string;
                    version: string;
                    rules: SarifRule[];
                };
            };
            results: SarifResult[];
        }
    ];
}
export declare function exportSarif(db: Database.Database, repoRoot: string): SarifDocument;
export interface SarifHealthFinding {
    filePath: string;
    functionName: string;
    startLine: number;
    endLine: number;
    ruleId: string;
    message: string;
    severity: 'error' | 'warning' | 'note';
}
export declare function exportHealthSarif(findings: SarifHealthFinding[], root?: string): SarifDocument;
//# sourceMappingURL=sarif.d.ts.map