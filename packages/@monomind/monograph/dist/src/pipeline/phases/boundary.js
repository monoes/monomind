import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
/**
 * Convert a glob pattern to a regex.
 * Handles: ** to .*, * to [^/]*, escapes other regex chars.
 */
function globToRegex(glob) {
    const DOUBLE_STAR = '\x00DS\x00';
    const pattern = glob
        .replace(/\*\*/g, DOUBLE_STAR)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .split(DOUBLE_STAR).join('.*');
    return new RegExp('^' + pattern + '$');
}
/** Compile a ZoneConfig[] into CompiledZone[] once to avoid reconstructing RegExps per path. */
function compileZones(zones) {
    return zones.map(z => ({ name: z.name, re: globToRegex(z.glob) }));
}
/**
 * Classify a file path into a zone name using precompiled regexes.
 * Returns null if no zone matches.
 */
function classifyZoneCompiled(filePath, compiled) {
    for (const z of compiled) {
        if (z.re.test(filePath))
            return z.name;
    }
    return null;
}
/**
 * Load .monographrc.json from repoRoot. Returns empty config if not found or invalid.
 */
export function loadMonographConfig(repoRoot) {
    const configPath = join(repoRoot, '.monographrc.json');
    if (!existsSync(configPath))
        return {};
    try {
        const raw = readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
/**
 * Classify a file path into a zone name. Returns null if no zone matches.
 * Compiles the glob patterns on every call — use classifyZoneCompiled with
 * precompiled zones for hot paths.
 */
export function classifyZone(filePath, zones) {
    for (const zone of zones) {
        const regex = globToRegex(zone.glob);
        if (regex.test(filePath))
            return zone.name;
    }
    return null;
}
/**
 * Check all edges in the DB for boundary violations.
 * Violations are cross-zone edges not present in the allowedImports allowlist.
 * Intra-zone imports are always allowed.
 * Returns [] if no .monographrc.json or no zones defined.
 */
export function detectBoundaryViolations(db, repoRoot) {
    const config = loadMonographConfig(repoRoot);
    if (!config.zones || config.zones.length === 0)
        return [];
    const zones = config.zones;
    const allowedSet = new Set((config.allowedImports ?? []).map(([from, to]) => `${from}→${to}`));
    // Precompile zone regexes once — avoids re-constructing RegExp objects per file path.
    const compiledZones = compileZones(zones);
    const rows = db.prepare(`
    SELECT e.id, e.relation,
           ns.file_path AS src_path,
           nt.file_path AS tgt_path
    FROM edges e
    JOIN nodes ns ON ns.id = e.source_id
    JOIN nodes nt ON nt.id = e.target_id
    WHERE ns.file_path IS NOT NULL AND nt.file_path IS NOT NULL
  `).all();
    // Cache per-path zone classification to avoid O(rows * zones) repeated regex tests.
    const pathZoneCache = new Map();
    const classifyPath = (p) => {
        let zone = pathZoneCache.get(p);
        if (zone === undefined) {
            zone = classifyZoneCompiled(p, compiledZones);
            pathZoneCache.set(p, zone);
        }
        return zone;
    };
    const violations = [];
    for (const row of rows) {
        const fromZone = classifyPath(row.src_path);
        const toZone = classifyPath(row.tgt_path);
        if (fromZone === null || toZone === null)
            continue;
        if (fromZone === toZone)
            continue;
        const key = `${fromZone}→${toZone}`;
        if (!allowedSet.has(key)) {
            violations.push({
                fromPath: row.src_path,
                toPath: row.tgt_path,
                fromZone,
                toZone,
                edgeRelation: row.relation,
            });
        }
    }
    return violations;
}
//# sourceMappingURL=boundary.js.map