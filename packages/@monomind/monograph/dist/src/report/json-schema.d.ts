export declare const ANALYSIS_SCHEMA_VERSION = 4;
export declare const HEALTH_SCHEMA_VERSION = 2;
export declare const RUNTIME_COVERAGE_SCHEMA_VERSION = "1";
export declare const DUPLICATION_SCHEMA_VERSION = 1;
export interface SchemaEnvelope<T = unknown> {
    $schema?: string;
    schemaVersion: number;
    generatedAt: string;
    root: string;
    data: T;
}
export declare function makeEnvelope<T>(data: T, schemaVersion: number, root: string, schemaUrl?: string): SchemaEnvelope<T>;
export declare function stripRootPrefix(obj: unknown, root: string): unknown;
export declare function injectActions(obj: Record<string, unknown>, actions: Record<string, string[]>): Record<string, unknown>;
export declare function buildAnalysisJsonEnvelope(results: unknown, root: string, regression?: unknown): SchemaEnvelope;
export declare function buildHealthJsonEnvelope(healthReport: unknown, root: string): SchemaEnvelope;
export declare function buildDuplicationJsonEnvelope(duplication: unknown, root: string): SchemaEnvelope;
//# sourceMappingURL=json-schema.d.ts.map