/**
 * Registry Builder (Task 30)
 *
 * Scans agent definition .md files, parses YAML frontmatter,
 * and produces a unified AgentRegistry JSON.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative } from 'node:path';

type TriggerPattern = { pattern: string; mode: 'glob' | 'regex' | 'exact' };
type AgentRegistryEntry = {
  slug: string;
  name: string;
  version: string;
  category: string;
  description: string;
  capabilities: string[];
  taskTypes: string[];
  tools: string[];
  triggers: TriggerPattern[];
  deprecated: boolean;
  deprecatedBy?: string;
  dependencies: string[];
  filePath: string;
  registeredAt: string;
  lastUpdated: string;
};
type AgentRegistry = {
  version: string;
  generatedAt: string;
  totalAgents: number;
  agents: AgentRegistryEntry[];
};

/** Parsed YAML frontmatter value: scalar, string array, or array of nested objects. */
type FrontmatterValue = string | boolean | string[] | Record<string, string>[];

/** Parsed YAML frontmatter as a flat key-value map. */
type Frontmatter = Record<string, FrontmatterValue>;

/** Directories to skip during recursive scan. */
const SKIP_DIRS = new Set<string>(['schemas', 'ephemeral']);

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
    } else if (stat.isFile() && extname(entry) === '.md' && !entry.startsWith('._')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Parse nested YAML list items (lines starting with `- `) under a parent key
 * whose value was empty on its own line (e.g. `triggers:\n  - pattern: ...`).
 *
 * Returns simple `string[]` when every item is a plain scalar, or
 * `Record<string, string>[]` when items contain key-value pairs.
 * Returns `null` when no list items were found (the caller falls through to
 * existing flat-value handling).
 */
function parseNestedYamlList(
  lines: string[],
  startIdx: number,
  parentIndent: number,
): { value: FrontmatterValue | null; consumed: number } {
  const objects: Record<string, string>[] = [];
  const simpleItems: string[] = [];
  let current: Record<string, string> | null = null;
  let consumed = 0;
  let hasObjects = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines and comments within the nested block
    if (!trimmed || trimmed.startsWith('#')) {
      consumed++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    // Stop when we return to the parent indent level or shallower
    if (indent <= parentIndent) break;

    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2);
      const colonSpaceIdx = itemContent.indexOf(': ');
      if (colonSpaceIdx !== -1) {
        // Object list item: `- key: value`
        hasObjects = true;
        current = {};
        const k = itemContent.slice(0, colonSpaceIdx).trim();
        let v = itemContent.slice(colonSpaceIdx + 2).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        current[k] = v;
        objects.push(current);
      } else {
        // Simple string item: `- value`
        let v = itemContent.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        simpleItems.push(v);
      }
      consumed++;
    } else if (current && hasObjects) {
      // Continuation line for the current object item: `key: value`
      const colonSpaceIdx = trimmed.indexOf(': ');
      if (colonSpaceIdx !== -1) {
        const k = trimmed.slice(0, colonSpaceIdx).trim();
        let v = trimmed.slice(colonSpaceIdx + 2).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        current[k] = v;
      }
      consumed++;
    } else {
      // Non-list indented content (e.g. nested key-value block) — stop
      break;
    }
  }

  if (hasObjects && objects.length > 0) {
    return { value: objects, consumed };
  }
  if (simpleItems.length > 0) {
    return { value: simpleItems, consumed };
  }
  return { value: null, consumed };
}

/**
 * Parse YAML frontmatter from markdown content using simple regex.
 * Returns key-value pairs from the `---` delimited block.
 */
function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const result: Frontmatter = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: FrontmatterValue = trimmed.slice(colonIdx + 1).trim();

    // When the value is empty, look ahead for nested YAML list items
    if (value === '') {
      const parentIndent = line.length - line.trimStart().length;
      const nested = parseNestedYamlList(lines, i + 1, parentIndent);
      if (nested.value !== null) {
        result[key] = nested.value;
        i += nested.consumed;
        continue;
      }
    }

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
function toStringArray(val: FrontmatterValue | undefined): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string' && val.length > 0) return [val];
  return [];
}

/** Parse trigger patterns from frontmatter value. */
function parseTriggers(val: FrontmatterValue | undefined): TriggerPattern[] {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map((t): TriggerPattern => {
    if (typeof t === 'object' && t !== null && 'pattern' in t) {
      return {
        pattern: String((t as { pattern: unknown }).pattern),
        mode: String((t as { mode?: unknown }).mode ?? 'glob') as TriggerPattern['mode'],
      };
    }
    return { pattern: String(t), mode: 'glob' };
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
 * Compute the ordered list of agent-definition roots for `cwd`: extras
 * (canonical, from MONOMIND_EXTRA_AGENT_PATHS or a sibling `agency-agents`
 * dir) first, then the project's `.claude/agents`. Shared by CLI startup
 * and `monomind doctor` so both build the registry the same way.
 */
export function computeAgentRoots(cwd: string): string[] {
  const devAgentsRoot = join(cwd, '.claude', 'agents');
  const extraPaths = process.env.MONOMIND_EXTRA_AGENT_PATHS
    ? process.env.MONOMIND_EXTRA_AGENT_PATHS.split(':').filter(Boolean)
    : [];
  const siblingExtraPath = join(cwd, '..', 'agency-agents');
  if (extraPaths.length === 0) {
    try {
      if (statSync(siblingExtraPath).isDirectory()) extraPaths.push(siblingExtraPath);
    } catch {
      /* sibling path doesn't exist */
    }
  }
  return [...extraPaths, devAgentsRoot];
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
 * ], '.monomind/registry.json');
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
        if (statSync(file).size > 512 * 1024) continue; // skip files > 512 KB
        content = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      const slug = (typeof fm.slug === 'string' ? fm.slug : undefined) || slugFromFilename(file);
      // Skip duplicates — first root wins
      if (seen.has(slug)) continue;
      seen.set(slug, {
        slug,
        name: (typeof fm.name === 'string' ? fm.name : undefined) || slug,
        version: (typeof fm.version === 'string' ? fm.version : undefined) || '0.0.0',
        category:
          (typeof fm.category === 'string' ? fm.category : undefined) ||
          categoryFromPath(file, root),
        description: typeof fm.description === 'string' ? fm.description : '',
        capabilities: toStringArray(fm.capabilities),
        taskTypes: toStringArray(fm.taskTypes ?? fm['task-types'] ?? fm.task_types),
        tools: toStringArray(fm.tools),
        triggers: parseTriggers(fm.triggers),
        deprecated: fm.deprecated === true,
        deprecatedBy: typeof fm.deprecatedBy === 'string' ? fm.deprecatedBy : undefined,
        dependencies: toStringArray(fm.dependencies),
        filePath: isAbsolute(file) ? relative(process.cwd(), file) : file,
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
