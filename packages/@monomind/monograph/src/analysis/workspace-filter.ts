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

// ── Round 8: gitignore-style negation patterns + changed-file scoping ──────

export interface WorkspaceFilterPattern {
  pattern: string;
  negated: boolean;   // true if pattern starts with '!'
  isGlob: boolean;
}

/** Parse a workspace filter string into a structured pattern. */
export function parseWorkspaceFilterPattern(raw: string): WorkspaceFilterPattern {
  const negated = raw.startsWith('!');
  const pattern = negated ? raw.slice(1) : raw;
  const isGlob = pattern.includes('*') || pattern.includes('?');
  return { pattern, negated, isGlob };
}

/** Match a workspace name against a gitignore-style pattern (supports ! negation and globs). */
export function matchWorkspacePattern(name: string, pattern: WorkspaceFilterPattern): boolean {
  if (pattern.isGlob) {
    const re = new RegExp('^' + pattern.pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return re.test(name);
  }
  return name === pattern.pattern;
}

/** Resolve a list of workspace names against a list of filter patterns with negation. */
export function resolveWorkspaceFilters(
  names: string[],
  patterns: string[],
): string[] {
  if (patterns.length === 0) return names;
  const parsed = patterns.map(parseWorkspaceFilterPattern);
  return names.filter(name => {
    let included = false;
    for (const p of parsed) {
      if (matchWorkspacePattern(name, p)) {
        included = !p.negated;
      }
    }
    return included;
  });
}

/** Format available workspace names for display, capping at 10 with overflow count. */
export function formatAvailableWorkspaces(names: string[]): string {
  const MAX = 10;
  if (names.length <= MAX) return names.join(', ');
  return `${names.slice(0, MAX).join(', ')} ... and ${names.length - MAX} more (${names.length} total)`;
}

/** Map a set of changed file paths to workspace indices that contain at least one changed file. */
export function workspacesContainingAny(
  changedFiles: string[],
  workspaceRoots: string[],
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < workspaceRoots.length; i++) {
    const root = workspaceRoots[i].replace(/\\/g, '/').replace(/\/$/, '');
    if (changedFiles.some(f => f.replace(/\\/g, '/').startsWith(root + '/'))) {
      indices.push(i);
    }
  }
  return indices;
}
