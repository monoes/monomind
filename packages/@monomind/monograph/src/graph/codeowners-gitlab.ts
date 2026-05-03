export const UNOWNED_LABEL = 'UNOWNED';
export const NO_SECTION_LABEL = '(no section)';

export const CODEOWNERS_PROBE_PATHS = [
  'CODEOWNERS',
  'docs/CODEOWNERS',
  '.github/CODEOWNERS',
  '.gitlab/CODEOWNERS',
];

export interface SectionHeader {
  name: string;
  optional: boolean;
  minApprovals?: number;
  defaultOwners: string[];
}

const SECTION_HEADER_RE = /^(\^)?\[([^\]]+)\](?:\[(\d+)\])?\s*(.*)?$/;

export function parseSectionHeader(line: string): SectionHeader | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('^[')) return null;
  const m = trimmed.match(SECTION_HEADER_RE);
  if (!m) return null;
  const optional = m[1] === '^';
  const name = m[2]!.trim();
  const minApprovals = m[3] ? parseInt(m[3], 10) : undefined;
  const defaultOwners = (m[4] ?? '').trim().split(/\s+/).filter(Boolean);
  return { name, optional, minApprovals, defaultOwners };
}

export interface CodeownersEntry {
  pattern: string;
  owners: string[];
  section?: string;
  negated: boolean;
}

export function parseCodeownersWithSections(content: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];
  let currentSection: string | undefined;
  let sectionDefaults: string[] = [];

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionHeader = parseSectionHeader(line);
    if (sectionHeader) {
      currentSection = sectionHeader.name;
      sectionDefaults = sectionHeader.defaultOwners;
      if (sectionDefaults.length > 0) {
        entries.push({ pattern: '**/*', owners: sectionDefaults, section: currentSection, negated: false });
      }
      continue;
    }
    const negated = line.startsWith('!');
    const rest = negated ? line.slice(1).trim() : line;
    const parts = rest.split(/\s+/);
    const pattern = parts[0];
    if (!pattern) continue;
    const owners = negated ? [] : parts.slice(1);
    entries.push({ pattern, owners, section: currentSection, negated });
  }
  return entries;
}

export function matchOwners(entries: CodeownersEntry[], filePath: string): { owners: string[]; section?: string } {
  // Import minimatch dynamically to avoid circular deps — use simple suffix matching as fallback
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (pathMatchesPattern(filePath, entry.pattern)) {
      if (entry.negated) return { owners: [], section: entry.section };
      return { owners: entry.owners, section: entry.section };
    }
  }
  return { owners: [], section: undefined };
}

function pathMatchesPattern(filePath: string, pattern: string): boolean {
  const norm = filePath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');
  if (pat === '**/*') return true;
  if (pat.startsWith('**')) return norm.endsWith(pat.slice(2));
  if (pat.startsWith('/')) return norm === pat.slice(1) || norm.startsWith(pat.slice(1) + '/');
  if (pat.endsWith('/')) return norm.startsWith(pat);
  return norm === pat || norm.endsWith('/' + pat) || norm.startsWith(pat + '/');
}

export function ownerCountOf(entries: CodeownersEntry[], filePath: string): number {
  return matchOwners(entries, filePath).owners.length;
}

export function sectionOf(entries: CodeownersEntry[], filePath: string): string {
  return matchOwners(entries, filePath).section ?? NO_SECTION_LABEL;
}

export function sectionAndOwnersOf(entries: CodeownersEntry[], filePath: string): { section: string; owners: string[] } {
  const { owners, section } = matchOwners(entries, filePath);
  return { section: section ?? NO_SECTION_LABEL, owners };
}

export function hasSections(entries: CodeownersEntry[]): boolean {
  return entries.some(e => e.section !== undefined);
}
