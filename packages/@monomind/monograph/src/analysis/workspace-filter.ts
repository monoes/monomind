export interface SubsetFilter {
  roots: string[];
  test(filePath: string): boolean;
}

export function createSubsetFilter(roots: string[]): SubsetFilter {
  // Normalize roots to ensure they end with '/'
  const normalizedRoots = roots.map((root) => (root.endsWith('/') ? root : root + '/'));

  return {
    roots: normalizedRoots,
    test(filePath: string): boolean {
      return normalizedRoots.some((root) => filePath.startsWith(root));
    },
  };
}

export function filterToWorkspaces<T extends { filePath?: string | null }>(
  items: T[],
  workspaceRoots: string[],
): T[] {
  const filter = createSubsetFilter(workspaceRoots);
  return items.filter((item) => item.filePath != null && filter.test(item.filePath));
}

export function filterGroupsByWorkspace<T extends { instances: Array<{ filePath: string }> }>(
  groups: T[],
  workspaceRoots: string[],
): T[] {
  const filter = createSubsetFilter(workspaceRoots);
  return groups.filter((group) => group.instances.some((instance) => filter.test(instance.filePath)));
}
