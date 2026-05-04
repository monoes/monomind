export const MODULE_EXTRACTION_THRESHOLD = 50;

export interface RefactoringSuggestion {
  kind: 'ExtractFunction' | 'ExtractModule' | 'MergeDirectories';
  description: string;
  estimatedLines: number;
  files: string[];
}

export interface CloneFamily {
  files: string[];
  groupCount: number;
  totalDuplicatedLines: number;
  suggestions: RefactoringSuggestion[];
}

interface RawGroupInput {
  instances: Array<{ filePath: string; startLine: number; endLine: number }>;
  duplicatedLines: number;
}

function fileSetKey(files: string[]): string {
  return [...files].sort().join('\0');
}

function dirOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx) : '';
}

function generateSuggestions(
  files: string[],
  groups: RawGroupInput[],
  totalDuplicatedLines: number,
): RefactoringSuggestion[] {
  if (totalDuplicatedLines < MODULE_EXTRACTION_THRESHOLD) {
    return groups.map((g) => ({
      kind: 'ExtractFunction' as const,
      description: `Extract shared function (${g.duplicatedLines} lines) from ${g.instances.map((i) => i.filePath.split('/').pop() ?? i.filePath).join(', ')}`,
      estimatedLines: g.duplicatedLines,
      files,
    }));
  }

  const dirs = [...new Set(files.map(dirOf))];
  if (dirs.length > 1 && files.length >= 3) {
    return [
      {
        kind: 'MergeDirectories' as const,
        description: `Consider merging ${dirs.length} directories with ${totalDuplicatedLines} shared lines`,
        estimatedLines: totalDuplicatedLines,
        files,
      },
    ];
  }

  return [
    {
      kind: 'ExtractModule' as const,
      description: `Extract ${totalDuplicatedLines} duplicated lines into a shared module`,
      estimatedLines: totalDuplicatedLines,
      files,
    },
  ];
}

export function groupRawGroupsIntoFamilies(groups: RawGroupInput[]): CloneFamily[] {
  const familyMap = new Map<string, { files: Set<string>; groups: RawGroupInput[] }>();

  for (const group of groups) {
    const files = group.instances.map((i) => i.filePath);
    const key = fileSetKey(files);
    if (!familyMap.has(key)) {
      familyMap.set(key, { files: new Set(files), groups: [] });
    }
    familyMap.get(key)!.groups.push(group);
  }

  const families: CloneFamily[] = [];

  for (const { files, groups: fg } of familyMap.values()) {
    const fileList = [...files].sort();
    const totalDuplicatedLines = fg.reduce((s, g) => s + g.duplicatedLines, 0);
    families.push({
      files: fileList,
      groupCount: fg.length,
      totalDuplicatedLines,
      suggestions: generateSuggestions(fileList, fg, totalDuplicatedLines),
    });
  }

  families.sort((a, b) => b.totalDuplicatedLines - a.totalDuplicatedLines);
  return families;
}
