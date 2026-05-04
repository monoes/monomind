const KEY_ORDER = ['entry','ignorePatterns','ignoreDependencies','ignoreExportsUsedInFile','rules','duplicates'];

function indentJsonValue(json: string, spaces: number): string {
  const indent = ' '.repeat(spaces);
  const lines = json.split('\n');
  if (lines.length <= 1) return json;
  const [first, ...rest] = lines;
  return [first, ...rest.map(l => indent + l)].join('\n');
}

export function generateJsonc(config: Record<string, unknown>, sources: string[]): string {
  const schema = 'https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json';
  const entries = Object.entries(config).sort(([a], [b]) => {
    const ai = KEY_ORDER.indexOf(a), bi = KEY_ORDER.indexOf(b);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
  const lines: string[] = [
    '{',
    `  "$schema": "${schema}",`,
    `  // Migrated from ${sources.join(', ')}`,
  ];
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    const comma = i < entries.length - 1 ? ',' : '';
    const serialized = JSON.stringify(value, null, 2);
    const indented = indentJsonValue(serialized, 2);
    lines.push(`  "${key}": ${indented}${comma}`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function parseJsoncComments(input: string): Record<string, unknown> {
  const stripped = input.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped) as Record<string, unknown>;
}

export { indentJsonValue };
