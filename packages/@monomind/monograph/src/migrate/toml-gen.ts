export function generateToml(config: Record<string, unknown>, sources: string[]): string {
  const lines: string[] = [`# Migrated from ${sources.join(', ')}\n`];
  const simpleArrayKeys = ['entry','ignorePatterns','ignoreDependencies'];

  for (const key of simpleArrayKeys) {
    const arr = config[key];
    if (Array.isArray(arr)) {
      const items = (arr as unknown[]).filter(v => typeof v === 'string').map(v => `"${v as string}"`);
      if (items.length > 0) lines.push(`${key} = [${items.join(', ')}]`);
    }
  }

  const ieuf = config['ignoreExportsUsedInFile'];
  if (typeof ieuf === 'boolean') {
    lines.push(`ignoreExportsUsedInFile = ${ieuf}`);
  } else if (ieuf && typeof ieuf === 'object' && !Array.isArray(ieuf)) {
    const obj = ieuf as Record<string, boolean>;
    const parts = Object.entries(obj).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => `${k} = ${v}`);
    if (parts.length) lines.push(`ignoreExportsUsedInFile = { ${parts.join(', ')} }`);
  }

  const rules = config['rules'];
  if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
    const entries = Object.entries(rules as Record<string, unknown>).filter(([, v]) => typeof v === 'string');
    if (entries.length) {
      lines.push('\n[rules]');
      for (const [k, v] of entries) lines.push(`${k} = "${v as string}"`);
    }
  }

  const dupes = config['duplicates'];
  if (dupes && typeof dupes === 'object' && !Array.isArray(dupes)) {
    const entries = Object.entries(dupes as Record<string, unknown>);
    if (entries.length) {
      lines.push('\n[duplicates]');
      for (const [k, v] of entries) {
        if (typeof v === 'number') lines.push(`${k} = ${v}`);
        else if (typeof v === 'boolean') lines.push(`${k} = ${v}`);
        else if (typeof v === 'string') lines.push(`${k} = "${v}"`);
        else if (Array.isArray(v)) {
          const items = (v as unknown[]).filter(x => typeof x === 'string').map(x => `"${x as string}"`);
          lines.push(`${k} = [${items.join(', ')}]`);
        }
      }
    }
  }
  return lines.join('\n') + '\n';
}
