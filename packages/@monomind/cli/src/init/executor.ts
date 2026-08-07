/**
 * Init Executor
 * Main execution logic for V1 initialization
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import type { InitOptions, InitResult } from './types.js';
import { detectPlatform } from './types.js';
import { writeSharedInstructions } from './shared-instructions-generator.js';

// Split modules
import { DIRECTORIES, MAX_EXEC_FILE_BYTES } from './shared.js';
import { writeSettings, writeMCPConfig, writeHelpers, writeStatusline, writeClaudeMd } from './write-claude.js';
import { writeRuntimeConfig, writeInitialMetrics } from './write-runtime-config.js';
import { writeGeminiFiles } from './write-antigravity.js';
import { writeOpencodeFiles } from './write-opencode.js';
import { writeKimiFiles } from './write-kimicode.js';
import { copySkills, copyCommands, copyAgents } from './copy-assets.js';

// Re-export upgrade functions so index.ts barrel still works via './executor.js'
export { executeUpgrade, executeUpgradeWithMissing } from './upgrade.js';
export type { UpgradeResult } from './upgrade.js';

/**
 * Execute initialization
 */
export async function executeInit(options: InitOptions): Promise<InitResult> {
  // Detect platform
  const platform = detectPlatform();

  const result: InitResult = {
    success: true,
    platform,
    created: {
      directories: [],
      files: [],
    },
    updated: [],
    skipped: [],
    errors: [],
    summary: {
      skillsCount: 0,
      commandsCount: 0,
      agentsCount: 0,
      hooksEnabled: 0,
    },
  };

  const targetDir = options.targetDir;

  try {
    // Create directory structure
    await createDirectories(targetDir, options, result);

    // Scan directory and save fingerprint (non-fatal if failed)
    let capMgr: any = null;
    try {
      const { scanDirectory, saveFingerprint, CapabilityManager, codeCapability, documentsCapability, mediaCapability, timelineCapability, graphCapability, dataCapability } = await import('../capabilities/index.js');
      const scan = await scanDirectory(targetDir);
      const monomindDir = path.join(targetDir, '.monomind');
      await saveFingerprint(scan, monomindDir);

      // Activate capabilities
      capMgr = new CapabilityManager();
      capMgr.register(codeCapability);
      capMgr.register(documentsCapability);
      capMgr.register(mediaCapability);
      capMgr.register(timelineCapability);
      capMgr.register(graphCapability);
      capMgr.register(dataCapability);
      await capMgr.activateFromScan(scan, targetDir);

      // Print capability-aware messaging (always show active capabilities,
      // regardless of whether 'code' is also active, so mixed projects get feedback)
      console.log('\nActivating capabilities:');
      for (const cap of capMgr.getActive()) {
        console.log(`  ✓ ${cap.name}`);
      }
      // Second Brain: if documents capability is active, index the full tree.
      // Even when it is NOT active (code-only projects), ingest common
      // documentation files so the Second Brain is seeded with project context
      // that would otherwise cause zero-hits on every prompt.
      const activeNames = capMgr.getActive().map((c: any) => c.name);
      try {
        const { ingestDirectory, ingestDocument } = await import('../knowledge/document-pipeline.js');
        const fs = await import('node:fs');

        if (activeNames.includes('documents')) {
          console.log('\nIndexing documents for Second Brain...');
          const docResult = await ingestDirectory(targetDir, 'shared', { rootDir: targetDir });
          if (docResult.filesProcessed > 0) {
            console.log(`  ✓ ${docResult.totalChunks} chunks from ${docResult.filesProcessed} documents`);
          } else {
            console.log('  ✓ Knowledge base initialized (no new documents to index)');
          }
        } else {
          // Code-only project: ingest common doc directories and root files
          // so the Second Brain is not empty. Skip silently when nothing exists.
          console.log('\nSeeding Second Brain with project docs...');
          let seeded = 0;
          let seededChunks = 0;

          // Ingest doc directories (doc/, docs/) if present
          for (const docDir of ['doc', 'docs']) {
            const dirPath = path.join(targetDir, docDir);
            if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
              const dirResult = await ingestDirectory(dirPath, 'shared', { rootDir: targetDir });
              seeded += dirResult.filesProcessed;
              seededChunks += dirResult.totalChunks;
            }
          }

          // Ingest common root markdown files
          for (const rootDoc of ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CLAUDE.md']) {
            const filePath = path.join(targetDir, rootDoc);
            if (fs.existsSync(filePath)) {
              const fileResult = await ingestDocument(filePath, 'shared', targetDir);
              if (!fileResult.skipped) {
                seeded++;
                seededChunks += fileResult.chunksIndexed;
              }
            }
          }

          if (seeded > 0) {
            console.log(`  ✓ ${seededChunks} chunks from ${seeded} documents`);
          } else {
            console.log('  ✓ Knowledge base initialized (no project docs found)');
          }
        }
        result.created.files.push('.monomind/knowledge/');
      } catch (docErr) {
        result.skipped.push(`knowledge indexing: ${docErr instanceof Error ? docErr.message : String(docErr)}`);
      }
    } catch (scanError) {
      // Scanner/fingerprint/activation failed — non-fatal, continue without capabilities
      result.skipped.push(`directory scan: ${scanError instanceof Error ? scanError.message : String(scanError)}`);
    }

    // Generate and write settings.json
    if (options.components.settings) {
      await writeSettings(targetDir, options, result);
    }

    // Generate and write .mcp.json
    if (options.components.mcp) {
      await writeMCPConfig(targetDir, options, result);
    }

    // Copy skills
    if (options.components.skills) {
      await copySkills(targetDir, options, result);
    }

    // Copy commands
    if (options.components.commands) {
      await copyCommands(targetDir, options, result);
    }

    // Copy agents
    if (options.components.agents) {
      await copyAgents(targetDir, options, result);
    }

    // Generate helpers
    if (options.components.helpers) {
      await writeHelpers(targetDir, options, result);
    }

    // Generate statusline
    if (options.components.statusline) {
      await writeStatusline(targetDir, options, result);
    }

    // Generate runtime config
    if (options.components.runtime) {
      await writeRuntimeConfig(targetDir, options, result);
    }

    // Create initial metrics for statusline (prevents "all zeros" display)
    if (options.components.statusline) {
      await writeInitialMetrics(targetDir, options, result);
    }

    // Generate CLAUDE.md
    if (options.components.claudeMd) {
      await writeClaudeMd(targetDir, options, result);
    }

    // Generate Antigravity (agy) files: GEMINI.md, rules, statusline.sh, settings.json
    await writeGeminiFiles(targetDir, options, result);

    // Generate opencode artifacts (opt-in via components.opencode, default false).
    // Purely additive: only writes opencode.json + .opencode/ when enabled.
    if (options.components.opencode) {
      await writeOpencodeFiles(targetDir, options, result);
    }

    // Generate Kimi Code artifacts (opt-in via components.kimicode, default false).
    // Purely additive: only writes .kimi-code/ + AGENTS.md when enabled.
    if (options.components.kimicode) {
      await writeKimiFiles(targetDir, options, result);
    }

    // Generate .agents/shared_instructions.md + seed project memory
    writeSharedInstructions(targetDir, options.force, result);

    // Count enabled hooks
    result.summary.hooksEnabled = countEnabledHooks(options);

    // Build knowledge graph in background (non-blocking) — code-project only
    if (options.components.graphify && (capMgr === null || capMgr.isActive('code'))) {
      await initKnowledgeGraph(targetDir, result);
    } else if (options.components.graphify) {
      result.skipped.push('knowledge graph: not a code project (skipping monograph indexing)');
    }

    // Run doctor auto-fix (non-blocking, best-effort)
    await runDoctorFix(targetDir, result);

    // Register this project in ~/.monomind-projects.json so upgrade --all finds it
    _registerMonomindProject(targetDir);

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Initialize the Monograph knowledge graph.
 * Spawns buildAsync as a detached child process to avoid SQLite lock contention.
 * Uses the same build.lock file as graphify-freshen.cjs — if a session-start
 * hook build is already running, we skip to avoid SQLITE_BUSY.
 */
async function initKnowledgeGraph(targetDir: string, result: InitResult): Promise<void> {
  const outputDir = path.join(targetDir, '.monomind', 'graph');
  fs.mkdirSync(outputDir, { recursive: true });

  const lockPath = path.join(outputDir, 'build.lock');
  const now = Date.now();

  // If graphify-freshen.cjs (session-start hook) already holds a fresh lock, skip.
  try {
    const stat = fs.statSync(lockPath);
    if (now - stat.mtimeMs < 5 * 60 * 1000) {
      result.skipped.push('knowledge graph build: already in progress (session-start hook running)');
      return;
    }
    fs.unlinkSync(lockPath);
  } catch { /* no lock — proceed */ }

  // Resolve @monoes/monograph from the CLI package's own node_modules first
  // (correct for npm/npx installs), then fall back to user project node_modules.
  let entryPoint: string | null = null;
  try {
    const cliRequire = createRequire(import.meta.url);
    entryPoint = cliRequire.resolve('@monoes/monograph/dist/src/index.js');
  } catch {
    const fallback = path.join(targetDir, 'node_modules', '@monoes', 'monograph', 'dist', 'src', 'index.js');
    if (fs.existsSync(fallback)) entryPoint = fallback;
  }
  if (!entryPoint) {
    // Auto-install @monoes/monograph and retry before giving up
    try {
      const { execSync } = await import('child_process');
      execSync('npm install @monoes/monograph', { cwd: targetDir, stdio: 'ignore', timeout: 60000 });
      try {
        const cliRequire2 = createRequire(import.meta.url);
        entryPoint = cliRequire2.resolve('@monoes/monograph/dist/src/index.js');
      } catch {
        const fallback2 = path.join(targetDir, 'node_modules', '@monoes', 'monograph', 'dist', 'src', 'index.js');
        if (fs.existsSync(fallback2)) entryPoint = fallback2;
      }
    } catch { /* install failed, fall through */ }
    if (!entryPoint) {
      result.skipped.push('knowledge graph: @monoes/monograph not found (auto-install failed)');
      return;
    }
    result.created.files.push('@monoes/monograph (auto-installed for knowledge graph)');
  }

  // Acquire lock before spawning so graphify-freshen.cjs sees it and skips
  try { fs.writeFileSync(lockPath, String(process.pid)); } catch { /* non-fatal */ }

  const { spawn } = await import('child_process');
  const logPath = path.join(outputDir, 'build.log');
  let logFd: number | 'ignore' = 'ignore';
  try { logFd = fs.openSync(logPath, 'a'); } catch { /* non-fatal */ }

  const script = `
import { buildAsync } from ${JSON.stringify(pathToFileURL(entryPoint).href)};
import { unlinkSync } from 'fs';
try { await buildAsync(${JSON.stringify(targetDir)}); } finally {
  try { unlinkSync(${JSON.stringify(lockPath)}); } catch {}
}`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: targetDir,
  });
  child.unref();
  // Close the parent's copy of the fd — the child has its own inherited copy
  if (typeof logFd === 'number') {
    try { fs.closeSync(logFd); } catch { /* non-fatal */ }
  }

  result.created.files.push('.monomind/graph/ (knowledge graph building in background)');
}

/**
 * Run doctor --install to auto-fix any remaining issues.
 * Non-fatal: best-effort health check and auto-install.
 */
async function runDoctorFix(targetDir: string, result: InitResult): Promise<void> {
  try {
    const { doctorCommand } = await import('../commands/doctor.js');
    if (!doctorCommand.action) {
      result.skipped.push('doctor: auto-fix unavailable (run: monomind doctor --install)');
      return;
    }
    const res = await doctorCommand.action({
      args: [],
      flags: { install: true },
      cwd: targetDir,
    } as never);
    if (res && (res as { success?: boolean }).success === false) {
      result.skipped.push('doctor: reported issues (run: monomind doctor for details)');
    } else {
      result.created.files.push('doctor --install (health check + auto-fix)');
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    result.skipped.push(`doctor: auto-fix failed (${detail}) — run: monomind doctor --install`);
  }
}

/**
 * Create directory structure
 */
async function createDirectories(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const dirs = [
    ...DIRECTORIES.claude,
    ...(options.components.runtime ? DIRECTORIES.runtime : []),
  ];

  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      result.created.directories.push(dir);
    }
  }
}

/**
 * Count enabled hooks
 */
function countEnabledHooks(options: InitOptions): number {
  const hooks = options.hooks;
  let count = 0;

  if (hooks.preToolUse) count++;
  if (hooks.postToolUse) count++;
  if (hooks.userPromptSubmit) count++;
  if (hooks.sessionStart) count++;
  if (hooks.stop) count++;
  if (hooks.preCompact) count++;
  if (hooks.notification) count++;

  return count;
}

/**
 * Register a project directory in ~/.monomind-projects.json so that
 * `monomind init upgrade --all` can find it without doing a directory scan.
 * Best-effort: failures are silently swallowed.
 */
function _registerMonomindProject(dir: string): void {
  try {
    const esmReq = createRequire(import.meta.url);
    const os = esmReq('os') as typeof import('os');
    const registryPath = path.join(os.homedir(), '.monomind-projects.json');
    let reg: { projects: string[] } = { projects: [] };
    try { if (fs.existsSync(registryPath) && fs.statSync(registryPath).size <= MAX_EXEC_FILE_BYTES) { reg = JSON.parse(fs.readFileSync(registryPath, 'utf-8')); } } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[_registerMonomindProject] ~/.monomind-projects.json unparseable, resetting:', e);
    }
    if (!Array.isArray(reg.projects)) reg.projects = [];
    const abs = path.resolve(dir);
    if (!reg.projects.includes(abs)) {
      reg.projects.push(abs);
      fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2), 'utf-8');
    }
  } catch { /* non-fatal */ }
}

/**
 * Scan common locations for directories that have monomind installed
 * (presence of .claude/helpers/hook-handler.cjs is the definitive signal).
 * Searches up to maxDepth directory levels below each search root.
 */
export function findMonomindProjects(maxDepth = 3): string[] {
  const esmReq = createRequire(import.meta.url);
  const os = esmReq('os') as typeof import('os');
  const home = os.homedir();
  const searchRoots = [
    path.join(home, 'Desktop'),
    path.join(home, 'projects'),
    path.join(home, 'code'),
    path.join(home, 'work'),
    path.join(home, 'dev'),
    path.join(home, 'repos'),
    path.join(home, 'src'),
  ].filter(r => fs.existsSync(r));

  // Also check known-projects registry if it exists
  const registryPath = path.join(home, '.monomind-projects.json');
  if (fs.existsSync(registryPath) && fs.statSync(registryPath).size <= MAX_EXEC_FILE_BYTES) {
    try {
      const reg = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      if (Array.isArray(reg.projects)) {
        for (const p of reg.projects) {
          if (!searchRoots.includes(p) && fs.existsSync(p)) searchRoots.push(p);
        }
      }
    } catch {}
  }

  const found: Set<string> = new Set();

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    const marker = path.join(dir, '.claude', 'helpers', 'hook-handler.cjs');
    if (fs.existsSync(marker)) { found.add(dir); return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of searchRoots) { walk(root, 0); }
  return [...found];
}

export default executeInit;
