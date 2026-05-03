import { readFileSync, writeFileSync, renameSync } from 'fs';

const EXPORTED_ENUM_RE = /^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s+(\w+)/;

export function declaresExportedEnum(line: string): { name: string } | null {
  const m = line.match(EXPORTED_ENUM_RE);
  if (!m) return null;
  const name = m[4];
  if (!name) return null;
  // must have "export" somewhere in the prefix parts
  if (!line.match(/\bexport\b/)) return null;
  return { name };
}

export function findEnumDeclarationRange(lines: string[], enumName: string): [number, number] | null {
  for (let i = 0; i < lines.length; i++) {
    const d = declaresExportedEnum(lines[i]!);
    if (d?.name !== enumName) continue;
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]!) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) return [i, j];
        }
      }
    }
  }
  return null;
}

export function isEnumBodyEmpty(lines: string[], range: [number, number]): boolean {
  const body = lines.slice(range[0] + 1, range[1]).join('\n');
  return body.replace(/[,\s]/g, '').length === 0;
}

export function removeEnumMember(source: string, memberName: string, enumName: string): string {
  const lines = source.split('\n');
  const range = findEnumDeclarationRange(lines, enumName);
  if (!range) return source;

  // Find the member line within the enum body
  const memberRe = new RegExp(`^\\s*${escapeRegex(memberName)}\\s*[,=]?`);
  let memberLine = -1;
  for (let i = range[0] + 1; i < range[1]; i++) {
    if (memberRe.test(lines[i]!)) { memberLine = i; break; }
  }
  if (memberLine === -1) return source;

  const newLines = lines.filter((_, idx) => idx !== memberLine);
  const newSource = newLines.join('\n');

  // Check if the enum body is now empty → remove the whole declaration
  const newRange = findEnumDeclarationRange(newLines, enumName);
  if (newRange && isEnumBodyEmpty(newLines, newRange)) {
    return newLines.filter((_, idx) => idx < newRange[0] || idx > newRange[1]).join('\n');
  }
  return newSource;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface EnumMemberFix {
  filePath: string;
  enumName: string;
  memberName: string;
}

export interface EnumMemberFixResult {
  fixed: EnumMemberFix[];
  errors: Array<{ fix: EnumMemberFix; error: string }>;
}

export function fixEnumMembers(fixes: EnumMemberFix[]): EnumMemberFixResult {
  const result: EnumMemberFixResult = { fixed: [], errors: [] };
  // Group by file, apply all member fixes to the same source
  const byFile = new Map<string, EnumMemberFix[]>();
  for (const fix of fixes) {
    const arr = byFile.get(fix.filePath) ?? [];
    arr.push(fix);
    byFile.set(fix.filePath, arr);
  }
  for (const [filePath, fileFixes] of byFile) {
    try {
      let source = readFileSync(filePath, 'utf8');
      for (const fix of fileFixes) {
        source = removeEnumMember(source, fix.memberName, fix.enumName);
      }
      const tmp = filePath + '.tmp';
      writeFileSync(tmp, source, 'utf8');
      renameSync(tmp, filePath);
      result.fixed.push(...fileFixes);
    } catch (err) {
      for (const fix of fileFixes) {
        result.errors.push({ fix, error: String(err) });
      }
    }
  }
  return result;
}
