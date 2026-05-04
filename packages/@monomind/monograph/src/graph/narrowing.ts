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
