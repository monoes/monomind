export type BindingLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'kotlin' | 'go' | 'rust';

export interface NamedBinding {
  decoratorName: string;
  targetName: string | null;
  hasArguments: boolean;
  line: number;
  filePath: string;
}

const TS_DECORATOR_RE = /^([ \t]*)@([\w.]+)([ \t]*\()?/gm;
const PY_DECORATOR_RE = /^([ \t]*)@([\w.]+)([ \t]*\()?/gm;
const JAVA_ANNOTATION_RE = /^([ \t]*)@([A-Z]\w*)([ \t]*\()?/gm;

function extractWithRegex(
  source: string,
  filePath: string,
  re: RegExp,
): NamedBinding[] {
  const results: NamedBinding[] = [];
  const lines = source.split('\n');
  re.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const charsBefore = source.slice(0, m.index);
    const lineNum = (charsBefore.match(/\n/g)?.length ?? 0) + 1;
    const nextLine = lines[lineNum] ?? '';

    let targetName: string | null = null;
    const targetMatch = /(?:class|def|function|public|private|protected|export)\s+(\w+)/.exec(nextLine);
    if (targetMatch) targetName = targetMatch[1] ?? null;

    results.push({
      decoratorName: m[2]!,
      targetName,
      hasArguments: !!m[3]?.trim(),
      line: lineNum,
      filePath,
    });
  }

  return results;
}

export function extractNamedBindings(
  source: string,
  filePath: string,
  language: BindingLanguage,
): NamedBinding[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return extractWithRegex(source, filePath, TS_DECORATOR_RE);
    case 'python':
      return extractWithRegex(source, filePath, PY_DECORATOR_RE);
    case 'java':
    case 'kotlin':
      return extractWithRegex(source, filePath, JAVA_ANNOTATION_RE);
    default:
      return [];
  }
}
