import { readFileSync, writeFileSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
export function fixUnusedDeps(fixes, options) {
    const dryRun = options?.dryRun ?? false;
    // Group fixes by packageJsonPath
    const byFile = new Map();
    for (const fix of fixes) {
        const existing = byFile.get(fix.packageJsonPath) ?? [];
        existing.push(fix);
        byFile.set(fix.packageJsonPath, existing);
    }
    const results = [];
    for (const [packageJsonPath, fileFixes] of byFile) {
        let raw;
        let pkg;
        try {
            raw = readFileSync(packageJsonPath, 'utf8');
            pkg = JSON.parse(raw);
        }
        catch {
            // Skip invalid or unreadable files
            continue;
        }
        const removed = [];
        for (const fix of fileFixes) {
            const section = pkg[fix.section];
            if (section && typeof section === 'object' && fix.packageName in section) {
                delete section[fix.packageName];
                removed.push(fix.packageName);
            }
        }
        if (!dryRun && removed.length > 0) {
            const newContent = JSON.stringify(pkg, null, 2) + '\n';
            const tmpFile = join(tmpdir(), `monograph-deps-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
            writeFileSync(tmpFile, newContent, 'utf8');
            renameSync(tmpFile, packageJsonPath);
        }
        results.push({
            packageJsonPath,
            removed,
            dryRun,
        });
    }
    return results;
}
//# sourceMappingURL=deps.js.map