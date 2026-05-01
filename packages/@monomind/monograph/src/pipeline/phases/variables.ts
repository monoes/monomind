import type { MonographNode } from '../../types.js';

export interface VariableInfo {
  name: string;
  isExported: boolean;
  line: number;
  filePath: string;
}

// Regex for top-level variable declarations.
// We detect nesting depth by counting braces before the match.
const TOP_LEVEL_VAR = /^(export\s+)?(const|let|var)\s+(\w+)\s*[=:]/gm;

export function extractVariables(source: string, filePath: string): VariableInfo[] {
  const results: VariableInfo[] = [];
  let match: RegExpExecArray | null;
  TOP_LEVEL_VAR.lastIndex = 0;

  while ((match = TOP_LEVEL_VAR.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    // Count brace depth — top-level means depth == 0
    let depth = 0;
    for (const ch of before) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth !== 0) continue;

    const isExported = !!match[1];
    const name = match[3];
    const line = before.split('\n').length;
    results.push({ name, isExported, line, filePath });
  }

  return results;
}

export function variableToNode(v: VariableInfo): MonographNode {
  return {
    id: `var:${v.filePath}:${v.name}`,
    label: 'Variable',
    name: v.name,
    normLabel: v.name.toLowerCase(),
    filePath: v.filePath,
    startLine: v.line,
    endLine: v.line,
    isExported: v.isExported,
  };
}
