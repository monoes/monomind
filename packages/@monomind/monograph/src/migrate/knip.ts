import { readFileSync, existsSync } from 'fs';

export interface MigrationWarning {
  field: string;
  message: string;
  knipValue: unknown;
}

export interface KnipMigrationResult {
  monographConfig: Record<string, unknown>;   // .monographrc.json content
  warnings: MigrationWarning[];
  inputFile: string;
}

const KNIP_FIELD_MAP: Record<string, string> = {
  entry: 'entryPoints',
  project: 'include',
  ignore: 'exclude',
  ignoreDependencies: 'ignoreDependencies',
  workspaces: 'workspaces',
  rules: 'rules',
};

export function migrateFromKnip(knipConfigPath: string): KnipMigrationResult {
  if (!existsSync(knipConfigPath)) {
    throw new Error(`Knip config not found: ${knipConfigPath}`);
  }

  const raw = readFileSync(knipConfigPath, 'utf-8');
  const warnings: MigrationWarning[] = [];
  const monographConfig: Record<string, unknown> = {};

  let knipConfig: Record<string, unknown>;
  try {
    knipConfig = JSON.parse(raw);
  } catch {
    warnings.push({
      field: '<file>',
      message: 'Failed to parse config as JSON; only plain JSON configs are supported (not TypeScript/JS configs)',
      knipValue: raw.slice(0, 100),
    });
    return { monographConfig, warnings, inputFile: knipConfigPath };
  }

  for (const [knipKey, knipValue] of Object.entries(knipConfig)) {
    const monographKey = KNIP_FIELD_MAP[knipKey];
    if (monographKey) {
      if (knipKey === 'rules') {
        // Map rule names; warn on unknown rules
        if (knipValue && typeof knipValue === 'object' && !Array.isArray(knipValue)) {
          const mappedRules: Record<string, unknown> = {};
          for (const [ruleName, ruleValue] of Object.entries(knipValue as Record<string, unknown>)) {
            mappedRules[ruleName] = ruleValue;
          }
          monographConfig[monographKey] = mappedRules;
        } else {
          warnings.push({
            field: knipKey,
            message: 'Expected rules to be an object mapping rule names to values',
            knipValue,
          });
        }
      } else {
        monographConfig[monographKey] = knipValue;
      }
    } else {
      warnings.push({
        field: knipKey,
        message: 'No equivalent in monograph config',
        knipValue,
      });
    }
  }

  return { monographConfig, warnings, inputFile: knipConfigPath };
}

// ── Round 10: TOML migration output + JSONC reader ────────────────────────────

export function stripJsoncComments(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    let result = '';
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        if (line[i] === '*' && line[i + 1] === '/') { inBlock = false; i += 2; } else { i++; }
      } else if (line[i] === '/' && line[i + 1] === '/') {
        break;
      } else if (line[i] === '/' && line[i + 1] === '*') {
        inBlock = true; i += 2;
      } else {
        result += line[i++];
      }
    }
    out.push(result);
  }
  return out.join('\n');
}

export function parseJsoncString(input: string): Record<string, unknown> {
  return JSON.parse(stripJsoncComments(input)) as Record<string, unknown>;
}

export function generateTomlFromMigration(config: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(config)) {
    if (Array.isArray(val)) {
      const items = val.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(', ');
      lines.push(`${key} = [${items}]`);
    } else if (typeof val === 'boolean' || typeof val === 'number') {
      lines.push(`${key} = ${val}`);
    } else if (typeof val === 'string') {
      lines.push(`${key} = "${val}"`);
    } else if (typeof val === 'object' && val !== null) {
      lines.push(`[${key}]`);
      for (const [k2, v2] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v2 === 'string') lines.push(`${k2} = "${v2}"`);
        else if (typeof v2 === 'boolean' || typeof v2 === 'number') lines.push(`${k2} = ${v2}`);
      }
    }
  }
  return lines.join('\n');
}
