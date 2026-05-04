// Partition analysis results into labeled groups by owner, directory, package, or section.

export type GroupByMode = 'owner' | 'directory' | 'package' | 'section';

export interface GroupEntry<T> {
  label: string;
  items: T[];
}

export interface AttributedInstance {
  filePath: string;
  startLine: number;
  endLine: number;
  owner: string;
}

export interface AttributedCloneGroup {
  id: number;
  instances: AttributedInstance[];
  primaryOwner: string;
  duplicatedLines: number;
}

export interface PackageResolver {
  packages: Array<{ root: string; name: string }>;
  resolve(filePath: string): string;
}

export function createPackageResolver(packages: Array<{ root: string; name: string }>): PackageResolver {
  const sorted = [...packages].sort((a, b) => b.root.length - a.root.length);
  return {
    packages,
    resolve(filePath: string): string {
      const normalized = filePath.replace(/\\/g, '/');
      const match = sorted.find(p => normalized.startsWith(p.root.replace(/\\/g, '/')));
      return match?.name ?? '(root)';
    },
  };
}

export function resolveDirectoryGroup(filePath: string, depth = 1): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(0, depth + 1).join('/') || '(root)';
}

export function groupItemsByFile<T extends { filePath: string }>(
  items: T[],
  resolve: (filePath: string) => string,
): GroupEntry<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const label = resolve(item.filePath);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(item);
  }
  return [...map.entries()]
    .map(([label, its]) => ({ label, items: its }))
    .sort((a, b) => b.items.length - a.items.length);
}

/** Attribution: most instances wins, alphabetical tiebreak. */
export function largestOwner(
  instances: Array<{ filePath: string }>,
  resolveOwner: (filePath: string) => string,
): string {
  const counts = new Map<string, number>();
  for (const inst of instances) {
    const owner = resolveOwner(inst.filePath);
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  if (counts.size === 0) return '(unknown)';
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function attributeCloneGroup(
  group: { id: number; duplicatedLines: number; instances: Array<{ filePath: string; startLine: number; endLine: number }> },
  resolveOwner: (filePath: string) => string,
): AttributedCloneGroup {
  const attributed = group.instances.map(i => ({
    ...i,
    owner: resolveOwner(i.filePath),
  }));
  return {
    id: group.id,
    instances: attributed,
    primaryOwner: largestOwner(group.instances, resolveOwner),
    duplicatedLines: group.duplicatedLines,
  };
}

// ── Round 10: result group partitioning ───────────────────────────────────────

export type OwnershipResolverKind = 'owner' | 'directory' | 'package' | 'section';

export interface ResultGroup<T = unknown> {
  key: string;
  owners?: string[];
  results: T[];
  fileCount: number;
}

export function groupResultsByOwner<T extends { filePath?: string; path?: string }>(
  items: T[],
  resolver: (filePath: string) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const fp = item.filePath ?? (item as Record<string, unknown>)['path'] as string ?? '';
    const key = resolver(fp);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

export function partitionByOwner<T extends { filePath?: string; path?: string }>(
  items: T[],
  resolver: (filePath: string) => string,
): ResultGroup<T>[] {
  const grouped = groupResultsByOwner(items, resolver);
  const groups: ResultGroup<T>[] = [];
  for (const [key, results] of grouped) {
    const filePaths = new Set(results.map(r => r.filePath ?? (r as Record<string, unknown>)['path'] as string ?? ''));
    groups.push({ key, results, fileCount: filePaths.size });
  }
  return groups.sort((a, b) => b.results.length - a.results.length);
}

export function resolveWithPattern(
  filePath: string,
  ownerMap: Map<string, string>,
): { owner: string; pattern: string | null } {
  for (const [pattern, owner] of ownerMap) {
    if (filePath.includes(pattern)) return { owner, pattern };
  }
  return { owner: 'unowned', pattern: null };
}
