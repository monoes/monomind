// Groups raw clone-detection output by package/owner/directory
// for grouped duplication reports.

export interface DuplicationGroupEntry {
  groupId: number;
  owner: string;   // package name or directory path
  filePaths: string[];
  duplicatedLines: number;
  instances: number;
}

export interface DuplicationGrouping {
  groups: DuplicationGroupEntry[];
  totalDuplicatedLines: number;
  totalInstances: number;
  ownerCount: number;
}

export interface CloneGroupInput {
  id: number;
  instances: Array<{ filePath: string; startLine: number; endLine: number }>;
  duplicatedLines: number;
}

export type OwnerResolver = (filePath: string) => string;

/** Default resolver: uses the immediate parent directory as the owner. */
export function defaultOwnerResolver(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '.';
}

export function buildDuplicationGrouping(
  groups: CloneGroupInput[],
  resolver: OwnerResolver = defaultOwnerResolver,
): DuplicationGrouping {
  const byOwner = new Map<string, DuplicationGroupEntry>();

  for (const group of groups) {
    for (const inst of group.instances) {
      const owner = resolver(inst.filePath);
      if (!byOwner.has(owner)) {
        byOwner.set(owner, {
          groupId: group.id,
          owner,
          filePaths: [],
          duplicatedLines: 0,
          instances: 0,
        });
      }
      const entry = byOwner.get(owner)!;
      if (!entry.filePaths.includes(inst.filePath)) entry.filePaths.push(inst.filePath);
      entry.duplicatedLines += group.duplicatedLines;
      entry.instances++;
    }
  }

  const result = [...byOwner.values()].sort((a, b) => b.duplicatedLines - a.duplicatedLines);
  return {
    groups: result,
    totalDuplicatedLines: result.reduce((s, g) => s + g.duplicatedLines, 0),
    totalInstances: result.reduce((s, g) => s + g.instances, 0),
    ownerCount: result.length,
  };
}

export function formatDuplicationGrouping(grouping: DuplicationGrouping): string {
  const lines = [`Duplication by owner (${grouping.ownerCount} owners, ${grouping.totalDuplicatedLines} total lines):`];
  for (const g of grouping.groups) {
    lines.push(`  ${g.owner}: ${g.duplicatedLines} lines, ${g.instances} instances, ${g.filePaths.length} files`);
  }
  return lines.join('\n');
}
