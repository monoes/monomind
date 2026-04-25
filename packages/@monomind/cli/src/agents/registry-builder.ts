/**
 * Registry Builder (Task 30)
 *
 * Scans agent definition .md files, parses YAML frontmatter,
 * and produces a unified AgentRegistry JSON.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename, relative, extname } from 'path';
import type {
  AgentRegistry,
  AgentRegistryEntry,
  TriggerPattern,
} from '../../../shared/src/types/agent-registry.js';

/** Directories to skip during recursive scan. */
const SKIP_DIRS = new Set(['schemas', 'ephemeral']);

/**
 * Recursively collect all `.md` files under `root`, skipping SKIP_DIRS.
 */
function collectMdFiles(root: string, base: string = root): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      results.push(...collectMdFiles(full, base));
    } else if (stat.isFile() && extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

/**
 * Parse YAML frontmatter from markdown content using simple regex.
 * Returns key-value pairs from the `---` delimited block.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const block = match[1];
  const result: Record<string, unknown> = {};

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();

    // Handle YAML arrays written as "[a, b, c]"
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    // Handle booleans
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    // Handle quoted strings
    else if (
      typeof value === 'string' &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/** Coerce a value into a string array. */
function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string' && val.length > 0) return [val];
  return [];
}

/** Parse trigger patterns from frontmatter value. */
function parseTriggers(val: unknown): TriggerPattern[] {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map((t) => {
    if (typeof t === 'object' && t !== null && 'pattern' in t) {
      return { pattern: String((t as Record<string, unknown>).pattern), mode: String((t as Record<string, unknown>).mode ?? 'glob') } as TriggerPattern;
    }
    return { pattern: String(t), mode: 'glob' as const };
  });
}

/**
 * Derive a slug from a filename: remove extension, lowercase, replace spaces with hyphens.
 */
function slugFromFilename(filename: string): string {
  return basename(filename, extname(filename))
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Derive category from the parent directory name relative to agents root.
 */
function categoryFromPath(filePath: string, agentsRoot: string): string {
  const rel = relative(agentsRoot, filePath);
  const parts = rel.split('/');
  return parts.length > 1 ? parts[0] : 'default';
}

/**
 * Build the agent registry by scanning `.md` files under `agentsRoot`.
 *
 * @param agentsRoot - Root directory (or array of directories) to scan.
 * @param outputPath - Optional path to write the registry JSON file.
 * @returns The built AgentRegistry object.
 */
export function buildRegistry(agentsRoot: string, outputPath?: string): AgentRegistry {
  return buildUnifiedRegistry([agentsRoot], outputPath);
}

/**
 * Build a unified agent registry from multiple root directories, deduplicating
 * by slug. When the same slug appears in more than one root, the entry from the
 * **first** root in the array wins (earlier roots are considered canonical).
 *
 * Typical usage — extras (agency-agents) listed first so they take precedence
 * over any locally duplicated copies in `.claude/agents/`:
 *
 * ```ts
 * buildUnifiedRegistry([
 *   '/path/to/agency-agents',   // canonical source — wins on conflict
 *   '.claude/agents',           // dev copies — used only for unique slugs
 * ], '.monobrain/registry.json');
 * ```
 *
 * @param roots      - Ordered list of directories to scan (first-wins on slug conflict).
 * @param outputPath - Optional path to write the merged registry JSON file.
 * @returns The deduplicated AgentRegistry.
 */
export function buildUnifiedRegistry(roots: string[], outputPath?: string): AgentRegistry {
  const now = new Date().toISOString();
  /** Slug → first-seen entry (first root wins). */
  const seen = new Map<string, AgentRegistryEntry>();

  for (const root of roots) {
    const files = collectMdFiles(root);

    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      const slug = (fm.slug as string) || slugFromFilename(file);

      // Skip duplicates — first root wins
      if (seen.has(slug)) continue;

      seen.set(slug, {
        slug,
        name: (fm.name as string) || slug,
        version: (fm.version as string) || '0.0.0',
        category: (fm.category as string) || categoryFromPath(file, root),
        capabilities: toStringArray(fm.capabilities),
        taskTypes: toStringArray(fm.taskTypes ?? fm['task-types'] ?? fm.task_types),
        tools: toStringArray(fm.tools),
        triggers: parseTriggers(fm.triggers),
        deprecated: fm.deprecated === true,
        deprecatedBy: fm.deprecatedBy as string | undefined,
        dependencies: toStringArray(fm.dependencies),
        filePath: file,
        registeredAt: now,
        lastUpdated: now,
      });
    }
  }

  const agents = Array.from(seen.values());
  const registry: AgentRegistry = {
    version: '1.0.0',
    generatedAt: now,
    totalAgents: agents.length,
    agents,
  };

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  return registry;
}
