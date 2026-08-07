import { join, resolve, sep } from 'path';
import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { getDbPath, _isValidDb, text } from './shared.js';

// ── Active watcher registry ──────────────────────────────────────────────────
const _activeWatchers = new Map<string, any>();

// ── monograph_build ───────────────────────────────────────────────────────────

export const monographBuildTool: MCPTool = {
  name: 'monograph_build',
  description: 'Build (or rebuild) the Monograph knowledge graph for a path. Parses all code via tree-sitter and indexes into SQLite.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
      codeOnly: { type: 'boolean', description: 'Only index code files (skip docs, config)' },
      force: { type: 'boolean', description: 'Force full rebuild even if index is fresh' },
      incremental: { type: 'boolean', description: 'Skip rebuild when index already matches HEAD (default false). Use when you want a no-op if the graph is fresh.' },
    },
  },
  handler: async (input) => {
    const { buildAsync } = await import('@monoes/monograph');
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    let progressLog = '';
    await buildAsync(repoPath, {
      codeOnly: (input.codeOnly as boolean | undefined) ?? false,
      force: (input.force as boolean | undefined) ?? false,
      incremental: (input.incremental as boolean | undefined) ?? false,
      onProgress: (p) => { progressLog += `[${p.phase}] ${p.message ?? ''}\n`; },
    });
    const skipped = progressLog.includes('skipping rebuild');
    const summary = skipped ? `Index was already fresh — no rebuild needed for ${repoPath}` : `Monograph build complete for ${repoPath}`;
    return text(`${summary}\n${progressLog}`);
  },
};

// ── monograph_watch ───────────────────────────────────────────────────────────

export const monographWatchTool: MCPTool = {
  name: 'monograph_watch',
  description: 'Start incremental file watcher. Rebuilds index on file changes (3s debounce).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo path (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const { MonographWatcher } = await import('@monoes/monograph');
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    if (_activeWatchers.has(repoPath)) {
      return text(`Monograph watcher already running for ${repoPath}.`);
    }
    const watcher = new MonographWatcher(repoPath);
    watcher.on('monograph:updated', (_paths: string[]) => {
      import('@monoes/monograph').then(({ buildAsync }) => buildAsync(repoPath)).catch((e) => {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[monograph_watch] background rebuild failed:', e);
      });
    });
    await watcher.start();
    _activeWatchers.set(repoPath, watcher);
    return text(`Monograph watcher started for ${repoPath}. Watching for file changes...`);
  },
};

// ── monograph_watch_stop ──────────────────────────────────────────────────────

export const monographWatchStopTool: MCPTool = {
  name: 'monograph_watch_stop',
  description: 'Stop the Monograph file watcher.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo path whose watcher to stop (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const watcher = _activeWatchers.get(repoPath);
    if (!watcher) {
      return text(`No active watcher found for ${repoPath}.`);
    }
    await watcher.stop();
    _activeWatchers.delete(repoPath);
    return text(`Monograph watcher stopped for ${repoPath}.`);
  },
};

// ── monograph_detect_changes ──────────────────────────────────────────────────

export const monographDetectChangesTool: MCPTool = {
  name: 'monograph_detect_changes',
  description: 'Git diff → affected symbols: identifies which indexed symbols live in files changed since the base branch.',
  inputSchema: {
    type: 'object',
    properties: {
      baseBranch: { type: 'string', description: 'Base branch to diff against (default: main)' },
      includeTests: { type: 'boolean', description: 'Include test files (default: true)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { detectMonographChanges } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = detectMonographChanges(db, {
        baseBranch: input.baseBranch as string | undefined,
        includeTests: input.includeTests as boolean | undefined,
      }, getProjectCwd());

      // Format as structured text for direct LLM navigation instead of raw JSON
      const r = result as any;
      if (!r || (!r.changedFiles?.length && !r.affectedSymbols?.length)) {
        return text('No changed files found relative to the base branch.');
      }
      const lines: string[] = [];
      const base = r.baseBranch ?? 'main';
      const changedFiles: string[] = r.changedFiles ?? [];
      lines.push(`Changed files vs ${base}: ${changedFiles.length}`);
      if (changedFiles.length > 0) {
        for (const f of changedFiles.slice(0, 20)) lines.push(`  ${f}`);
        if (changedFiles.length > 20) lines.push(`  … ${changedFiles.length - 20} more`);
      }
      lines.push('');
      const affected: any[] = r.affectedSymbols ?? r.affected ?? [];
      if (affected.length > 0) {
        lines.push(`Affected symbols (${affected.length}):`);
        for (const sym of affected.slice(0, 30)) {
          const fp = sym.filePath ?? sym.file_path ?? '';
          const ln = sym.startLine ?? sym.start_line;
          const loc = fp ? (ln != null ? `${fp}:${ln}` : fp) : '';
          lines.push(`  [${sym.label ?? '?'}] ${sym.name ?? sym.id}  ${loc}`);
        }
        if (affected.length > 30) lines.push(`  … ${affected.length - 30} more`);
      }
      return text(lines.join('\n').trim());
    } finally { closeDb(db); }
  },
};

// ── monograph_inject_context ──────────────────────────────────────────────────

export const monographInjectContextTool: MCPTool = {
  name: 'monograph_inject_context',
  description: 'Inject monograph capabilities description into AGENTS.md or CLAUDE.md for AI agent discovery.',
  inputSchema: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: { type: 'string', enum: ['claude', 'agents-md'] },
        description: 'Which files to update (default: both)',
      },
    },
  },
  handler: async (input) => {
    const { injectAiContext } = await import('@monoes/monograph');
    const repoPath = getProjectCwd();
    const result = await injectAiContext({
      repoPath,
      targets: input.targets as Array<'claude' | 'agents-md'> | undefined,
    });
    return text(`Injected context into: ${result.updated.join(', ') || 'none'}`);
  },
};

// ── monograph_skill_gen ───────────────────────────────────────────────────────

export const monographSkillGenTool: MCPTool = {
  name: 'monograph_skill_gen',
  description: 'Generate per-community skill files summarizing code structure for AI navigation.',
  inputSchema: {
    type: 'object',
    properties: {
      outputDir: { type: 'string', description: 'Output directory for skill files (default: .monomind/skills/)' },
    },
  },
  handler: async (input) => {
    const { generateSkillFiles } = await import('@monoes/monograph');
    const repoPath = getProjectCwd();
    const allowedRoot = resolve(repoPath);
    if (input.outputDir) {
      const outDir = resolve(input.outputDir as string);
      if (outDir !== allowedRoot && !outDir.startsWith(allowedRoot + sep)) {
        return text(`Error: outputDir must be within the project directory (${allowedRoot})`);
      }
    }
    const result = await generateSkillFiles(
      repoPath,
      input.outputDir ? resolve(input.outputDir as string) : undefined,
    );
    const dir = result.filesWritten.length > 0
      ? result.filesWritten[0].replace(/\/[^/]+$/, '/')
      : join(repoPath, '.monomind', 'skills') + '/';
    return text(`Generated ${result.communityCount} skill files in ${dir}`);
  },
};

// ── monograph_install_skills ──────────────────────────────────────────────────

export const monographInstallSkillsTool: MCPTool = {
  name: 'monograph_install_skills',
  description: 'Install monograph skill files for a specific IDE/platform (claude, cursor, vscode, zed).',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: 'Target platform: claude, cursor, vscode, or zed',
      },
      repoPath: {
        type: 'string',
        description: 'Absolute path to the repository (defaults to cwd)',
      },
    },
    required: ['platform'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { installSkillsForPlatform } = await import('@monoes/monograph');
    const rawRepoPath = (input.repoPath as string | undefined) ?? getProjectCwd();
    const repoPath = resolve(rawRepoPath);
    const allowedRoot = resolve(getProjectCwd());
    if (repoPath !== allowedRoot && !repoPath.startsWith(allowedRoot + sep)) {
      return text(`Error: repoPath must be within the project directory (${allowedRoot})`);
    }
    const platform = input.platform as string;

    const validPlatforms = ['claude', 'cursor', 'vscode', 'zed'];
    if (!validPlatforms.includes(platform)) {
      return text(`Invalid platform "${platform}". Must be one of: ${validPlatforms.join(', ')}`);
    }

    // Load community data from graph
    const dbPath = getDbPath(repoPath);
    // openDb's fileMustExist option isn't in the currently-published
    // @monoes/monograph release this CLI depends on — check validity
    // ourselves so a missing DB doesn't get silently auto-created empty.
    if (!_isValidDb(dbPath)) {
      return text('Graph not built yet. Run monograph_build first.');
    }
    let db: ReturnType<typeof openDb>;
    try {
      db = openDb(dbPath);
    } catch {
      return text('Graph not built yet. Run monograph_build first.');
    }

    let communities: Array<{ name: string; symbols: string[] }>;
    try {
      // Query distinct community IDs with exported symbols
      const communityIds = db.prepare(`
        SELECT DISTINCT community_id
        FROM nodes
        WHERE community_id IS NOT NULL
          AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
        ORDER BY community_id
      `).all() as Array<{ community_id: number }>;

      if (communityIds.length === 0) {
        closeDb(db);
        return text('No communities found in graph. Run monograph_build first.');
      }

      communities = communityIds.map(({ community_id }) => {
        // Derive a readable name from folder paths
        const pathRows = db.prepare(`
          SELECT file_path FROM nodes
          WHERE community_id = ? AND file_path IS NOT NULL
            AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
          LIMIT 20
        `).all(community_id) as Array<{ file_path: string }>;

        let name = `community-${community_id}`;
        const folderCounts = new Map<string, number>();
        for (const row of pathRows) {
          const parts = row.file_path.replace(/\\/g, '/').split('/').filter(Boolean);
          if (parts.length >= 2) {
            const folder = parts[parts.length - 2].toLowerCase();
            if (!['src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers', 'dist'].includes(folder)) {
              folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
            }
          }
        }
        let bestCount = 0;
        for (const [folder, count] of folderCounts) {
          if (count > bestCount) { bestCount = count; name = folder; }
        }

        // Collect exported symbol names
        const symbolRows = db.prepare(`
          SELECT name FROM nodes
          WHERE community_id = ? AND is_exported = 1
            AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
          ORDER BY name
          LIMIT 50
        `).all(community_id) as Array<{ name: string }>;

        return { name, symbols: symbolRows.map(r => r.name) };
      });
    } catch (err: unknown) {
      closeDb(db);
      const msg = err instanceof Error ? err.message : String(err);
      return text(`Failed to query graph: ${msg}`);
    }
    closeDb(db);

    const result = await installSkillsForPlatform(repoPath, communities, {
      platform: platform as 'claude' | 'cursor' | 'vscode' | 'zed',
    });
    return text(`Installed ${result.filesWritten.length} skill files for ${result.platform} in ${result.outputDir}`);
  },
};
