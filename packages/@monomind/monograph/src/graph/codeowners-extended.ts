export interface CodeOwnerRuleMatch {
  ownerCount: number;
  owners: string[];
  sectionName: string | null;
  matchedRule: string;
}

export interface SectionMatch {
  sectionName: string | null;
  sectionOwners: string[];
  matchedRule: string;
}

export interface CodeOwnersLike {
  ownerAndRuleOf?: (path: string) => CodeOwnerRuleMatch | null;
  sectionAndOwnersOf?: (path: string) => SectionMatch | null;
  hasSections?: boolean;
  ownersOf: (path: string) => string[] | null;
}

export const UNOWNED_LABEL = '(unowned)';
export const NO_SECTION_LABEL = '(no section)';

export function ownerCountOf(co: CodeOwnersLike, relativePath: string): number | null {
  if (co.ownerAndRuleOf) {
    const match = co.ownerAndRuleOf(relativePath);
    if (!match) return null;
    return match.ownerCount;
  }
  const owners = co.ownersOf(relativePath);
  if (owners === null) return null;
  return owners.length;
}

export function sectionOf(co: CodeOwnersLike, relativePath: string): string | null | undefined {
  if (!co.sectionAndOwnersOf) return undefined;
  const match = co.sectionAndOwnersOf(relativePath);
  if (!match) return undefined;
  return match.sectionName;
}

export function sectionAndOwnersOf(co: CodeOwnersLike, relativePath: string): SectionMatch | null {
  if (!co.sectionAndOwnersOf) return null;
  return co.sectionAndOwnersOf(relativePath) ?? null;
}

export function hasGitLabSections(co: CodeOwnersLike): boolean {
  return co.hasSections ?? false;
}

export function ownerLabel(co: CodeOwnersLike, relativePath: string): string {
  const owners = co.ownersOf(relativePath);
  if (owners === null) return UNOWNED_LABEL;
  if (owners.length === 0) {
    const section = sectionOf(co, relativePath);
    if (section === null) return NO_SECTION_LABEL;
    return UNOWNED_LABEL;
  }
  return owners[0];
}

export interface OwnershipAggregate {
  /** Paths that have no owner. */
  unowned: string[];
  /** Map from owner handle → list of owned file paths. */
  byOwner: Map<string, string[]>;
  /** Total files analyzed. */
  totalFiles: number;
}

/**
 * Aggregate ownership across a list of relative paths in a single pass.
 * Each file is attributed to its primary owner (first in the owners list).
 */
export function aggregateOwnership(
  co: CodeOwnersLike,
  relativePaths: string[],
): OwnershipAggregate {
  const unowned: string[] = [];
  const byOwner = new Map<string, string[]>();

  for (const path of relativePaths) {
    const owners = co.ownersOf(path);
    if (!owners || owners.length === 0) {
      unowned.push(path);
    } else {
      const primary = owners[0];
      let bucket = byOwner.get(primary);
      if (!bucket) { bucket = []; byOwner.set(primary, bucket); }
      bucket.push(path);
    }
  }

  return { unowned, byOwner, totalFiles: relativePaths.length };
}

/**
 * Format an OwnershipAggregate as structured text for LLM consumption.
 */
export function formatOwnershipReport(agg: OwnershipAggregate): string {
  const lines: string[] = [
    `Ownership report: ${agg.totalFiles} files, ${agg.byOwner.size} owner(s), ${agg.unowned.length} unowned`,
    '',
  ];
  // Sort owners by file count descending
  const sorted = Array.from(agg.byOwner.entries()).sort((a, b) => b[1].length - a[1].length);
  for (const [owner, files] of sorted) {
    lines.push(`  ${owner}: ${files.length} file(s)`);
  }
  if (agg.unowned.length > 0) {
    lines.push(`  ${UNOWNED_LABEL}: ${agg.unowned.length} file(s)`);
  }
  return lines.join('\n');
}
