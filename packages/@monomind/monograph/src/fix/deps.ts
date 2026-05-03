import { readFileSync, writeFileSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface DepFix {
  packageJsonPath: string;
  packageName: string;
  section: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
}

export interface DepFixResult {
  packageJsonPath: string;
  removed: string[];
  dryRun: boolean;
}

export function fixUnusedDeps(
  fixes: DepFix[],
  options?: { dryRun?: boolean }
): DepFixResult[] {
  const dryRun = options?.dryRun ?? false;

  // Group fixes by packageJsonPath
  const byFile = new Map<string, DepFix[]>();
  for (const fix of fixes) {
    const existing = byFile.get(fix.packageJsonPath) ?? [];
    existing.push(fix);
    byFile.set(fix.packageJsonPath, existing);
  }

  const results: DepFixResult[] = [];

  for (const [packageJsonPath, fileFixes] of byFile) {
    let raw: string;
    let pkg: Record<string, unknown>;

    try {
      raw = readFileSync(packageJsonPath, 'utf8');
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Skip invalid or unreadable files
      continue;
    }

    const removed: string[] = [];

    for (const fix of fileFixes) {
      const section = pkg[fix.section] as Record<string, unknown> | undefined;
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
