/**
 * Shared utilities, constants, and types used across init write-* modules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MAX_EXEC_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Probe whether an optionalDependency actually resolved in this install
 * (npm silently skips optionalDependencies it can't satisfy — see
 * docs/AUDIT-BACKLOG.md P1-1/P1-23). Used to caveat generated docs instead
 * of presenting these features as unconditionally working.
 */
export function _isOptionalPackageResolvable(pkg: string): boolean {
  try {
    const req = createRequire(import.meta.url);
    req.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic write helper — writes to a sibling .tmp file then renames into place.
 * SIGINT or crash during a partial write would otherwise corrupt user-critical
 * files (.claude/settings.json, .mcp.json, helper scripts that Claude Code
 * executes on every hook). Without atomicity a half-written settings.json or
 * a zero-byte hook-handler.cjs disables Claude Code's protections silently.
 */
export function atomicWriteFile(target: string, content: string | Buffer, encoding?: BufferEncoding): void {
  const tmp = `${target}.${process.pid}.tmp`;
  if (encoding && typeof content === 'string') {
    fs.writeFileSync(tmp, content, encoding);
  } else if (typeof content === 'string') {
    fs.writeFileSync(tmp, content, 'utf-8');
  } else {
    fs.writeFileSync(tmp, content);
  }
  fs.renameSync(tmp, target);
}

/**
 * Skills to copy based on configuration
 */
export const SKILLS_MAP: Record<string, string[]> = {
  core: [
    'swarm-orchestration',
    'swarm-advanced',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'skill-builder',
    'specialagent',
    'monodesign',
    'monomotion',
    'monolean',
    'monolean-review',
    'monolean-audit',
    'monolean-debt',
    'monolean-help',
    'hive-mind-advanced',
    // The mastermind command files installed by init invoke
    // Skill("mastermind-<name>") at runtime — one top-level
    // mastermind-<name>/SKILL.md directory per skill. The glob expands in
    // copySkills against the source tree, so newly added mastermind skills
    // ship automatically; without them those references break in user projects.
    'mastermind-*',
  ],
  browser: ['agent-browser-testing'],
  // NOTE: memory-toolkit and github-toolkit are single consolidated skills
  // (not one skill per capability) — see .claude/skills/memory-toolkit and
  // .claude/skills/github-toolkit. The finer-grained names previously listed
  // here (memory-advanced, github-code-review, etc.) never had matching
  // source directories and silently copied nothing.
  memory: ['memory-toolkit'],
  github: ['github-toolkit'],
  advanced: [
    'agentic-jujutsu',
    'performance-analysis',
  ],
};

/**
 * Commands to copy based on configuration
 */
export const COMMANDS_MAP: Record<string, string[]> = {
  core: [
    'mastermind.md', 'tokens.md', 'monobrowse.md', 'ts.md',
  ],
  agents: ['agents'],
  analysis: ['analysis'],
  automation: ['automation'],
  coordination: ['coordination'],
  github: ['github'],
  hiveMind: ['hive-mind'],
  hooks: ['hooks'],
  mastermind: ['mastermind'],
  memory: ['memory'],
  monitoring: ['monitoring'],
  monograph: ['monograph'],
  monomind: ['mastermind'],
  optimization: ['optimization'],
  pair: ['pair'],
  streamChain: ['stream-chain'],
  swarm: ['swarm'],
  training: ['training'],
  truth: ['truth'],
  verify: ['verify'],
  workflows: ['workflows'],
};

/**
 * Agents to copy based on configuration
 */
export const AGENTS_MAP: Record<string, string[]> = {
  academic: ['academic'],
  analysis: ['analysis'],
  architecture: ['architecture'],
  consensus: ['consensus'],
  core: ['core'],
  data: ['data'],
  design: ['design'],
  development: ['development'],
  devops: ['devops'],
  documentation: ['documentation'],
  engineering: ['engineering'],
  gameDevelopment: ['game-development'],
  github: ['github'],
  goal: ['goal'],
  hiveMind: ['hive-mind'],
  marketing: ['marketing'],
  neural: ['neural'],
  optimization: ['optimization'],
  paidMedia: ['paid-media'],
  payments: ['payments'],
  product: ['product'],
  projectManagement: ['project-management'],
  reasoning: ['reasoning'],
  sales: ['sales'],
  schemas: ['schemas'],
  sona: ['sona'],
  spatialComputing: ['spatial-computing'],
  specialists: ['specialists'],
  specialized: ['specialized'],
  sublinear: ['sublinear'],
  support: ['support'],
  swarm: ['swarm'],
  templates: ['templates'],
  testing: ['testing'],
};

/**
 * Directory structure to create
 */
export const DIRECTORIES = {
  claude: [
    '.claude',
    '.claude/skills',
    '.claude/commands',
    '.claude/agents',
    '.claude/helpers',
    '.gemini',
    '.gemini/skills',
    '.gemini/rules',
    '.gemini/helpers',
    '.agents',
    '.agents/skills',
  ],
  runtime: [
    '.monomind',
    '.monomind/data',
    '.monomind/logs',
    '.monomind/sessions',
    '.monomind/hooks',
    '.monomind/agents',
    '.monomind/workflows',
  ],
};

/**
 * Provenance manifest for generated .claude content.
 *
 * init used to "clean stale" entries by deleting every name under
 * .claude/{skills,commands,agents} that was absent from the current version's
 * SKILLS_MAP/COMMANDS_MAP/AGENTS_MAP. Every user-authored command and skill is
 * absent from those maps, so that pass deleted user content on the very first
 * run — unrecoverable data loss.
 *
 * The manifest records exactly which entries *this tool* wrote, so the stale
 * sweep can be restricted to those. Anything init did not write is never
 * removed. Projects initialised by an older version have no manifest, so their
 * first run under the fix deletes nothing and seeds the manifest instead;
 * stale generated content may survive one extra run, which is the correct
 * trade (preserving stale generated content is recoverable, deleting user
 * content is not).
 */
export const INIT_MANIFEST_REL = path.join('.monomind', 'init-manifest.json');

export interface InitManifest {
  version: number;
  /** Entry names directly under .claude/skills that init generated. */
  skills: string[];
  /** Entry names directly under .claude/commands that init generated. */
  commands: string[];
  /** Entry names (category dirs) directly under .claude/agents that init generated. */
  agents: string[];
}

export type InitManifestSection = 'skills' | 'commands' | 'agents';

/**
 * Read the provenance manifest. Returns null when absent or unreadable —
 * callers must treat that as "provenance unknown", i.e. delete nothing.
 */
export function readInitManifest(targetDir: string): InitManifest | null {
  const manifestPath = path.join(targetDir, INIT_MANIFEST_REL);
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown) => typeof s === 'string') : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands.filter((s: unknown) => typeof s === 'string') : [],
      agents: Array.isArray(parsed.agents) ? parsed.agents.filter((s: unknown) => typeof s === 'string') : [],
    };
  } catch {
    return null;
  }
}

/**
 * Names init previously generated in one section. Empty set when no manifest
 * exists — which makes the stale sweep a no-op rather than a delete-everything.
 */
export function previouslyGenerated(targetDir: string, section: InitManifestSection): Set<string> {
  return new Set(readInitManifest(targetDir)?.[section] ?? []);
}

/**
 * Record the entries init just wrote for one section, merging into any
 * existing manifest so a partial run (e.g. --only-claude, or a section whose
 * source dir was missing) never drops provenance for the other sections.
 */
export function recordGenerated(targetDir: string, section: InitManifestSection, entries: string[]): void {
  const manifestPath = path.join(targetDir, INIT_MANIFEST_REL);
  const existing = readInitManifest(targetDir);
  const manifest: InitManifest = existing ?? { version: 1, skills: [], commands: [], agents: [] };
  manifest.version = 1;
  manifest[section] = [...new Set(entries)].sort();
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } catch {
    // Non-fatal: without a manifest the next run simply deletes nothing.
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
  for (const pkgName of ['@monoes/monomindcli/package.json', 'monomind/packages/@monomind/cli/package.json', '@monomind/cli/package.json']) {
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
    if (fs.existsSync(p) && SENTINEL_FILES.every(f => fs.existsSync(path.join(p, f)))) {
      return p;
    }
  }

  return null;
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
export function findSourceDir(type: 'skills' | 'commands' | 'agents', sourceBaseDir?: string): string | null {
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

/**
 * Copy directory recursively
 */
export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip exFAT/macOS AppleDouble junk files (e.g. "._foo.js") so they don't
    // get perpetuated into every newly-initialized project.
    if (entry.name.startsWith('._')) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Count files with extension in directory
 */
export function countFiles(dir: string, ext: string): number {
  let count = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (entry.name.endsWith(ext)) {
      count++;
    }
  }

  return count;
}

/** Recursively collect .md files under dir, returned relative to dir. */
export function walkMdFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string, prefix: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}${path.sep}${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(d, e.name), rel);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(rel);
    }
  };
  visit(dir, '');
  return out;
}

/** Skip READMEs and other non-definition markdown. */
export function isLikelyUserFile(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  if (base === 'readme.md' || base === 'readme') return false;
  return true;
}

/** Pull the `name:` scalar from a frontmatter block (best-effort). */
export function extractFmName(md: string): string | null {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!m) return null;
  const fm = m[0];
  const nm = fm.match(/^name\s*:\s*(.+?)\s*$/m);
  return nm ? nm[1].replace(/^["']|["']$/g, '') : null;
}
