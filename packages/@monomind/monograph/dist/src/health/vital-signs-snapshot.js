import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
export const SNAPSHOT_SCHEMA_VERSION = 7;
export function buildSnapshot(vitalSigns, healthScore) {
    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        vitalSigns,
        healthScore,
    };
}
export function saveSnapshot(dir, snapshot) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const safeTimestamp = snapshot.timestamp.replace(/[:.]/g, '_');
    const filepath = join(dir, `${safeTimestamp}.json`);
    writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');
    return filepath;
}
export function loadSnapshots(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const snapshots = [];
    for (const file of files) {
        try {
            const raw = readFileSync(join(dir, file), 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
                snapshots.push(parsed);
            }
        }
        catch {
            // skip malformed files
        }
    }
    snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return snapshots;
}
//# sourceMappingURL=vital-signs-snapshot.js.map