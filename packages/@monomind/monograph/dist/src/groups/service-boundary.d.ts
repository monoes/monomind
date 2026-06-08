export interface ServiceBoundary {
    /** Absolute path to the service root directory */
    servicePath: string;
    /** Derived service name (directory name) */
    serviceName: string;
    /** List of marker filenames found in this service directory */
    markers: string[];
    /** Confidence score 0–1 based on number/weight of markers found */
    confidence: number;
}
/**
 * Walk a root directory and identify service boundaries by looking for
 * well-known manifest/configuration files in each immediate subdirectory.
 *
 * Only examines one level deep (immediate children of rootDir) to avoid
 * false positives from nested node_modules or dist directories.
 *
 * @param rootDir - Root directory to scan (e.g., monorepo root)
 * @returns Array of detected service boundaries
 */
export declare function detectServiceBoundaries(rootDir: string): ServiceBoundary[];
/**
 * Determine which service boundary a given file belongs to.
 *
 * @param filePath - Absolute path to the file
 * @param boundaries - List of detected service boundaries
 * @returns The matching ServiceBoundary, or undefined if none match
 */
export declare function assignService(filePath: string, boundaries: ServiceBoundary[]): ServiceBoundary | undefined;
//# sourceMappingURL=service-boundary.d.ts.map