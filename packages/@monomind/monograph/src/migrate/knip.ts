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
