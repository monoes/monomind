import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname, resolve as resolvePath } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode } from '../../types.js';
import { makeId } from '../../types.js';
import type { ParseOutput } from './parse.js';

// ── Output ────────────────────────────────────────────────────────────────────

export interface ScopeResolutionOutput {
  resolvedEdges: number;
  skippedDynamic: number;
  ambiguous: number;
  reexportEdges: number;
  orphanImportsRemoved: number;
  importsReconstructed: number;
}

// ── Call site ─────────────────────────────────────────────────────────────────

interface CallSite {
  callerFileNodeId: string;
  callerFilePath: string;
  calleeRaw: string;
  form: 'method' | 'direct' | 'dynamic';
  receiverName?: string;
  methodName?: string;
}

// ── JS/TS keywords to skip for direct calls ───────────────────────────────────

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

// ── Supported extensions ──────────────────────────────────────────────────────

const TS_JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const PY_EXTS = new Set(['.py']);
const GO_EXTS = new Set(['.go']);
const JAVA_EXTS = new Set(['.java']);
const RUST_EXTS = new Set(['.rs']);

const CJS_MJS_EXTS = new Set(['.cjs', '.mjs']);

function isSupportedExt(ext: string): boolean {
  return TS_JS_EXTS.has(ext) || CJS_MJS_EXTS.has(ext) || PY_EXTS.has(ext) || GO_EXTS.has(ext) || JAVA_EXTS.has(ext) || RUST_EXTS.has(ext);
}

// ── Language-specific extractors ──────────────────────────────────────────────

export function extractGoCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (GO_KEYWORDS.has(name)) continue;
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

export function extractJavaCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (JAVA_KEYWORDS.has(name)) continue;
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

export function extractRustCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (RUST_KEYWORDS.has(name)) continue;
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

// ── Stage 0.5: Track constructor assignments for type-aware method resolution ─

/**
 * Scan source for `const/let/var x = new ClassName(...)` patterns.
 * Returns a map: localVarName → ClassName (e.g. "svc" → "MyService").
 */
function extractConstructorAssignments(source: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+([A-Z][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    result.set(m[1], m[2]);
  }
  return result;
}

// ── Stage 1 + 2: Extract and classify call sites ──────────────────────────────

function extractCallSites(
  source: string,
  filePath: string,
  fileNodeId: string,
  ext: string,
): CallSite[] {
  const sites: CallSite[] = [];

  if (TS_JS_EXTS.has(ext) || CJS_MJS_EXTS.has(ext)) {
    // Method calls: word.word( or word.word<T>(
    const methodPattern = /(\w+)\.(\w+)\s*(?:<[^>]*>\s*)?\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: `${m[1]}.${m[2]}`,
        form: 'method',
        receiverName: m[1],
        methodName: m[2],
      });
    }

    // Chained method calls: ).method( or ].method( — receiver unknown, resolve by method name
    const chainedPattern = /[)\]]\s*\.(\w+)\s*(?:<[^>]*>\s*)?\(/g;
    while ((m = chainedPattern.exec(source)) !== null) {
      const name = m[1];
      if (JS_KEYWORDS.has(name)) continue;
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: `?.${name}`,
        form: 'method',
        methodName: name,
      });
    }

    // Direct calls: word( or word<T>( — not preceded by . or word char
    const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
    while ((m = directPattern.exec(source)) !== null) {
      const name = m[1];
      if (JS_KEYWORDS.has(name)) continue;
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: name,
        form: 'direct',
        methodName: name,
      });
    }

    // Constructor calls: new ClassName( or new ClassName<T>(
    const newPattern = /\bnew\s+([A-Z][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
    while ((m = newPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: `new ${m[1]}`,
        form: 'direct',
        methodName: m[1],
      });
    }

    // Dynamic calls: obj[key]( → mark as dynamic
    const dynamicPattern = /\w+\s*\[[\w'"` ]+\]\s*\(/g;
    while ((m = dynamicPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: m[0],
        form: 'dynamic',
      });
    }
  } else if (PY_EXTS.has(ext)) {
    // Method calls: self.method( or obj.method(
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: `${m[1]}.${m[2]}`,
        form: 'method',
        receiverName: m[1],
        methodName: m[2],
      });
    }

    // Direct calls: word( not preceded by . or word char
    const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
      const name = m[1];
      if (PY_KEYWORDS.has(name)) continue;
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: name,
        form: 'direct',
        methodName: name,
      });
    }
  } else if (GO_EXTS.has(ext)) {
    return extractGoCallSites(source, filePath, fileNodeId);
  } else if (JAVA_EXTS.has(ext)) {
    return extractJavaCallSites(source, filePath, fileNodeId);
  } else if (RUST_EXTS.has(ext)) {
    return extractRustCallSites(source, filePath, fileNodeId);
  }

  return sites;
}

// ── Stage 3: Build import maps by parsing source imports ─────────────────────

const IMPORT_RE = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+)))?\s+from\s+['"]([^'"]+)['"]/g;

// CJS require: const x = require('y') or const { a, b } = require('y')
const REQUIRE_RE = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Python: from x import y, z  OR  import x
const PY_FROM_IMPORT_RE = /from\s+([\w.]+)\s+import\s+(.+)/g;
const PY_IMPORT_RE = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm;

// Go: import "path" or import ( "path" )
const GO_IMPORT_RE = /import\s+(?:"([^"]+)"|(?:\w+\s+)?"([^"]+)"|\(\s*([\s\S]*?)\s*\))/g;

// Java: import com.foo.Bar;
const JAVA_IMPORT_RE = /import\s+(?:static\s+)?([\w.]+)\s*;/g;

// Rust: use crate::module::Item; or use super::foo;
const RUST_USE_RE = /use\s+((?:crate|super|self)(?:::\w+)+)(?:::\{([^}]+)\})?;/g;

// TS/JS re-exports: export { foo, bar } from './module'
const REEXPORT_RE = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];
const PY_RESOLVE_EXTS = ['.py'];
const GO_RESOLVE_EXTS = ['.go'];
const JAVA_RESOLVE_EXTS = ['.java'];
const RUST_RESOLVE_EXTS = ['.rs'];

const workspacePackageMapCache = new Map<string, Map<string, string>>();

/** Invalidate the cached workspace package map for a repo — call at the start
 * of each build so long-lived processes (watch mode) pick up package.json
 * additions/removals instead of serving a stale map from a prior build. */
export function clearWorkspacePackageMapCache(repoPath: string): void {
  workspacePackageMapCache.delete(repoPath);
}

/**
 * Build package-name → directory map from workspace package.json files.
 * Scans packages/ for package.json and maps npm name to its relative src path.
 * Cached per repoPath — multiple pipeline phases (cross-file, scope-resolution,
 * the latter's own re-export loop) call this per-file/per-edge within the same
 * build, and the workspace's package.json set doesn't change mid-build.
 */
export function buildWorkspacePackageMap(repoPath: string): Map<string, string> {
  const cached = workspacePackageMapCache.get(repoPath);
  if (cached) return cached;
  const result = new Map<string, string>();
  const packagesDir = join(repoPath, 'packages');
  try {
    const scanDirs = (base: string, depth: number) => {
      if (depth > 2) return;
      let entries: string[];
      try { entries = require('fs').readdirSync(base); } catch { return; }
      for (const e of entries) {
        const full = join(base, e);
        const pkgJson = join(full, 'package.json');
        try {
          const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
          if (pkg.name) {
            const relDir = full.slice(repoPath.length + 1); // e.g. packages/@monomind/cli
            result.set(pkg.name, relDir);
          }
        } catch {
          // No package.json — recurse for @scoped dirs
          if (e.startsWith('@')) scanDirs(full, depth + 1);
        }
      }
    };
    scanDirs(packagesDir, 0);
  } catch { /* no packages dir */ }
  workspacePackageMapCache.set(repoPath, result);
  return result;
}

export function resolveModuleSpecifier(
  importerPath: string,
  specifier: string,
  repoPath: string,
  knownFiles: Set<string>,
  workspaceMap: Map<string, string>,
): string | null {
  if (specifier.startsWith('.')) {
    const dir = dirname(importerPath);
    const raw = resolvePath('/', dir, specifier).slice(1);
    // Strip .js/.jsx — TS source uses .js extensions but files are .ts
    const base = raw.replace(/\.(js|jsx)$/, '');

    for (const candidate of [
      raw,
      base,
      ...RESOLVE_EXTS.map(e => base + e),
      ...RESOLVE_EXTS.map(e => base + '/index' + e),
    ]) {
      if (knownFiles.has(candidate)) return candidate;
    }

    for (const ext of RESOLVE_EXTS) {
      if (existsSync(join(repoPath, base + ext))) return base + ext;
    }
    return null;
  }

  // Workspace package specifier: @monomind/hooks → packages/@monomind/hooks/src/index.ts
  // Also handles subpath: @monomind/hooks/src/foo → packages/@monomind/hooks/src/foo.ts
  for (const [pkgName, pkgDir] of workspaceMap) {
    if (specifier === pkgName) {
      // Bare import: resolve to package entry point (src/index.ts)
      for (const entry of RESOLVE_EXTS.map(e => pkgDir + '/src/index' + e)) {
        if (knownFiles.has(entry)) return entry;
      }
      return null;
    }
    if (specifier.startsWith(pkgName + '/')) {
      const subpath = specifier.slice(pkgName.length + 1);
      const base = pkgDir + '/' + subpath;
      for (const candidate of [
        base,
        ...RESOLVE_EXTS.map(e => base + e),
        ...RESOLVE_EXTS.map(e => base + '/index' + e),
      ]) {
        if (knownFiles.has(candidate)) return candidate;
      }
      return null;
    }
  }

  return null;
}

function resolvePythonModule(importerPath: string, modulePath: string, knownFiles: Set<string>): string | null {
  // Try relative to importer's directory, then absolute from repo root
  const dir = dirname(importerPath);
  for (const base of [dir + '/' + modulePath, modulePath]) {
    for (const candidate of [base + '.py', base + '/__init__.py']) {
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

function resolveGoPackage(importerPath: string, goPath: string, knownFiles: Set<string>): string | null {
  for (const f of knownFiles) {
    if (f.startsWith(goPath + '/') && f.endsWith('.go')) return f;
  }
  return null;
}

function resolveJavaImport(qualifiedName: string, knownFiles: Set<string>): string | null {
  // com.foo.Bar → com/foo/Bar.java or src/main/java/com/foo/Bar.java
  const pathPart = qualifiedName.replace(/\./g, '/');
  for (const candidate of [pathPart + '.java', 'src/main/java/' + pathPart + '.java', 'src/' + pathPart + '.java']) {
    if (knownFiles.has(candidate)) return candidate;
  }
  // Wildcard: com.foo.* → find any .java file in com/foo/
  if (pathPart.endsWith('/*')) {
    const dir = pathPart.slice(0, -2);
    for (const f of knownFiles) {
      if (f.endsWith('.java') && (f.startsWith(dir + '/') || f.includes('/' + dir + '/'))) return f;
    }
  }
  return null;
}

function resolveRustUse(usePath: string, importerPath: string, knownFiles: Set<string>): string | null {
  // crate::module::item → src/module.rs or src/module/mod.rs
  const parts = usePath.split('::');
  if (parts[0] === 'crate') parts[0] = 'src';
  else if (parts[0] === 'super') {
    const dir = dirname(importerPath);
    parts[0] = dirname(dir);
  } else if (parts[0] === 'self') {
    parts[0] = dirname(importerPath);
  }
  // Last segment is the item name — try with and without it
  for (let len = parts.length; len >= 2; len--) {
    const base = parts.slice(0, len).join('/');
    for (const candidate of [base + '.rs', base + '/mod.rs']) {
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

function extractImportNames(clause: string): string[] {
  return clause
    .split(',')
    .map(s => s.trim().split(/\s+as\s+/).pop()!.trim())
    .filter(Boolean);
}

/**
 * Parse each file's import statements to build importedName → resolvedFilePath maps.
 * Replaces the broken DB-edge approach (IMPORTS edges target Variable nodes, not Files).
 */
function buildAllImportMapsFromSource(
  repoPath: string,
  fileNodesByPath: Map<string, MonographNode>,
  fileContents?: Map<string, string>,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  const knownFiles = new Set(fileNodesByPath.keys());
  const workspaceMap = buildWorkspacePackageMap(repoPath);

  for (const [filePath, fileNode] of fileNodesByPath) {
    const ext = extname(filePath).toLowerCase();
    const importMap = new Map<string, string>();

    let source: string | undefined = fileContents?.get(filePath);
    if (!source) {
      try {
        source = readFileSync(join(repoPath, filePath), 'utf-8');
      } catch {
        continue;
      }
    }

    if (TS_JS_EXTS.has(ext) || ext === '.cjs' || ext === '.mjs') {
      // ESM imports
      IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMPORT_RE.exec(source)) !== null) {
        const specifier = m[7];
        const resolved = resolveModuleSpecifier(filePath, specifier, repoPath, knownFiles, workspaceMap);
        if (!resolved) continue;

        if (m[1]) for (const n of extractImportNames(m[1])) importMap.set(n, resolved);
        if (m[4]) for (const n of extractImportNames(m[4])) importMap.set(n, resolved);
        if (m[2]) importMap.set(m[2], resolved);
        if (m[5]) importMap.set(m[5], resolved);
        if (m[3]) importMap.set(m[3], resolved);
        if (m[6]) importMap.set(m[6], resolved);
        const baseName = resolved.split('/').pop()!.replace(/\.\w+$/, '');
        importMap.set(baseName, resolved);
      }

      // CJS require()
      REQUIRE_RE.lastIndex = 0;
      while ((m = REQUIRE_RE.exec(source)) !== null) {
        const specifier = m[3];
        const resolved = resolveModuleSpecifier(filePath, specifier, repoPath, knownFiles, workspaceMap);
        if (!resolved) continue;
        if (m[1]) for (const n of extractImportNames(m[1])) importMap.set(n, resolved);
        if (m[2]) importMap.set(m[2], resolved);
        const baseName = resolved.split('/').pop()!.replace(/\.\w+$/, '');
        importMap.set(baseName, resolved);
      }
    } else if (PY_EXTS.has(ext)) {
      // Python: from module import name
      PY_FROM_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PY_FROM_IMPORT_RE.exec(source)) !== null) {
        const modulePath = m[1].replace(/\./g, '/');
        const resolved = resolvePythonModule(filePath, modulePath, knownFiles);
        if (!resolved) continue;
        for (const name of m[2].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean)) {
          importMap.set(name, resolved);
        }
        const baseName = resolved.split('/').pop()!.replace(/\.\w+$/, '');
        importMap.set(baseName, resolved);
      }
      // Python: import module
      PY_IMPORT_RE.lastIndex = 0;
      while ((m = PY_IMPORT_RE.exec(source)) !== null) {
        const modulePath = m[1].replace(/\./g, '/');
        const resolved = resolvePythonModule(filePath, modulePath, knownFiles);
        if (!resolved) continue;
        const alias = m[2] ?? m[1].split('.').pop()!;
        importMap.set(alias, resolved);
      }
    } else if (GO_EXTS.has(ext)) {
      GO_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = GO_IMPORT_RE.exec(source)) !== null) {
        const paths = m[3]
          ? m[3].match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) ?? []
          : [m[1] ?? m[2]].filter(Boolean);
        for (const goPath of paths) {
          const resolved = resolveGoPackage(filePath, goPath, knownFiles);
          if (!resolved) continue;
          const pkgName = goPath.split('/').pop()!;
          importMap.set(pkgName, resolved);
        }
      }
    } else if (JAVA_EXTS.has(ext)) {
      JAVA_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = JAVA_IMPORT_RE.exec(source)) !== null) {
        const resolved = resolveJavaImport(m[1], knownFiles);
        if (!resolved) continue;
        const className = m[1].split('.').pop()!;
        importMap.set(className, resolved);
      }
    } else if (RUST_EXTS.has(ext)) {
      RUST_USE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RUST_USE_RE.exec(source)) !== null) {
        if (m[2]) {
          // use crate::module::{Item1, Item2}
          for (const name of m[2].split(',').map(s => s.trim()).filter(Boolean)) {
            const resolved = resolveRustUse(m[1] + '::' + name, filePath, knownFiles);
            if (resolved) importMap.set(name.split('::').pop()!, resolved);
          }
        } else {
          const resolved = resolveRustUse(m[1], filePath, knownFiles);
          if (!resolved) continue;
          const itemName = m[1].split('::').pop()!;
          importMap.set(itemName, resolved);
        }
      }
    }

    if (importMap.size > 0) {
      result.set(fileNode.id, importMap);
    }
  }

  return result;
}

function getImportMap(
  allImportMaps: Map<string, Map<string, string>>,
  fileNodeId: string,
): Map<string, string> {
  return allImportMaps.get(fileNodeId) ?? new Map();
}

// ── Stage 4 helpers: preloaded function/method index ──────────────────────────

/**
 * Load all callable nodes once (Function, Method, Constructor, Class).
 * Class is included so `new ClassName()` can resolve to Class nodes.
 */
function buildFunctionIndex(ctx: PipelineContext): {
  byFilePath: Map<string, Map<string, string[]>>;
  nameCounts: Map<string, number>;
} {
  const byFilePath = new Map<string, Map<string, string[]>>();
  const nameCounts = new Map<string, number>();

  if (!ctx.db) return { byFilePath, nameCounts };

  const rows = ctx.db
    .prepare(`SELECT id, name, file_path FROM nodes WHERE label IN ('Function', 'Method', 'Constructor', 'Class') AND file_path IS NOT NULL`)
    .all() as { id: string; name: string; file_path: string }[];

  for (const row of rows) {
    // byFilePath index
    let fileMap = byFilePath.get(row.file_path);
    if (!fileMap) {
      fileMap = new Map();
      byFilePath.set(row.file_path, fileMap);
    }
    let ids = fileMap.get(row.name);
    if (!ids) {
      ids = [];
      fileMap.set(row.name, ids);
    }
    ids.push(row.id);

    // global count for ambiguity detection
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }

  return { byFilePath, nameCounts };
}

// ── Stage 4 + 5: Resolve target node (index-based, no per-call DB query) ──────

function pickBestId(ids: string[], site: CallSite): string | null {
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) return null;
  // Disambiguate: prefer Function for direct calls, Method for method calls
  const suffix = site.form === 'method' ? '_method' : '_function';
  const match = ids.find(id => id.endsWith(suffix));
  // For `new ClassName()` prefer _class
  if (!match && site.calleeRaw.startsWith('new ')) {
    const classMatch = ids.find(id => id.endsWith('_class'));
    if (classMatch) return classMatch;
  }
  return match ?? ids[0];
}

function resolveTarget(
  site: CallSite,
  callerFilePath: string,
  importMap: Map<string, string>,
  fnIndex: Map<string, Map<string, string[]>>,
  ctorMap: Map<string, string> | undefined,
  importedFiles: string[],
): { targetId: string } | null {
  const methodName = site.methodName;
  if (!methodName) return null;

  let candidateFilePaths: string[];

  if (site.form === 'method' && site.receiverName) {
    const receiverPath = importMap.get(site.receiverName);
    if (receiverPath) {
      candidateFilePaths = [receiverPath];
    } else {
      const className = ctorMap?.get(site.receiverName);
      const classFilePath = className ? importMap.get(className) : undefined;
      if (classFilePath) {
        candidateFilePaths = [classFilePath, callerFilePath];
      } else {
        const sameFileIds = fnIndex.get(callerFilePath)?.get(methodName);
        if (sameFileIds && sameFileIds.length > 0) {
          return { targetId: pickBestId(sameFileIds, site)! };
        }
        const matches = importedFiles.filter(fp => fnIndex.get(fp)?.has(methodName));
        if (matches.length === 1) {
          const ids = fnIndex.get(matches[0])!.get(methodName)!;
          return { targetId: pickBestId(ids, site)! };
        }
        return null;
      }
    }
  } else if (site.form === 'direct') {
    const importedFrom = importMap.get(methodName);
    if (importedFrom) {
      candidateFilePaths = [importedFrom, callerFilePath];
    } else {
      candidateFilePaths = [callerFilePath, ...importedFiles];
    }
  } else {
    return null;
  }

  for (const fp of candidateFilePaths) {
    const ids = fnIndex.get(fp)?.get(methodName);
    if (ids && ids.length > 0) {
      const best = pickBestId(ids, site);
      if (best) return { targetId: best };
    }
  }

  return null;
}

// ── Stage 6: Emit edge ────────────────────────────────────────────────────────

interface PreparedEdgeStmts {
  selectExisting: import('better-sqlite3').Statement;
  updateScore: import('better-sqlite3').Statement;
  insertNew: import('better-sqlite3').Statement;
}

function prepareEdgeStmts(db: import('better-sqlite3').Database): PreparedEdgeStmts {
  return {
    selectExisting: db.prepare(
      `SELECT id, confidence_score FROM edges WHERE source_id = ? AND target_id = ? AND relation = 'CALLS'`
    ),
    updateScore: db.prepare(
      `UPDATE edges SET confidence_score = ?, confidence = 'EXTRACTED' WHERE id = ?`
    ),
    insertNew: db.prepare(
      `INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', ?)`
    ),
  };
}

const RESOLVED_CONFIDENCE_SCORE = 0.75;

function emitEdge(
  stmts: PreparedEdgeStmts,
  sourceId: string,
  targetId: string,
): 'inserted' | 'upgraded' | 'skipped' {
  if (sourceId === targetId) return 'skipped';

  const existing = stmts.selectExisting.get(sourceId, targetId) as { id: string; confidence_score: number } | undefined;

  if (existing) {
    const newScore = Math.max(existing.confidence_score, RESOLVED_CONFIDENCE_SCORE);
    if (newScore > existing.confidence_score) {
      stmts.updateScore.run(newScore, existing.id);
    }
    return 'upgraded';
  }

  const edgeId = makeId(sourceId, targetId, 'calls_resolved');
  try {
    stmts.insertNew.run(edgeId, sourceId, targetId, RESOLVED_CONFIDENCE_SCORE);
    return 'inserted';
  } catch {
    return 'skipped';
  }
}

// ── Phase definition ──────────────────────────────────────────────────────────

export const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput> = {
  name: 'scope-resolution',
  deps: ['parse', 'cross-file'],
  async execute(ctx, deps) {
    if (ctx.allFilesCached) {
      return { resolvedEdges: 0, skippedDynamic: 0, ambiguous: 0, reexportEdges: 0, orphanImportsRemoved: 0, importsReconstructed: 0 };
    }
    const { symbolNodes } = deps.get('parse') as ParseOutput;

    let resolvedEdges = 0;
    let skippedDynamic = 0;
    let ambiguous = 0;

    // ── Batch preload: one query per table instead of one per file/call-site ──

    // Build a map from file_path → file node id using the parse output
    const fileNodesByPath = new Map<string, MonographNode>();
    for (const node of symbolNodes) {
      if (node.label === 'File' && node.filePath) {
        fileNodesByPath.set(node.filePath, node);
      }
    }

    // Also look up File nodes from the DB (includes nodes created by structure phase)
    if (ctx.db) {
      const dbFileNodes = ctx.db
        .prepare(`SELECT id, file_path FROM nodes WHERE label = 'File'`)
        .all() as { id: string; file_path: string }[];
      for (const row of dbFileNodes) {
        if (row.file_path && !fileNodesByPath.has(row.file_path)) {
          fileNodesByPath.set(row.file_path, {
            id: row.id,
            label: 'File',
            name: row.file_path.split('/').pop() ?? row.file_path,
            normLabel: '',
            filePath: row.file_path,
            isExported: false,
          });
        }
      }
    }

    // Parse source imports → per-file import maps (replaces broken DB-edge approach)
    const { fileContents } = deps.get('parse') as ParseOutput;
    const allImportMaps = buildAllImportMapsFromSource(ctx.repoPath, fileNodesByPath, fileContents);

    // Preload all Function/Method/Constructor nodes into indices (one DB query total)
    const { byFilePath: fnIndex, nameCounts } = buildFunctionIndex(ctx);

    const edgeStmts = ctx.db ? prepareEdgeStmts(ctx.db) : null;
    const resolveAllCalls = ctx.db?.transaction(() => {
      for (const [filePath, fileNode] of fileNodesByPath) {
        const ext = extname(filePath).toLowerCase();
        if (!isSupportedExt(ext)) continue;

        // Read file source (prefer cached from parse phase)
        let source: string | undefined = fileContents.get(filePath);
        if (!source) {
          try {
            source = readFileSync(join(ctx.repoPath, filePath), 'utf-8');
          } catch {
            continue;
          }
        }

        // Stage 1+2: Extract call sites
        const callSites = extractCallSites(source, filePath, fileNode.id, ext);

        // Stage 3: Get pre-built import map for this file (O(1))
        const importMap = getImportMap(allImportMaps, fileNode.id);

        // Track constructor assignments for type-aware method resolution
        const ctorMap = (TS_JS_EXTS.has(ext) || CJS_MJS_EXTS.has(ext)) ? extractConstructorAssignments(source) : undefined;

        // Precompute once per file instead of per call site
        const importedFiles = [...new Set(importMap.values())];

        for (const site of callSites) {
          if (site.form === 'dynamic') {
            skippedDynamic++;
            continue;
          }

          // Stage 4+5: Resolve target using preloaded indices (no DB query)
          const resolved = resolveTarget(site, filePath, importMap, fnIndex, ctorMap, importedFiles);

          if (!resolved) {
            continue;
          }

          // Ambiguity check using preloaded name counts (no DB query)
          if (site.methodName && (nameCounts.get(site.methodName) ?? 0) > 1) {
            ambiguous++;
          }

          // Stage 6: Emit edge (source is the file node of the caller)
          const result = edgeStmts ? emitEdge(edgeStmts, site.callerFileNodeId, resolved.targetId) : 'skipped';
          if (result === 'inserted' || result === 'upgraded') {
            resolvedEdges++;
          }
        }
      }
    });
    resolveAllCalls?.();

    // Scan for re-exports: export { foo, bar } from './module'
    // Creates REFERENCES edges so re-exported symbols don't appear as dead code.
    let reexportEdges = 0;
    if (ctx.db) {
      const insertRef = ctx.db.prepare(`
        INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
        VALUES (?, ?, ?, 'REFERENCES', 'EXTRACTED', 0.85)
      `);
      const insertReexports = ctx.db.transaction(() => {
        for (const [filePath, fileNode] of fileNodesByPath) {
          const ext = extname(filePath).toLowerCase();
          if (!TS_JS_EXTS.has(ext) && !CJS_MJS_EXTS.has(ext)) continue;

          let source: string | undefined = fileContents.get(filePath);
          if (!source) { try { source = readFileSync(join(ctx.repoPath, filePath), 'utf-8'); } catch { continue; } }

          const importMap = getImportMap(allImportMaps, fileNode.id);
          REEXPORT_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = REEXPORT_RE.exec(source)) !== null) {
            const specifier = m[2];
            const names = extractImportNames(m[1]);
            // Resolve the source module
            const knownFiles = new Set(fileNodesByPath.keys());
            const workspaceMap = buildWorkspacePackageMap(ctx.repoPath);
            const resolvedFile = resolveModuleSpecifier(filePath, specifier, ctx.repoPath, knownFiles, workspaceMap);
            if (!resolvedFile) continue;

            for (const name of names) {
              // Find the function/class node in the source file
              const ids = fnIndex.get(resolvedFile)?.get(name);
              if (!ids || ids.length === 0) continue;
              const targetId = ids.length === 1 ? ids[0] : (ids.find(id => id.endsWith('_function')) ?? ids[0]);
              const edgeId = makeId(fileNode.id, targetId, 'reexport_ref');
              try {
                insertRef.run(edgeId, fileNode.id, targetId);
                reexportEdges++;
              } catch { /* duplicate */ }
            }
          }
        }
      });
      insertReexports();
    }

    // Clean up orphan IMPORTS edges that target Variable nodes instead of Files.
    let orphanImportsRemoved = 0;
    if (ctx.db) {
      const result = ctx.db
        .prepare(`
          DELETE FROM edges WHERE id IN (
            SELECT e.id FROM edges e
            JOIN nodes t ON e.target_id = t.id
            WHERE e.relation = 'IMPORTS' AND t.label = 'Variable'
          )
        `)
        .run();
      orphanImportsRemoved = result.changes;
    }

    // Reconstruct proper File→File IMPORTS edges from source-parsed import maps.
    let importsReconstructed = 0;
    if (ctx.db) {
      const insertImport = ctx.db.prepare(`
        INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
        VALUES (?, ?, ?, 'IMPORTS', 'EXTRACTED', 0.9)
      `);
      const fileIdByPath = new Map<string, string>();
      for (const [fp, node] of fileNodesByPath) fileIdByPath.set(fp, node.id);

      const insertAll = ctx.db.transaction(() => {
        for (const [fileNodeId, importMap] of allImportMaps) {
          const targetPaths = new Set(importMap.values());
          for (const targetPath of targetPaths) {
            const targetFileId = fileIdByPath.get(targetPath);
            if (!targetFileId || targetFileId === fileNodeId) continue;
            const edgeId = makeId(fileNodeId, targetFileId, 'imports_file');
            try {
              insertImport.run(edgeId, fileNodeId, targetFileId);
              importsReconstructed++;
            } catch { /* duplicate — already exists */ }
          }
        }
      });
      insertAll();
    }

    return { resolvedEdges, skippedDynamic, ambiguous, reexportEdges, orphanImportsRemoved, importsReconstructed };
  },
};
