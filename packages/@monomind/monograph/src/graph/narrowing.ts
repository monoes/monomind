// Namespace import narrowing: when `import * as ns from './x'` is used,
// determine which exports are actually accessed (ns.foo, ns.bar).

export type ReferenceKind =
  | 'direct'           // ns.foo — specific export
  | 'whole-object'     // Object.values(ns), { ...ns }, etc.
  | 'destructured'     // const { foo } = ns
  | 'unknown';

export interface NamespaceAccess {
  localName: string;   // the `ns` in `import * as ns`
  accessedMembers: string[];
  isWholeObjectUse: boolean;
  referenceKind: ReferenceKind;
}

export interface NarrowingResult {
  sourceFile: string;
  targetModule: string;
  referencedExports: string[];
  allExportsReferenced: boolean;
  reason: 'member-access' | 'whole-object' | 'conservative-fallback' | 'entry-point';
}

const WHOLE_OBJECT_PATTERNS = [
  /Object\.(values|keys|entries|assign|freeze|fromEntries)\s*\(/,
  /\.\.\.\s*[a-zA-Z_$]/,
  /for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+Object\./,
];

/** Check if a line constitutes a whole-object use of a namespace. */
export function isWholeObjectUse(line: string, localName: string): boolean {
  if (!line.includes(localName)) return false;
  return WHOLE_OBJECT_PATTERNS.some(p => p.test(line));
}

/** Extract member accesses of the form `ns.memberName` from source text. */
export function extractMemberAccesses(source: string, localName: string): string[] {
  const re = new RegExp(`\\b${localName}\\.([a-zA-Z_$][\\w$]*)`, 'g');
  const members = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) members.add(m[1]);
  return [...members];
}

/** Extract destructured members: `const { a, b } = ns` */
export function extractDestructuredMembers(source: string, localName: string): string[] {
  const re = new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*${localName}\\b`);
  const m = re.exec(source);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
}

/** Narrow which exports of a namespace import are referenced in source text. */
export function narrowNamespaceReferences(
  source: string,
  localName: string,
  allExports: string[],
  isEntryPoint = false,
): NarrowingResult {
  if (isEntryPoint) {
    return {
      sourceFile: '',
      targetModule: '',
      referencedExports: allExports,
      allExportsReferenced: true,
      reason: 'entry-point',
    };
  }

  const lines = source.split('\n');
  for (const line of lines) {
    if (isWholeObjectUse(line, localName)) {
      return {
        sourceFile: '',
        targetModule: '',
        referencedExports: allExports,
        allExportsReferenced: true,
        reason: 'whole-object',
      };
    }
  }

  const members = new Set([
    ...extractMemberAccesses(source, localName),
    ...extractDestructuredMembers(source, localName),
  ]);

  if (members.size === 0) {
    return {
      sourceFile: '',
      targetModule: '',
      referencedExports: allExports,
      allExportsReferenced: true,
      reason: 'conservative-fallback',
    };
  }

  return {
    sourceFile: '',
    targetModule: '',
    referencedExports: [...members].filter(m => allExports.includes(m)),
    allExportsReferenced: false,
    reason: 'member-access',
  };
}

/** Narrow CSS module default import: `styles.primary` marks `primary` as referenced. */
export function narrowCssModuleReferences(
  source: string,
  localName: string,
): string[] {
  return extractMemberAccesses(source, localName);
}
