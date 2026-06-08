import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
/** Weighted service markers. Higher weight = stronger signal. */
const SERVICE_MARKERS = {
    'package.json': 1.0,
    'go.mod': 1.0,
    'Cargo.toml': 1.0,
    'pyproject.toml': 0.9,
    'setup.py': 0.8,
    'pom.xml': 1.0,
    'build.gradle': 0.9,
    'Dockerfile': 0.8,
    'docker-compose.yml': 0.7,
    'docker-compose.yaml': 0.7,
    '.gitmodules': 0.5,
};
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
export function detectServiceBoundaries(rootDir) {
    if (!existsSync(rootDir))
        return [];
    const boundaries = [];
    let entries;
    try {
        entries = readdirSync(rootDir);
    }
    catch {
        return [];
    }
    for (const entry of entries) {
        const entryPath = join(rootDir, entry);
        let stat;
        try {
            stat = statSync(entryPath);
        }
        catch {
            continue;
        }
        if (!stat.isDirectory())
            continue;
        // Skip hidden dirs and common non-service dirs
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'build') {
            continue;
        }
        const foundMarkers = [];
        let totalWeight = 0;
        for (const [marker, weight] of Object.entries(SERVICE_MARKERS)) {
            if (existsSync(join(entryPath, marker))) {
                foundMarkers.push(marker);
                totalWeight += weight;
            }
        }
        if (foundMarkers.length === 0)
            continue;
        // Confidence: cap at 1.0, based on total marker weight
        const confidence = Math.min(1.0, totalWeight);
        boundaries.push({
            servicePath: entryPath,
            serviceName: entry,
            markers: foundMarkers,
            confidence,
        });
    }
    return boundaries.sort((a, b) => b.confidence - a.confidence);
}
/**
 * Determine which service boundary a given file belongs to.
 *
 * @param filePath - Absolute path to the file
 * @param boundaries - List of detected service boundaries
 * @returns The matching ServiceBoundary, or undefined if none match
 */
export function assignService(filePath, boundaries) {
    // Find the boundary with the longest matching prefix (most specific)
    let best;
    let bestLen = 0;
    for (const boundary of boundaries) {
        const rel = relative(boundary.servicePath, filePath);
        // relative() returns a path that starts with '..' if filePath is outside boundary
        if (!rel.startsWith('..') && rel !== '' && rel !== '.') {
            if (boundary.servicePath.length > bestLen) {
                bestLen = boundary.servicePath.length;
                best = boundary;
            }
        }
    }
    return best;
}
//# sourceMappingURL=service-boundary.js.map