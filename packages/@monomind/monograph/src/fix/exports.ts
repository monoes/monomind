import { readFileSync, writeFileSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface ExportFix {
  filePath: string;
  exportName: string;
  lineNumber: number;
  fixType: 'remove-export-keyword' | 'remove-entire-declaration';
}

export interface FixResult {
  filePath: string;
  fixesApplied: number;
  dryRun: boolean;
  diff: string[];   // before/after lines for dry-run display
}

export function fixUnusedExports(
  fixes: ExportFix[],
  options?: { dryRun?: boolean }
): FixResult[] {
  const dryRun = options?.dryRun ?? false;

  // Group fixes by filePath
  const byFile = new Map<string, ExportFix[]>();
  for (const fix of fixes) {
    const existing = byFile.get(fix.filePath) ?? [];
    existing.push(fix);
    byFile.set(fix.filePath, existing);
  }

  const results: FixResult[] = [];

  for (const [filePath, fileFixes] of byFile) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      // Skip files we can't read
      continue;
    }

    const lines = content.split('\n');
    const diff: string[] = [];
    let fixesApplied = 0;

    // Sort by lineNumber descending to avoid line-shift bugs
    const sortedFixes = [...fileFixes].sort((a, b) => b.lineNumber - a.lineNumber);

    for (const fix of sortedFixes) {
      const idx = fix.lineNumber - 1;
      if (idx < 0 || idx >= lines.length) continue;

      const originalLine = lines[idx];

      if (fix.fixType === 'remove-export-keyword') {
        // Remove the 'export ' prefix from the line
        const newLine = originalLine.replace(
          /^(\s*)export (default function|function|const|class|type|interface|default )/,
          '$1$2'
        );
        if (newLine !== originalLine) {
          diff.push(`- ${originalLine}`);
          diff.push(`+ ${newLine}`);
          lines[idx] = newLine;
          fixesApplied++;
        }
      } else if (fix.fixType === 'remove-entire-declaration') {
        diff.push(`- ${originalLine}`);
        lines.splice(idx, 1);
        fixesApplied++;
      }
    }

    if (!dryRun && fixesApplied > 0) {
      const newContent = lines.join('\n');
      // Atomic write: temp file then rename
      const tmpFile = join(tmpdir(), `monograph-fix-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      writeFileSync(tmpFile, newContent, 'utf8');
      renameSync(tmpFile, filePath);
    }

    results.push({
      filePath,
      fixesApplied,
      dryRun,
      diff,
    });
  }

  return results;
}
