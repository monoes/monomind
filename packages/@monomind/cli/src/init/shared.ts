/**
 * Shared utilities, constants, and types used across init write-* modules.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from '../types.js';
import type { WorkerRow } from './generated-counts.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MAX_EXEC_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * i-041/i-117: the generated CLAUDE.md / CAPABILITIES.md CLI-commands table
 * used to hardcode each command's subcommand count (drifts every release —
 * real init/agent/monoswarm/mcp counts were all wrong at 091d8e05c). Reading
 * `command.subcommands.length` directly from the live `Command` object
 * fixes that, but `subcommands` is typed optional on `Command` — a command
 * with none is a real, honest 0, not a type error to paper over.
 */
export function subcommandCount(command: Command): number {
  return command.subcommands?.length ?? 0;
}

/**
 * Renders the `| name | priority | description |` markdown rows for the
 * Background Workers table in both CLAUDE.md and CAPABILITIES.md, from
 * generated-counts.ts's WORKER_ROWS (derived from WORKER_CONFIGS at
 * doc-generation time).
 *
 * i-035 reviewer finding (MAJOR 1): deriving the worker *count* did not fix
 * the worker *table* underneath it — it was a hand-maintained list of 14
 * names, 6 of which don't exist (`hooks worker run <name>` errors on them)
 * and one real worker (`reflexion`) it never listed. The heading number and
 * the row list must come from the same source or they will disagree again.
 */
export function workerTableRows(rows: WorkerRow[]): string {
  return rows.map((w) => `| \`${w.name}\` | ${w.priority} | ${w.description} |`).join('\n');
}

/**
 * Probe whether an optionalDependency actually resolved in this install
 * (npm silently skips optionalDependencies it can't satisfy — see
 * docs/AUDIT-BACKLOG.md P1-1/P1-23). Used to caveat generated docs instead
 * of presenting these features as unconditionally working.
 *
 * i-041/i-117: `require.resolve` (via `createRequire`) cannot satisfy a
 * package whose `exports` map gates its root entry behind an `import`
 * condition only — `@monoes/hooks` and `monofence-ai` both do — so it always
 * threw for them, reporting "unavailable" even when correctly installed.
 * `import.meta.resolve()` resolves both require- and import-only export
 * shapes; it is synchronous and throws on failure (not a truthiness check),
 * so the try/catch shape here is unchanged. The sole helper for this
 * question — claudemd-generator.ts's detectOptionalPackages() calls this
 * rather than re-implementing its own resolver.
 */
export function _isOptionalPackageResolvable(pkg: string): boolean {
  try {
    import.meta.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find source helpers directory.
 * Validates that the directory contains hook-handler.cjs AND its required
 * subdirectory files (utils/telemetry.cjs etc.) to avoid accepting a partial
 * or corrupted source that would reproduce the missing-utils/ bug class.
 */
export function findSourceHelpersDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];
  // All sentinel files must exist — hook-handler.cjs requires these at startup
  const SENTINEL_FILES = [
    'hook-handler.cjs',
    path.join('utils', 'telemetry.cjs'),
    path.join('utils', 'monograph.cjs'),
    path.join('utils', 'micro-agents.cjs'),
  ];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', 'helpers'));
  }

  // Strategy 1: require.resolve to find package root (most reliable for npx)
  // Try both published package names (@monoes/monomindcli is the scoped CLI package,
  // monomind is the umbrella — neither is @monomind/cli which is the monorepo name only)
  for (const pkgName of [
    '@monoes/monomindcli/package.json',
    'monomind/packages/@monomind/cli/package.json',
    '@monomind/cli/package.json',
  ]) {
    try {
      const esmRequire = createRequire(import.meta.url);
      const pkgJsonPath = esmRequire.resolve(pkgName);
      const pkgRoot = path.dirname(pkgJsonPath);
      possiblePaths.push(path.join(pkgRoot, '.claude', 'helpers'));
      break;
    } catch {
      // Not installed under this name — try next
    }
  }

  // Strategy 2: __dirname-based (dist/src/init -> package root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageHelpers = path.join(packageRoot, '.claude', 'helpers');
  possiblePaths.push(packageHelpers);

  // Strategy 3: Walk up from __dirname looking for package root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // hit filesystem root
    const helpersPath = path.join(parentDir, '.claude', 'helpers');
    possiblePaths.push(helpersPath);
    currentDir = parentDir;
  }

  // NOTE: deliberately no cwd-ancestor-search fallback here (removed — see
  // docs/AUDIT-BACKLOG.md P3-25). Searching process.cwd() and its parents for
  // ".claude/helpers" could pick up an unrelated project's own helper scripts
  // (stale, customized, or untrusted) when `monomind init` is run from a
  // nested subdirectory of some other checkout. Helper source resolution is
  // restricted to the package's own bundled location(s) above; if none of
  // those are found, callers should treat it as a corrupt install rather than
  // silently falling back to scanning ancestor directories for someone else's
  // files.

  // Return first path that exists AND contains ALL sentinel files
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && SENTINEL_FILES.every((f) => fs.existsSync(path.join(p, f)))) {
      return p;
    }
  }

  return null;
}

/** Helper-dir files generated per project, never copied from the package:
 *  a shipped skill index lists the package's skills, not the project's. */
export const GENERATED_HELPERS = new Set(['skill-registry.json']);

/**
 * (Re)generates `<targetDir>/.claude/helpers/skill-registry.json` from the
 * project's skill trees, ~/.claude/skills and the Org library, with the
 * package's bundled builder. Returns its entry counts (`total` includes Org
 * skills, `user` the ~/.claude/skills ones), or null when the builder is
 * unavailable.
 */
export function regenerateSkillIndex(
  targetDir: string,
  sourceHelpersDir?: string | null,
): { total: number; user: number } | null {
  const dir = sourceHelpersDir ?? findSourceHelpersDir();
  const builder = dir ? path.join(dir, 'build-skill-registry.cjs') : '';
  if (!builder || !fs.existsSync(builder)) return null;
  try {
    const mod = createRequire(import.meta.url)(builder) as {
      write(root: string): { _meta?: { counts?: Record<string, number> } };
    };
    const c = mod.write(targetDir)?._meta?.counts ?? {};
    return { total: (c.total ?? 0) + (c.orgSkills ?? 0), user: c.user ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Find source .claude directory for statusline files
 */
export function findSourceClaudeDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude'));
  }

  // IMPORTANT: Check the package's own .claude directory
  // Go up 3 levels: dist/src/init -> dist/src -> dist -> root
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageClaude = path.join(packageRoot, '.claude');
  if (fs.existsSync(packageClaude)) {
    possiblePaths.unshift(packageClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const claudePath = path.join(parentDir, '.claude');
    if (fs.existsSync(claudePath)) {
      possiblePaths.push(claudePath);
    }
    currentDir = parentDir;
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Find source directory for skills/commands/agents
 */
export function findSourceDir(
  type: 'skills' | 'commands' | 'agents',
  sourceBaseDir?: string,
): string | null {
  // Build list of possible paths to check
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, use it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', type));
  }

  // IMPORTANT: Check the package's own .claude directory first
  // This is the primary path when running as an npm package
  // __dirname is typically /path/to/node_modules/@monomind/cli/dist/src/init
  // We need to go up 3 levels to reach the package root (dist/src/init -> dist/src -> dist -> root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageDotClaude = path.join(packageRoot, '.claude', type);
  if (fs.existsSync(packageDotClaude)) {
    possiblePaths.unshift(packageDotClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  const distPath = __dirname;

  // Try to find the project root by looking for .claude directory
  let currentDir = distPath;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const dotClaudePath = path.join(parentDir, '.claude', type);
    if (fs.existsSync(dotClaudePath)) {
      possiblePaths.push(dotClaudePath);
    }
    currentDir = parentDir;
  }

  // Also check relative to process.cwd() for development
  const cwdBased = [
    path.join(process.cwd(), '.claude', type),
    path.join(process.cwd(), '..', '.claude', type),
    path.join(process.cwd(), '..', '..', '.claude', type),
  ];
  possiblePaths.push(...cwdBased);

  // Check v2 directory for agents
  if (type === 'agents') {
    possiblePaths.push(
      path.join(process.cwd(), 'v2', '.claude', type),
      path.join(process.cwd(), '..', 'v2', '.claude', type),
    );
  }

  // Plugin directory
  possiblePaths.push(
    path.join(process.cwd(), 'plugin', type),
    path.join(process.cwd(), '..', 'plugin', type),
  );

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

// The managed-block merge primitive lives in its own module — it grew the
// legacy-content migration for GH #276. The asset maps, fs helpers and the
// init manifest were split out too (500-line limit). Re-exported here so the
// existing `from './shared.js'` import sites, and scripts importing
// dist/src/init/shared.js, keep working.
export * from './asset-maps.js';
export * from './fs-helpers.js';
export * from './init-manifest.js';
export { mergeGeneratedBlock } from './managed-block.js';
