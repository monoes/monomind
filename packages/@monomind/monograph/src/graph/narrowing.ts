export interface AccessedMembers {
  members: Set<string>;
  hasNamespaceAccess: boolean;
}

export function isUnusedImportBinding(
  importedName: string,
  accessedMembers: Set<string>,
): boolean {
  return !accessedMembers.has(importedName);
}

export function extractAccessedMembers(usages: string[]): AccessedMembers {
  const members = new Set<string>();
  let hasNamespaceAccess = false;

  for (const usage of usages) {
    const dotIdx = usage.indexOf('.');
    if (dotIdx === -1) {
      hasNamespaceAccess = true;
    } else {
      const member = usage.slice(dotIdx + 1);
      if (member) members.add(member);
    }
  }

  return { members, hasNamespaceAccess };
}

export function markAllExportsReferenced(exports: string[]): Set<string> {
  return new Set(exports);
}

export function markMemberExportsReferenced(
  exports: string[],
  accessed: AccessedMembers,
): Set<string> {
  if (accessed.hasNamespaceAccess) {
    return new Set(exports);
  }
  const result = new Set<string>();
  for (const exp of exports) {
    if (accessed.members.has(exp)) {
      result.add(exp);
    }
  }
  return result;
}

export interface NarrowingReport {
  filePath: string;
  totalExports: number;
  referencedExports: string[];
  unusedExports: string[];
}

/**
 * Given a file's exports and the accessed members from all import sites,
 * return a report of which exports are unused.
 */
export function filterUnusedExports(
  filePath: string,
  exports: string[],
  accessed: AccessedMembers,
): NarrowingReport {
  const referenced = markMemberExportsReferenced(exports, accessed);
  const unusedExports: string[] = [];
  for (const exp of exports) {
    if (!referenced.has(exp)) unusedExports.push(exp);
  }
  return {
    filePath,
    totalExports: exports.length,
    referencedExports: Array.from(referenced),
    unusedExports,
  };
}

/**
 * Format narrowing reports as structured text for LLM dead-import diagnostics.
 */
export function formatNarrowingReport(reports: NarrowingReport[]): string {
  const withUnused = reports.filter(r => r.unusedExports.length > 0);
  if (withUnused.length === 0) return 'No unused exports found.';

  const lines: string[] = [`Unused exports in ${withUnused.length} file(s):`, ''];
  for (const r of withUnused) {
    lines.push(`  ${r.filePath} (${r.unusedExports.length}/${r.totalExports} unused)`);
    for (const exp of r.unusedExports) lines.push(`    - ${exp}`);
  }
  return lines.join('\n');
}
