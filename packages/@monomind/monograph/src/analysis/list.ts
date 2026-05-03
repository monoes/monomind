export interface BoundaryRule {
  fromZone: string;
  toZone: string;
  allowed: boolean;
}

export interface PluginInfo {
  name: string;
  version: string;
  hooks: string[];
}

export interface ListOptions {
  format?: 'human' | 'json';
}

export function listBoundaries(config: {
  zones?: Array<{ name: string; allowedDeps?: string[]; deniedDeps?: string[] }>;
}): BoundaryRule[] {
  const rules: BoundaryRule[] = [];
  for (const zone of config.zones ?? []) {
    for (const dep of zone.allowedDeps ?? []) {
      rules.push({ fromZone: zone.name, toZone: dep, allowed: true });
    }
    for (const dep of zone.deniedDeps ?? []) {
      rules.push({ fromZone: zone.name, toZone: dep, allowed: false });
    }
  }
  return rules;
}

export function listPlugins(config: {
  plugins?: Array<{ name: string; version?: string; hooks?: string[] }>;
}): PluginInfo[] {
  return (config.plugins ?? []).map((p) => ({
    name: p.name,
    version: p.version ?? '0.0.0',
    hooks: p.hooks ?? [],
  }));
}

export function listEntryPoints(config: { entryPoints?: string[] }): string[] {
  return config.entryPoints ?? [];
}

export function formatListHuman(
  items: Array<Record<string, unknown>>,
  columns: string[]
): string {
  if (items.length === 0) return '';

  // Calculate column widths from header and values
  const widths = columns.map((col) => {
    const headerLen = col.length;
    const maxValueLen = items.reduce((max, item) => {
      const val = item[col] !== undefined && item[col] !== null ? String(item[col]) : '';
      return Math.max(max, val.length);
    }, 0);
    return Math.max(headerLen, maxValueLen);
  });

  const pad = (str: string, width: number): string => str.padEnd(width);

  const header = columns.map((col, i) => pad(col, widths[i]!)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const rows = items.map((item) =>
    columns.map((col, i) => {
      const val = item[col] !== undefined && item[col] !== null ? String(item[col]) : '';
      return pad(val, widths[i]!);
    }).join('  ')
  );

  return [header, separator, ...rows].join('\n');
}
