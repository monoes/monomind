// ── Call site extraction by language ──────────────────────────────────────────

export interface CallSite {
  callerFileNodeId: string;
  callerFilePath: string;
  calleeRaw: string;
  form: 'method' | 'direct' | 'dynamic';
  receiverName?: string;
  methodName?: string;
  /**
   * Byte offset of the match in the source, used by scope resolution to find
   * the function enclosing this call. Without it every CALLS edge is
   * attributed to the containing File, which makes a function look "used" by
   * its own file just for being declared there — see the dead-code masking
   * described in graph/dead-code.ts.
   */
  offset?: number;
}

// ── Language keyword sets ────────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'function', 'class', 'new', 'typeof',
  'await', 'catch', 'throw', 'delete', 'void', 'instanceof', 'in', 'of',
  'import', 'export', 'yield', 'async', 'super', 'this', 'const', 'let', 'var',
  'try', 'finally', 'break', 'continue', 'debugger', 'with', 'do',
]);

const PY_KEYWORDS = new Set([
  'if', 'for', 'while', 'with', 'return', 'def', 'class', 'import', 'from',
  'raise', 'yield', 'lambda', 'await', 'async', 'del', 'pass', 'assert',
  'except', 'elif', 'else', 'not', 'and', 'or', 'in', 'is', 'print',
]);

const GO_KEYWORDS = new Set([
  'if', 'for', 'range', 'return', 'func', 'type', 'var', 'const', 'import', 'package',
  'go', 'defer', 'select', 'case', 'default', 'break', 'continue', 'goto', 'fallthrough',
  'chan', 'map', 'struct', 'interface', 'make', 'new', 'len', 'cap', 'append', 'delete',
  'panic', 'recover', 'close', 'switch', 'else',
]);

const JAVA_KEYWORDS = new Set([
  'if', 'for', 'while', 'do', 'switch', 'case', 'return', 'class', 'interface', 'enum',
  'new', 'extends', 'implements', 'import', 'package', 'throw', 'throws', 'catch', 'try',
  'finally', 'static', 'final', 'abstract', 'public', 'private', 'protected', 'void',
  'break', 'continue', 'default', 'else', 'instanceof', 'this', 'super',
]);

const RUST_KEYWORDS = new Set([
  'if', 'let', 'for', 'while', 'loop', 'match', 'return', 'fn', 'struct', 'enum', 'trait',
  'impl', 'use', 'mod', 'pub', 'super', 'self', 'type', 'where', 'in', 'as', 'mut',
  'ref', 'move', 'async', 'await', 'dyn', 'extern', 'crate', 'static', 'const', 'unsafe',
  'break', 'continue', 'else',
]);

// ── Extension sets ───────────────────────────────────────────────────────────

export const TS_JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
export const CJS_MJS_EXTS = new Set(['.cjs', '.mjs']);
const PY_EXTS = new Set(['.py']);
const GO_EXTS = new Set(['.go']);
const JAVA_EXTS = new Set(['.java']);
const RUST_EXTS = new Set(['.rs']);

export function isSupportedExt(ext: string): boolean {
  return TS_JS_EXTS.has(ext) || CJS_MJS_EXTS.has(ext) || PY_EXTS.has(ext) || GO_EXTS.has(ext) || JAVA_EXTS.has(ext) || RUST_EXTS.has(ext);
}

// ── Generic extractor for languages with method.call and direct() patterns ──

function extractSimpleCallSites(
  source: string,
  filePath: string,
  fileNodeId: string,
  keywords: Set<string>,
  directCharClass = '[A-Za-z_][\\w]*',
): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = new RegExp(`(?<![.[\\w])(${directCharClass})\\s*\\(`, 'g');
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (keywords.has(name)) continue;
    sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

export function extractGoCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  return extractSimpleCallSites(source, filePath, fileNodeId, GO_KEYWORDS);
}

export function extractJavaCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  return extractSimpleCallSites(source, filePath, fileNodeId, JAVA_KEYWORDS, '[A-Za-z_$][\\w$]*');
}

export function extractRustCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  return extractSimpleCallSites(source, filePath, fileNodeId, RUST_KEYWORDS);
}

// ── Main extractor: dispatches by file extension ─────────────────────────────

export function extractCallSites(
  source: string,
  filePath: string,
  fileNodeId: string,
  ext: string,
): CallSite[] {
  if (GO_EXTS.has(ext)) return extractGoCallSites(source, filePath, fileNodeId);
  if (JAVA_EXTS.has(ext)) return extractJavaCallSites(source, filePath, fileNodeId);
  if (RUST_EXTS.has(ext)) return extractRustCallSites(source, filePath, fileNodeId);

  const sites: CallSite[] = [];

  if (TS_JS_EXTS.has(ext) || CJS_MJS_EXTS.has(ext)) {
    const methodPattern = /(\w+)\.(\w+)\s*(?:<[^>]*>\s*)?\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodPattern.exec(source)) !== null) {
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
    }

    const chainedPattern = /[)\]]\s*\.(\w+)\s*(?:<[^>]*>\s*)?\(/g;
    while ((m = chainedPattern.exec(source)) !== null) {
      const name = m[1];
      if (JS_KEYWORDS.has(name)) continue;
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `?.${name}`, form: 'method', methodName: name });
    }

    const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
    while ((m = directPattern.exec(source)) !== null) {
      const name = m[1];
      if (JS_KEYWORDS.has(name)) continue;
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct', methodName: name });
    }

    const newPattern = /\bnew\s+([A-Z][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
    while ((m = newPattern.exec(source)) !== null) {
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `new ${m[1]}`, form: 'direct', methodName: m[1] });
    }

    const dynamicPattern = /\w+\s*\[[\w'"` ]+\]\s*\(/g;
    while ((m = dynamicPattern.exec(source)) !== null) {
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: m[0], form: 'dynamic' });
    }
  } else if (PY_EXTS.has(ext)) {
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodPattern.exec(source)) !== null) {
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
    }

    const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
      const name = m[1];
      if (PY_KEYWORDS.has(name)) continue;
      sites.push({ offset: m.index, callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct', methodName: name });
    }
  }

  return sites;
}

// ── Constructor assignment tracking ──────────────────────────────────────────

export function extractConstructorAssignments(source: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+([A-Z][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    result.set(m[1], m[2]);
  }
  return result;
}
