/**
 * Validates capability metadata in agent YAML frontmatter files.
 *
 * Usage:
 *   npx ts-node scripts/validate-capability-metadata.ts
 *
 * Globs all .md files in .claude/agents/, parses YAML frontmatter,
 * and validates the `capability:` block against the schema defined
 * in docs/agent-capability-schema.md.
 *
 * @module scripts/validate-capability-metadata
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CapabilityBlock {
  role?: string;
  goal?: string;
  version?: string;
  expertise?: string[];
  task_types?: string[];
  output_type?: string;
  input_schema?: string;
  output_schema?: string;
  planning_step?: string;
  model_preference?: string;
  knowledge_sources?: string[];
  triggers?: string[];
  termination?: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  capability?: CapabilityBlock;
  [key: string]: unknown;
}

interface ValidationError {
  file: string;
  field: string;
  message: string;
}

interface ValidationResult {
  totalFiles: number;
  filesWithCapability: number;
  filesWithoutCapability: number;
  validFiles: number;
  invalidFiles: number;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal, no external dependency)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYamlBlock(match[1]);
}

function parseYamlBlock(yaml: string): Frontmatter {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    const inlineValue = keyMatch[2].trim();

    // Check if next lines are indented (nested object or array)
    if (inlineValue === '' || inlineValue === '|' || inlineValue === '>') {
      const nested = collectIndentedBlock(lines, i + 1, getIndent(lines[i + 1] ?? ''));
      i = nested.nextIndex;

      if (nested.lines.length > 0 && nested.lines[0].trim().startsWith('-')) {
        result[key] = nested.lines.map((l) => l.trim().replace(/^-\s*/, ''));
      } else {
        result[key] = parseNestedYaml(nested.lines);
      }
    } else {
      result[key] = stripQuotes(inlineValue);
      i++;
    }
  }

  return result as Frontmatter;
}

function parseNestedYaml(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.trim().match(/^(\w[\w_-]*):\s*(.*)/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    const inlineValue = keyMatch[2].trim();

    if (inlineValue === '') {
      const nested = collectIndentedBlock(lines, i + 1, getIndent(lines[i + 1] ?? ''));
      i = nested.nextIndex;

      if (nested.lines.length > 0 && nested.lines[0].trim().startsWith('-')) {
        result[key] = nested.lines.map((l) => l.trim().replace(/^-\s*/, ''));
      } else {
        result[key] = parseNestedYaml(nested.lines);
      }
    } else {
      result[key] = stripQuotes(inlineValue);
      i++;
    }
  }

  return result;
}

function collectIndentedBlock(
  lines: string[],
  startIndex: number,
  minIndent: number
): { lines: string[]; nextIndex: number } {
  const collected: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const indent = getIndent(lines[i]);
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    if (indent < minIndent) break;
    collected.push(lines[i]);
    i++;
  }

  return { lines: collected, nextIndex: i };
}

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PASCAL_CASE_REGEX = /^[A-Z][a-zA-Z0-9]*$/;

export function validateCapability(
  filePath: string,
  capability: CapabilityBlock
): ValidationError[] {
  const errors: ValidationError[] = [];

  // role: required, kebab-case, 2-60 chars
  if (!capability.role) {
    errors.push({ file: filePath, field: 'role', message: 'Missing required field "role"' });
  } else if (!KEBAB_CASE_REGEX.test(capability.role)) {
    errors.push({ file: filePath, field: 'role', message: `Role "${capability.role}" is not valid kebab-case` });
  } else if (capability.role.length < 2 || capability.role.length > 60) {
    errors.push({ file: filePath, field: 'role', message: `Role length must be 2-60 chars, got ${capability.role.length}` });
  }

  // goal: required, 20-200 chars
  if (!capability.goal) {
    errors.push({ file: filePath, field: 'goal', message: 'Missing required field "goal"' });
  } else if (capability.goal.length < 20) {
    errors.push({ file: filePath, field: 'goal', message: `Goal must be at least 20 chars, got ${capability.goal.length}` });
  } else if (capability.goal.length > 200) {
    errors.push({ file: filePath, field: 'goal', message: `Goal must be at most 200 chars, got ${capability.goal.length}` });
  }

  // version: required, semver
  if (!capability.version) {
    errors.push({ file: filePath, field: 'version', message: 'Missing required field "version"' });
  } else if (!SEMVER_REGEX.test(capability.version)) {
    errors.push({ file: filePath, field: 'version', message: `Version "${capability.version}" is not valid semver (expected X.Y.Z)` });
  }

  // expertise: required, array of 3+
  if (!capability.expertise || !Array.isArray(capability.expertise)) {
    errors.push({ file: filePath, field: 'expertise', message: 'Missing required field "expertise" (must be array)' });
  } else if (capability.expertise.length < 3) {
    errors.push({ file: filePath, field: 'expertise', message: `Expertise must have at least 3 entries, got ${capability.expertise.length}` });
  }

  // task_types: required, array of 1+
  if (!capability.task_types || !Array.isArray(capability.task_types)) {
    errors.push({ file: filePath, field: 'task_types', message: 'Missing required field "task_types" (must be array)' });
  } else if (capability.task_types.length < 1) {
    errors.push({ file: filePath, field: 'task_types', message: 'task_types must have at least 1 entry' });
  }

  // output_type: required, PascalCase
  if (!capability.output_type) {
    errors.push({ file: filePath, field: 'output_type', message: 'Missing required field "output_type"' });
  } else if (!PASCAL_CASE_REGEX.test(capability.output_type)) {
    errors.push({ file: filePath, field: 'output_type', message: `output_type "${capability.output_type}" is not PascalCase` });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// File discovery and main
// ---------------------------------------------------------------------------

function globAgentFiles(baseDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  walk(baseDir);
  return results.sort();
}

export function validateAllAgents(agentsDir: string): ValidationResult {
  const files = globAgentFiles(agentsDir);
  const result: ValidationResult = {
    totalFiles: files.length,
    filesWithCapability: 0,
    filesWithoutCapability: 0,
    validFiles: 0,
    invalidFiles: 0,
    errors: [],
  };

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter) {
      result.filesWithoutCapability++;
      continue;
    }

    if (!frontmatter.capability) {
      result.filesWithoutCapability++;
      continue;
    }

    result.filesWithCapability++;
    const capability = frontmatter.capability as CapabilityBlock;
    const errors = validateCapability(filePath, capability);

    if (errors.length > 0) {
      result.invalidFiles++;
      result.errors.push(...errors);
    } else {
      result.validFiles++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const agentsDir = path.resolve(process.cwd(), '.claude', 'agents');

  if (!fs.existsSync(agentsDir)) {
    console.error(`Agents directory not found: ${agentsDir}`);
    process.exit(1);
  }

  const result = validateAllAgents(agentsDir);

  console.log('\n=== Agent Capability Metadata Validation ===\n');
  console.log(`Total agent files:         ${result.totalFiles}`);
  console.log(`With capability block:     ${result.filesWithCapability}`);
  console.log(`Without capability block:  ${result.filesWithoutCapability}`);
  console.log(`Valid:                     ${result.validFiles}`);
  console.log(`Invalid:                   ${result.invalidFiles}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):\n`);
    for (const error of result.errors) {
      const relPath = path.relative(process.cwd(), error.file);
      console.log(`  ${relPath}`);
      console.log(`    [${error.field}] ${error.message}\n`);
    }
    process.exit(1);
  } else {
    console.log('\nAll capability blocks are valid.\n');
  }
}

// Run when executed directly
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('validate-capability-metadata.ts') ||
   process.argv[1].endsWith('validate-capability-metadata.js'));

if (isDirectRun) {
  main();
}
