// Detect unused class methods and properties (distinct from enum members).

export type MemberKind = 'method' | 'property' | 'getter' | 'setter' | 'staticMethod' | 'staticProperty';

export interface UnusedMember {
  filePath: string;
  parentName: string;
  memberName: string;
  kind: MemberKind;
  line: number;
  col: number;
}

export interface UnusedMembersResult {
  unusedMembers: UnusedMember[];
  totalScanned: number;
  filesAffected: number;
}

export interface ClassMemberAllowlistEntry {
  pattern: string;
  classExtends?: string[];
  classImplements?: string[];
}

export function isClassMemberSuppressed(
  member: UnusedMember,
  allowlist: ClassMemberAllowlistEntry[],
  classHeritage: { extends: string[]; implements: string[] },
): boolean {
  for (const entry of allowlist) {
    const nameMatch = member.memberName === entry.pattern || memberGlobMatch(member.memberName, entry.pattern);
    if (!nameMatch) continue;
    const extMatch = !entry.classExtends?.length || entry.classExtends.some(e => classHeritage.extends.includes(e));
    const implMatch = !entry.classImplements?.length || entry.classImplements.some(i => classHeritage.implements.includes(i));
    if (extMatch && implMatch) return true;
  }
  return false;
}

function memberGlobMatch(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(name);
}

export function summarizeUnusedMembers(members: UnusedMember[]): UnusedMembersResult {
  const files = new Set(members.map(m => m.filePath));
  return {
    unusedMembers: members,
    totalScanned: members.length,
    filesAffected: files.size,
  };
}

export function groupUnusedMembersByFile(members: UnusedMember[]): Map<string, UnusedMember[]> {
  const map = new Map<string, UnusedMember[]>();
  for (const m of members) {
    if (!map.has(m.filePath)) map.set(m.filePath, []);
    map.get(m.filePath)!.push(m);
  }
  return map;
}

export function formatUnusedMembersReport(result: UnusedMembersResult): string {
  if (result.unusedMembers.length === 0) return 'No unused class members found.';
  const lines = [`${result.unusedMembers.length} unused class member(s) in ${result.filesAffected} file(s):`];
  for (const m of result.unusedMembers) {
    lines.push(`  ${m.filePath}:${m.line} — ${m.parentName}.${m.memberName} (${m.kind})`);
  }
  return lines.join('\n');
}
