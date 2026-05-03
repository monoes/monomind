// Resolve import() calls into structured import entries.

export type DynamicImportPattern =
  | { kind: 'string'; value: string }
  | { kind: 'template'; prefix: string; suffix: string }
  | { kind: 'expression' };

export interface DynamicImportInfo {
  pattern: DynamicImportPattern;
  importedNames: string[];   // destructured: `const { a } = await import('./x')` → ['a']
  namespaceLocal?: string;   // `const ns = await import('./x')` → 'ns'
  isSideEffect: boolean;
  line: number;
}

export interface ResolvedDynamicImport {
  source: DynamicImportInfo;
  resolvedPaths: string[];   // matched file paths
  isGlob: boolean;
}

/** Parse dynamic import calls from source text. */
export function parseDynamicImports(source: string): DynamicImportInfo[] {
  const results: DynamicImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('import(')) continue;

    // Template literal: import(`./routes/${name}`)
    const tmplM = /import\(`([^`]*)\$\{[^}]+\}([^`]*)`\)/.exec(line);
    if (tmplM) {
      results.push({
        pattern: { kind: 'template', prefix: tmplM[1], suffix: tmplM[2] },
        importedNames: [],
        isSideEffect: true,
        line: i + 1,
      });
      continue;
    }

    // String literal: import('./foo')
    const strM = /import\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(line);
    if (!strM) continue;

    const path = strM[1];

    // Destructured await: const { a, b } = await import('./x')
    const destructM = /const\s+\{([^}]+)\}\s*=\s*await\s+import/.exec(line);
    if (destructM) {
      const names = destructM[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      results.push({ pattern: { kind: 'string', value: path }, importedNames: names, isSideEffect: false, line: i + 1 });
      continue;
    }

    // Namespace: const ns = await import('./x')
    const nsM = /const\s+([a-zA-Z_$][\w$]*)\s*=\s*await\s+import/.exec(line);
    if (nsM) {
      results.push({ pattern: { kind: 'string', value: path }, importedNames: [], namespaceLocal: nsM[1], isSideEffect: false, line: i + 1 });
      continue;
    }

    // Bare side-effect: await import('./x') or import('./x').then(...)
    results.push({ pattern: { kind: 'string', value: path }, importedNames: [], isSideEffect: true, line: i + 1 });
  }

  return results;
}

/** Expand a template-literal import to a glob pattern. */
export function templateToGlob(prefix: string, suffix: string): string {
  return `${prefix}*${suffix}`;
}

/** Match a glob pattern against a list of file paths (simple prefix+suffix matching). */
export function matchGlob(pattern: string, files: string[]): string[] {
  const [pre, suf = ''] = pattern.split('*');
  return files.filter(f => f.includes(pre) && (suf === '' || f.endsWith(suf)));
}

/** Resolve a single dynamic import info against a list of known file paths. */
export function resolveSingleDynamicImport(
  info: DynamicImportInfo,
  allFiles: string[],
  currentDir: string,
): ResolvedDynamicImport {
  if (info.pattern.kind === 'expression') {
    return { source: info, resolvedPaths: [], isGlob: false };
  }
  if (info.pattern.kind === 'template') {
    const glob = templateToGlob(
      currentDir + '/' + info.pattern.prefix,
      info.pattern.suffix,
    );
    return { source: info, resolvedPaths: matchGlob(glob, allFiles), isGlob: true };
  }
  // String literal
  const target = info.pattern.value;
  const resolved = allFiles.find(f => f.endsWith(target.replace(/^\.\//, '/'))) ?? target;
  return { source: info, resolvedPaths: [resolved], isGlob: false };
}
