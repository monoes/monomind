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
