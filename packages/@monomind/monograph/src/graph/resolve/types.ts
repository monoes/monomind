export type FileId = number;

export type ResolveResult =
  | { kind: 'InternalModule'; fileId: FileId }
  | { kind: 'ExternalFile'; path: string }
  | { kind: 'NpmPackage'; name: string }
  | { kind: 'Unresolvable'; specifier: string };

export interface ImportInfo {
  specifier: string;
  isDynamic?: boolean;
  isTypeOnly?: boolean;
  span?: { start: number; end: number };
}

export interface ReExportInfo {
  specifier: string;
  isTypeOnly?: boolean;
}

export interface ResolvedImport {
  info: ImportInfo;
  target: ResolveResult;
}

export interface ResolvedReExport {
  info: ReExportInfo;
  target: ResolveResult;
}

export interface DynamicImportPattern {
  pattern: string;
  fromFile: string;
}

export interface ResolvedModule {
  fileId: FileId;
  path: string;
  resolvedImports: ResolvedImport[];
  resolvedReExports: ResolvedReExport[];
  resolvedDynamicImports: ResolvedImport[];
  resolvedDynamicPatterns: Array<[DynamicImportPattern, FileId[]]>;
  unusedImportBindings: Set<string>;
  typeReferencedImportBindings: string[];
  valueReferencedImportBindings: string[];
  hasCjsExports: boolean;
}

export interface CanonicalFallback {
  files: DiscoveredFile[];
  map: Map<string, FileId> | null;
}

export interface DiscoveredFile {
  path: string;
  fileId: FileId;
  canonicalPath?: string;
}

export interface WorkspaceInfo {
  root: string;
  name?: string;
}

export interface ResolveContext {
  pathToId: Map<string, FileId>;
  rawPathToId: Map<string, FileId>;
  workspaceRoots: Map<string, string>;
  pathAliases: Array<[string, string]>;
  scssIncludePaths: string[];
  root: string;
  canonicalFallback?: CanonicalFallback;
  tsconfigWarned: Set<string>;
  activePlugins: string[];
  extraConditions: string[];
}

export const OUTPUT_DIRS = ['dist', 'build', 'out', 'esm', 'cjs', '.next', '.nuxt', '.svelte-kit'] as const;

export const SOURCE_EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] as const;

export const RN_PLATFORM_PREFIXES = ['.web', '.ios', '.android', '.native'] as const;

export function getOrBuildCanonicalMap(fallback: CanonicalFallback): Map<string, FileId> {
  if (!fallback.map) {
    fallback.map = new Map(
      fallback.files
        .filter(f => f.canonicalPath)
        .map(f => [f.canonicalPath!, f.fileId])
    );
  }
  return fallback.map;
}

export function makeResolvedModule(fileId: FileId, path: string): ResolvedModule {
  return {
    fileId,
    path,
    resolvedImports: [],
    resolvedReExports: [],
    resolvedDynamicImports: [],
    resolvedDynamicPatterns: [],
    unusedImportBindings: new Set(),
    typeReferencedImportBindings: [],
    valueReferencedImportBindings: [],
    hasCjsExports: false,
  };
}
