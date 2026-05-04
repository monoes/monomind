// Three-state control for suppressing unused-export findings when an export
// is also referenced in the file that declares it.

export interface IgnoreExportsUsedInFileByKind {
  interface: boolean;
  typeAlias: boolean;
}

export type IgnoreExportsUsedInFileConfig =
  | { kind: 'disabled' }
  | { kind: 'enabled' }
  | { kind: 'byKind'; byKind: IgnoreExportsUsedInFileByKind };

export const IGNORE_EXPORTS_DISABLED: IgnoreExportsUsedInFileConfig = { kind: 'disabled' };
export const IGNORE_EXPORTS_ENABLED: IgnoreExportsUsedInFileConfig = { kind: 'enabled' };

export function ignoreExportsByKind(byKind: IgnoreExportsUsedInFileByKind): IgnoreExportsUsedInFileConfig {
  return { kind: 'byKind', byKind };
}

export function isIgnoreExportsEnabled(config: IgnoreExportsUsedInFileConfig): boolean {
  return config.kind !== 'disabled';
}

export function suppressesExport(
  config: IgnoreExportsUsedInFileConfig,
  isTypeOnly: boolean,
): boolean {
  if (config.kind === 'disabled') return false;
  if (config.kind === 'enabled') return true;
  if (isTypeOnly) return config.byKind.interface || config.byKind.typeAlias;
  return false;
}

export function parseIgnoreExportsConfig(raw: unknown): IgnoreExportsUsedInFileConfig {
  if (raw === false || raw === null || raw === undefined) return IGNORE_EXPORTS_DISABLED;
  if (raw === true) return IGNORE_EXPORTS_ENABLED;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return ignoreExportsByKind({
      interface: Boolean(obj['interface']),
      typeAlias: Boolean(obj['typeAlias'] ?? obj['type_alias']),
    });
  }
  return IGNORE_EXPORTS_DISABLED;
}
