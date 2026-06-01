/**
 * AI Context Injection
 *
 * Injects a natural-language description of monograph capabilities into
 * AGENTS.md and/or CLAUDE.md so AI agents (Claude Code, Cursor, Windsurf,
 * Copilot, Cline, etc.) understand how and when to use monograph tools.
 *
 * This is distinct from setup.ts which injects MCP server connection config.
 * Here the goal is agent comprehension: what monograph does, which tools to
 * call, and under what conditions — written in imperative prose that models
 * follow reliably.
 */

import fs from 'fs/promises';
import path from 'path';

// ─── Public types ─────────────────────────────────────────────────────────────

export type AiContextTarget = 'claude' | 'agents-md';

export interface AiContextOptions {
  /** Absolute path to the repository root */
  repoPath: string;
  /** Which files to update. Defaults to both. */
  targets?: AiContextTarget[];
}

export interface AiContextResult {
  /** Files that were written or updated */
  updated: string[];
  /** Files skipped because the block was already present */
  skipped: string[];
  /** Files that could not be written (with reason) */
  errors: string[];
}

// ─── Marker / sentinel ────────────────────────────────────────────────────────

const START_MARKER = '<!-- monograph:context:start -->';
const END_MARKER = '<!-- monograph:context:end -->';

// Used for idempotency check without full marker parsing
const SENTINEL = 'monograph:context:start';

// ─── Content ──────────────────────────────────────────────────────────────────

const AI_CONTEXT_BLOCK = `${START_MARKER}
## Monograph — Code Intelligence

This project is indexed by **Monograph**, a code knowledge graph that understands symbols, dependencies, and execution flows. Use the Monograph MCP tools to explore code, assess change impact, and navigate safely.

> If any Monograph tool reports the index is stale, run \`monograph_build\` first.

### Always Do

- **MUST run \`monograph_impact\` before editing any symbol.** Before modifying a function, class, or method, call \`monograph_impact({name: "symbolName"})\` and report the blast radius (direct callers, risk level) to the user.
- **MUST run \`monograph_detect_changes\` before committing** to verify changes only affect expected symbols.
- **MUST warn the user** when impact analysis returns HIGH or CRITICAL risk.
- When exploring unfamiliar code, use \`monograph_query({query: "concept"})\` to find relevant symbols instead of grepping.
- When you need full context on a symbol — callers, callees, which community it belongs to — use \`monograph_context({name: "symbolName"})\`.

### When to Use Each Tool

| Situation | Tool |
|-----------|------|
| Understand architecture / "How does X work?" | \`monograph_query\`, \`monograph_context\` |
| Blast radius / "What breaks if I change X?" | \`monograph_impact\` |
| Trace bugs / "Why is X failing?" | \`monograph_context\`, \`monograph_cypher\` |
| Rename / extract / split / refactor | \`monograph_rename\`, \`monograph_impact\` |
| Find highly connected files | \`monograph_god_nodes\` |
| Check index freshness | \`monograph_health\` |
| Find all HTTP routes | \`monograph_route_map\` |

### Never Do

- NEVER edit a function, class, or method without first running \`monograph_impact\` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use \`monograph_rename\` which understands the call graph.
- NEVER commit without running \`monograph_detect_changes\` to check the affected scope.
${END_MARKER}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Upsert the monograph AI context block in a markdown file.
 * - If absent: append the block.
 * - If present (by marker): replace the block so content stays current.
 * - Idempotent: a file with an up-to-date block is left unchanged.
 */
async function upsertContextBlock(filePath: string): Promise<'updated' | 'skipped'> {
  const existing = await readFileSafe(filePath);

  // Fast idempotency check — if sentinel is absent the block is not there yet
  if (!existing.includes(SENTINEL)) {
    const updated = existing.trimEnd() + '\n\n' + AI_CONTEXT_BLOCK + '\n';
    await fs.writeFile(filePath, updated, 'utf-8');
    return 'updated';
  }

  // Block is already present. Replace it so the content stays fresh.
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + END_MARKER.length);
    const replaced = before + AI_CONTEXT_BLOCK + after;

    // Only write if something actually changed
    if (replaced === existing) return 'skipped';

    await fs.writeFile(filePath, replaced.trimEnd() + '\n', 'utf-8');
    return 'updated';
  }

  // Sentinel present but markers are malformed — skip to avoid corruption
  return 'skipped';
}

// ─── Per-target handlers ──────────────────────────────────────────────────────

async function handleClaude(repoPath: string, result: AiContextResult): Promise<void> {
  const filePath = path.join(repoPath, 'CLAUDE.md');
  try {
    const outcome = await upsertContextBlock(filePath);
    if (outcome === 'updated') {
      result.updated.push('CLAUDE.md');
    } else {
      result.skipped.push('CLAUDE.md');
    }
  } catch (err: unknown) {
    result.errors.push(`CLAUDE.md: ${(err as Error).message}`);
  }
}

async function handleAgentsMd(repoPath: string, result: AiContextResult): Promise<void> {
  const filePath = path.join(repoPath, 'AGENTS.md');
  try {
    const outcome = await upsertContextBlock(filePath);
    if (outcome === 'updated') {
      result.updated.push('AGENTS.md');
    } else {
      result.skipped.push('AGENTS.md');
    }
  } catch (err: unknown) {
    result.errors.push(`AGENTS.md: ${(err as Error).message}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const ALL_TARGETS: AiContextTarget[] = ['claude', 'agents-md'];

const TARGET_HANDLERS: Record<
  AiContextTarget,
  (repoPath: string, result: AiContextResult) => Promise<void>
> = {
  claude: handleClaude,
  'agents-md': handleAgentsMd,
};

/**
 * Inject a natural-language monograph capabilities description into
 * AGENTS.md and/or CLAUDE.md so AI agents know how to use monograph tools.
 *
 * Running multiple times is safe: existing blocks are replaced in-place
 * (so the content stays current) and unchanged files are reported as skipped.
 *
 * @example
 * const result = await injectAiContext({ repoPath: '/path/to/repo' });
 * console.log(result.updated); // ['CLAUDE.md', 'AGENTS.md']
 */
export async function injectAiContext(options: AiContextOptions): Promise<AiContextResult> {
  const { repoPath, targets = ALL_TARGETS } = options;

  const result: AiContextResult = {
    updated: [],
    skipped: [],
    errors: [],
  };

  await Promise.all(targets.map((target) => TARGET_HANDLERS[target](repoPath, result)));

  return result;
}
