export type RefactoringKind = 'ExtractFunction' | 'ExtractModule' | 'MergeDirectories';

export const MODULE_EXTRACTION_THRESHOLD_LINES = 50;

export interface RefactoringSuggestion {
  kind: RefactoringKind;
  description: string;
  estimatedLines: number;
  files: string[];
}

export interface CloneInstance {
  filePath: string;
  startLine: number;
  endLine: number;
  tokenCount?: number;
}

export interface CloneGroup {
  id: number;
  instances: CloneInstance[];
  duplicatedLines: number;
}

export interface CloneFamily {
  files: string[];        // sorted, deduplicated set of files
  groups: CloneGroup[];
  totalDuplicatedLines: number;
  suggestions: RefactoringSuggestion[];
}

function fileSetKey(files: string[]): string {
  // Avoid spread allocation: sort a copy directly
  return files.slice().sort().join('|');
}

function generateSuggestions(family: Omit<CloneFamily, 'suggestions'>): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];
  const lines = family.totalDuplicatedLines;

  if (lines < MODULE_EXTRACTION_THRESHOLD_LINES) {
    suggestions.push({
      kind: 'ExtractFunction',
      description: `Extract ${lines} duplicated lines into a shared function`,
      estimatedLines: lines,
      files: family.files,
    });
  } else {
    // Check if all files are in the same directory → MergeDirectories
    // Use Set directly to avoid spread+map intermediate array
    const dirSet = new Set<string>();
    for (const f of family.files) {
      const slash = f.replace(/\\/g, '/');
      const lastSlash = slash.lastIndexOf('/');
      dirSet.add(lastSlash >= 0 ? slash.slice(0, lastSlash) : '.');
    }
    const dirs = [...dirSet];
    if (dirs.length > 1 && family.files.length >= 3) {
      suggestions.push({
        kind: 'MergeDirectories',
        description: `Consider merging ${dirs.length} directories with ${lines} shared lines`,
        estimatedLines: lines,
        files: family.files,
      });
    } else {
      suggestions.push({
        kind: 'ExtractModule',
        description: `Extract ${lines} duplicated lines into a shared module`,
        estimatedLines: lines,
        files: family.files,
      });
    }
  }
  return suggestions;
}

export function groupIntoFamilies(groups: CloneGroup[]): CloneFamily[] {
  const familyMap = new Map<string, { files: Set<string>; groups: CloneGroup[] }>();

  for (const group of groups) {
    const files = group.instances.map(i => i.filePath);
    const key = fileSetKey(files);
    if (!familyMap.has(key)) {
      familyMap.set(key, { files: new Set(files), groups: [] });
    }
    familyMap.get(key)!.groups.push(group);
  }

  // Build output array without intermediate spread + map allocation
  const result: CloneFamily[] = [];
  for (const { files, groups } of familyMap.values()) {
    const fileList = [...files].sort();
    let totalDuplicatedLines = 0;
    for (const g of groups) totalDuplicatedLines += g.duplicatedLines;
    const base = { files: fileList, groups, totalDuplicatedLines };
    result.push({ ...base, suggestions: generateSuggestions(base) });
  }
  return result.sort((a, b) => b.totalDuplicatedLines - a.totalDuplicatedLines);
}

/** Format clone families as structured text for LLM consumption. */
export function formatCloneFamilies(families: CloneFamily[]): string {
  if (families.length === 0) return 'No clone families detected.';
  const lines: string[] = [`Clone Families (${families.length} total):`];
  for (const f of families.slice(0, 20)) {
    lines.push(`\n  ${f.totalDuplicatedLines} duplicated lines across ${f.files.length} files:`);
    for (const file of f.files) lines.push(`    ${file}`);
    for (const s of f.suggestions) lines.push(`  -> [${s.kind}] ${s.description}`);
  }
  if (families.length > 20) lines.push(`\n  ... and ${families.length - 20} more families`);
  return lines.join('\n');
}

export function cloneFamilySummary(families: CloneFamily[]): {
  totalFamilies: number;
  totalDuplicatedLines: number;
  byKind: Record<RefactoringKind, number>;
} {
  const byKind: Record<RefactoringKind, number> = {
    ExtractFunction: 0, ExtractModule: 0, MergeDirectories: 0,
  };
  let totalDuplicatedLines = 0;
  for (const f of families) {
    totalDuplicatedLines += f.totalDuplicatedLines;
    for (const s of f.suggestions) byKind[s.kind]++;
  }
  return {
    totalFamilies: families.length,
    totalDuplicatedLines,
    byKind,
  };
}
