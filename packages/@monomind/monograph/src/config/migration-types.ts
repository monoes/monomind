export interface MigrationWarning {
  source: string;
  field: string;
  message: string;
  suggestion?: string;
}

export interface MigrationResult<T = unknown> {
  config: T;
  warnings: MigrationWarning[];
  sources: string[];
}

export type MigrationSourceKind = 'knip' | 'jscpd' | 'fallow' | 'auto';

export interface MigrationSource {
  kind: MigrationSourceKind;
  filePath: string;
}

export const KNIP_CONFIG_FILENAMES = [
  'knip.json',
  'knip.jsonc',
  '.knip.json',
  '.knip.jsonc',
  'knip.ts',
  'knip.js',
  'knip.config.ts',
  'knip.config.js',
] as const;

export const JSCPD_CONFIG_FILENAMES = [
  '.jscpd.json',
  '.jscpd.yaml',
  '.jscpd.yml',
] as const;

export const KNOWN_KNIP_FIELDS = new Set([
  'entry', 'project', 'ignore', 'ignoreBinaries', 'ignoreDependencies', 'ignoreExportsUsedInFile',
  'rules', 'plugins', 'workspaces', 'paths', 'typescript', 'tags',
]);

export const KNOWN_JSCPD_FIELDS = new Set([
  'threshold', 'minLines', 'minTokens', 'format', 'ignore', 'path', 'reporters',
  'output', 'blame', 'silent', 'absolute', 'gitignore', 'maxLines', 'maxSize',
]);

export function detectMigrationSource(dirPath: string, files: string[]): MigrationSource | null {
  for (const filename of KNIP_CONFIG_FILENAMES) {
    if (files.includes(filename)) {
      return { kind: 'knip', filePath: `${dirPath}/${filename}` };
    }
  }
  for (const filename of JSCPD_CONFIG_FILENAMES) {
    if (files.includes(filename)) {
      return { kind: 'jscpd', filePath: `${dirPath}/${filename}` };
    }
  }
  return null;
}

export function makeMigrationWarning(
  source: string,
  field: string,
  message: string,
  suggestion?: string,
): MigrationWarning {
  return { source, field, message, suggestion };
}

export function migrationSuccess<T>(config: T, sources: string[], warnings: MigrationWarning[] = []): MigrationResult<T> {
  return { config, warnings, sources };
}
