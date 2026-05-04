export type FileId = number & { readonly __brand: 'FileId' };

export function fileId(n: number): FileId {
  return n as FileId;
}

export type EntryPointSource =
  | { kind: 'package-json-main' }
  | { kind: 'package-json-module' }
  | { kind: 'package-json-exports' }
  | { kind: 'package-json-bin' }
  | { kind: 'package-json-script' }
  | { kind: 'plugin'; name: string }
  | { kind: 'test-file' }
  | { kind: 'default-index' }
  | { kind: 'manual-entry' }
  | { kind: 'infrastructure-config' }
  | { kind: 'dynamically-loaded' };

export interface FallowEntryPoint {
  path: string;
  source: EntryPointSource;
}

export function formatEntryPointSource(source: EntryPointSource): string {
  switch (source.kind) {
    case 'package-json-main':    return 'package.json[main]';
    case 'package-json-module':  return 'package.json[module]';
    case 'package-json-exports': return 'package.json[exports]';
    case 'package-json-bin':     return 'package.json[bin]';
    case 'package-json-script':  return 'package.json[scripts]';
    case 'plugin':               return `plugin:${source.name}`;
    case 'test-file':            return 'test-file';
    case 'default-index':        return 'default-index';
    case 'manual-entry':         return 'manual';
    case 'infrastructure-config': return 'infra-config';
    case 'dynamically-loaded':   return 'dynamic';
  }
}

export interface FallowDiscoveredFile {
  id: FileId;
  path: string;
  sizeBytes: number;
}
