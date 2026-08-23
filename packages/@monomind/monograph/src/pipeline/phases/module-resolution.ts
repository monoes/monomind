// ── Module resolution for import specifiers ──────────────────────────────────

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import type { MonographNode } from '../../types.js';
import { TS_JS_EXTS } from './call-site-extractors.js';

// ── Import regexes ───────────────────────────────────────────────────────────

export const IMPORT_RE =
  /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+)))?\s+from\s+['"]([^'"]+)['"]/g;
export const REQUIRE_RE =
  /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_FROM_IMPORT_RE = /from\s+([\w.]+)\s+import\s+(.+)/g;
const PY_IMPORT_RE = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm;
const GO_IMPORT_RE = /import\s+(?:"([^"]+)"|(?:\w+\s+)?"([^"]+)"|\(\s*([\s\S]*?)\s*\))/g;
const JAVA_IMPORT_RE = /import\s+(?:static\s+)?([\w.]+)\s*;/g;
const RUST_USE_RE = /use\s+((?:crate|super|self)(?:::\w+)+)(?:::\{([^}]+)\})?;/g;
export const REEXPORT_RE = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];

const PY_EXTS = new Set(['.py']);
const GO_EXTS = new Set(['.go']);
const JAVA_EXTS = new Set(['.java']);
const RUST_EXTS = new Set(['.rs']);

// ── Workspace package map ────────────────────────────────────────────────────

const workspacePackageMapCache = new Map<string, Map<string, string>>();

export function clearWorkspacePackageMapCache(repoPath: string): void {
  workspacePackageMapCache.delete(repoPath);
}

export function buildWorkspacePackageMap(repoPath: string): Map<string, string> {
  const cached = workspacePackageMapCache.get(repoPath);
  if (cached) return cached;
  const result = new Map<string, string>();
  const packagesDir = join(repoPath, 'packages');
  try {
    const scanDirs = (base: string, depth: number) => {
      if (depth > 2) return;
      let entries: string[];
      try {
        entries = readdirSync(base);
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(base, e);
        const pkgJson = join(full, 'package.json');
        try {
          const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
          if (pkg.name) {
            const relDir = full.slice(repoPath.length + 1);
            result.set(pkg.name, relDir);
          }
        } catch {
          if (e.startsWith('@')) scanDirs(full, depth + 1);
        }
      }
    };
    scanDirs(packagesDir, 0);
  } catch {
    /* no packages dir */
  }
  workspacePackageMapCache.set(repoPath, result);
  return result;
}

// ── Specifier resolvers ──────────────────────────────────────────────────────

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
    const base = raw.replace(/\.(js|jsx)$/, '');

    for (const candidate of [
      raw,
      base,
      ...RESOLVE_EXTS.map((e) => base + e),
      ...RESOLVE_EXTS.map((e) => `${base}/index${e}`),
    ]) {
      if (knownFiles.has(candidate)) return candidate;
    }

    for (const ext of RESOLVE_EXTS) {
      if (existsSync(join(repoPath, base + ext))) return base + ext;
    }
    return null;
  }

  for (const [pkgName, pkgDir] of workspaceMap) {
    if (specifier === pkgName) {
      for (const entry of RESOLVE_EXTS.map((e) => `${pkgDir}/src/index${e}`)) {
        if (knownFiles.has(entry)) return entry;
      }
      return null;
    }
    if (specifier.startsWith(`${pkgName}/`)) {
      const subpath = specifier.slice(pkgName.length + 1);
      const base = `${pkgDir}/${subpath}`;
      for (const candidate of [
        base,
        ...RESOLVE_EXTS.map((e) => base + e),
        ...RESOLVE_EXTS.map((e) => `${base}/index${e}`),
      ]) {
        if (knownFiles.has(candidate)) return candidate;
      }
      return null;
    }
  }

  return null;
}

function resolvePythonModule(
  importerPath: string,
  modulePath: string,
  knownFiles: Set<string>,
): string | null {
  const dir = dirname(importerPath);
  for (const base of [`${dir}/${modulePath}`, modulePath]) {
    for (const candidate of [`${base}.py`, `${base}/__init__.py`]) {
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

function resolveGoPackage(
  _importerPath: string,
  goPath: string,
  knownFiles: Set<string>,
): string | null {
  for (const f of knownFiles) {
    if (f.startsWith(`${goPath}/`) && f.endsWith('.go')) return f;
  }
  return null;
}

function resolveJavaImport(qualifiedName: string, knownFiles: Set<string>): string | null {
  const pathPart = qualifiedName.replace(/\./g, '/');
  for (const candidate of [
    `${pathPart}.java`,
    `src/main/java/${pathPart}.java`,
    `src/${pathPart}.java`,
  ]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  if (pathPart.endsWith('/*')) {
    const dir = pathPart.slice(0, -2);
    for (const f of knownFiles) {
      if (f.endsWith('.java') && (f.startsWith(`${dir}/`) || f.includes(`/${dir}/`))) return f;
    }
  }
  return null;
}

function resolveRustUse(
  usePath: string,
  importerPath: string,
  knownFiles: Set<string>,
): string | null {
  const parts = usePath.split('::');
  if (parts[0] === 'crate') parts[0] = 'src';
  else if (parts[0] === 'super') {
    const dir = dirname(importerPath);
    parts[0] = dirname(dir);
  } else if (parts[0] === 'self') {
    parts[0] = dirname(importerPath);
  }
  for (let len = parts.length; len >= 2; len--) {
    const base = parts.slice(0, len).join('/');
    for (const candidate of [`${base}.rs`, `${base}/mod.rs`]) {
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

// ── Import name extraction ───────────────────────────────────────────────────

export function extractImportNames(clause: string): string[] {
  return clause
    .split(',')
    .map((s) =>
      s
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim(),
    )
    .filter((name): name is string => Boolean(name));
}

// ── Build import maps from source ────────────────────────────────────────────

export function buildAllImportMapsFromSource(
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
      IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMPORT_RE.exec(source)) !== null) {
        const specifier = m[7];
        const resolved = resolveModuleSpecifier(
          filePath,
          specifier,
          repoPath,
          knownFiles,
          workspaceMap,
        );
        if (!resolved) continue;
        if (m[1]) for (const n of extractImportNames(m[1])) importMap.set(n, resolved);
        if (m[4]) for (const n of extractImportNames(m[4])) importMap.set(n, resolved);
        if (m[2]) importMap.set(m[2], resolved);
        if (m[5]) importMap.set(m[5], resolved);
        if (m[3]) importMap.set(m[3], resolved);
        if (m[6]) importMap.set(m[6], resolved);
        const baseName = resolved
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '');
        if (baseName) importMap.set(baseName, resolved);
      }

      REQUIRE_RE.lastIndex = 0;
      while ((m = REQUIRE_RE.exec(source)) !== null) {
        const specifier = m[3];
        const resolved = resolveModuleSpecifier(
          filePath,
          specifier,
          repoPath,
          knownFiles,
          workspaceMap,
        );
        if (!resolved) continue;
        if (m[1]) for (const n of extractImportNames(m[1])) importMap.set(n, resolved);
        if (m[2]) importMap.set(m[2], resolved);
        const baseName = resolved
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '');
        if (baseName) importMap.set(baseName, resolved);
      }
    } else if (PY_EXTS.has(ext)) {
      PY_FROM_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PY_FROM_IMPORT_RE.exec(source)) !== null) {
        const modulePath = m[1].replace(/\./g, '/');
        const resolved = resolvePythonModule(filePath, modulePath, knownFiles);
        if (!resolved) continue;
        for (const name of m[2]
          .split(',')
          .map((s) =>
            s
              .trim()
              .split(/\s+as\s+/)
              .pop()
              ?.trim(),
          )
          .filter((name): name is string => Boolean(name))) {
          importMap.set(name, resolved);
        }
        const baseName = resolved
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '');
        if (baseName) importMap.set(baseName, resolved);
      }
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
          ? (m[3].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [])
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
          for (const name of m[2]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)) {
            const resolved = resolveRustUse(`${m[1]}::${name}`, filePath, knownFiles);
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
