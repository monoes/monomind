/**
 * Local vs global monomind version sync checker.
 * Reads .monomind/version (stamped by `monomind init`) and compares to
 * the globally installed monomind package. No network calls — entirely local.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getInstalledVersion } from '../update/checker.js';
export function checkLocalSync(projectDir = process.cwd()) {
    let localVersion = null;
    try {
        const versionFile = join(projectDir, '.monomind', 'version');
        if (existsSync(versionFile)) {
            localVersion = readFileSync(versionFile, 'utf-8').trim() || null;
        }
    }
    catch { /* pre-v1.17 project or missing .monomind */ }
    // Try both package names — `monomind` (umbrella) and `@monoes/monomindcli` (scoped CLI)
    const globalVersion = getInstalledVersion('monomind') ??
        getInstalledVersion('@monoes/monomindcli');
    const needsSync = localVersion !== null &&
        globalVersion !== null &&
        localVersion !== globalVersion;
    return { localVersion, globalVersion, needsSync };
}
//# sourceMappingURL=checker.js.map