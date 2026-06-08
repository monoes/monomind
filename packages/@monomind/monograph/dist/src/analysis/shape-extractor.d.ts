export interface RouteShape {
    returnedKeys: string[];
    accessedKeys: string[];
    mismatches: string[];
    extra: string[];
    status: 'MATCH' | 'MISMATCH' | 'UNKNOWN';
}
/**
 * Scan source code for patterns that indicate JSON response keys:
 *   `.json({ key1: ..., key2: ... })`
 *   `NextResponse.json({ key: ... })`
 *   `return { key1: ..., key2: ... }`
 *
 * Returns unique keys sorted alphabetically. Returns [] if no patterns found.
 */
export declare function extractHandlerReturnKeys(source: string): string[];
/**
 * Scan source code for property accesses on known response variable names:
 *   `data.key`
 *   `const { key1, key2 } = data`
 *
 * `varNames` defaults to common response variable names if not supplied.
 * Returns unique keys sorted alphabetically.
 */
export declare function extractAccessedKeys(source: string, varNames?: string[]): string[];
/**
 * Compare what a handler returns vs what consumers access.
 *
 * - MATCH: all accessed keys are present in returned keys
 * - MISMATCH: one or more accessed keys are missing from returned keys
 * - UNKNOWN: either set is empty
 */
export declare function compareShapes(returnedKeys: string[], accessedKeys: string[]): RouteShape;
//# sourceMappingURL=shape-extractor.d.ts.map