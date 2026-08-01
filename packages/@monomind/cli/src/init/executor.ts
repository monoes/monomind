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

const MAX_EXEC_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Probe whether an optionalDependency actually resolved in this install
 * (npm silently skips optionalDependencies it can't satisfy — see
 * docs/AUDIT-BACKLOG.md P1-1/P1-23). Used to caveat generated docs instead
 * of presenting these features as unconditionally working.
 */
function _isOptionalPackageResolvable(pkg: string): boolean {
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
function atomicWriteFile(target: string, content: string | Buffer, encoding?: BufferEncoding): void {
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
import type { InitOptions, InitResult, PlatformInfo } from './types.js';
import { detectPlatform, DEFAULT_INIT_OPTIONS } from './types.js';
import { writeSharedInstructions } from './shared-instructions-generator.js';
import { generateSettingsJson, generateSettings } from './settings-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateStatuslineScript, generateStatuslineHook } from './statusline-generator.js';
import {
  FORCE_SYNC_HELPERS,
  FORCE_SYNC_GENERATORS,
  INIT_FALLBACK_HELPERS,
} from './helpers-generator.js';
import { generateClaudeMd } from './claudemd-generator.js';
import { generateOpencodeJson, generateAgentsMd, generateHooksPlugin, generateStatusCommand, convertAgentMd, convertCommandMd, convertSkillMd, opencodeCommandFilename } from './opencode-generator.js';
import { generateKimiMcpJson, mergeKimiMcpJson, generateKimiAgentsMd, generateKimiGateScript, generateKimiPluginManifest, convertKimiAgentMd, convertKimiSkillMd, convertKimiCommandToFlowSkill, convertKimiPluginCommandMd, kimiCommandFilename } from './kimi-generator.js';
import {
  generateGeminiMd,
  generateGeminiRulesMd,
  generateStatuslineSh,
} from './geminimd-generator.js';

/**
 * Skills to copy based on configuration
 */
const SKILLS_MAP: Record<string, string[]> = {
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
const COMMANDS_MAP: Record<string, string[]> = {
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
const AGENTS_MAP: Record<string, string[]> = {
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
const DIRECTORIES = {
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
      // Second Brain: if documents capability is active, index documents
      const activeNames = capMgr.getActive().map((c: any) => c.name);
      if (activeNames.includes('documents')) {
        try {
          const { ingestDirectory } = await import('../knowledge/document-pipeline.js');
          console.log('\nIndexing documents for Second Brain...');
          const docResult = await ingestDirectory(targetDir, 'shared', { rootDir: targetDir });
          if (docResult.filesProcessed > 0) {
            console.log(`  ✓ ${docResult.totalChunks} chunks from ${docResult.filesProcessed} documents`);
          } else {
            console.log('  ✓ Knowledge base initialized (no new documents to index)');
          }
          result.created.files.push('.monomind/knowledge/');
        } catch (docErr) {
          result.skipped.push(`knowledge indexing: ${docErr instanceof Error ? docErr.message : String(docErr)}`);
        }
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
  // Run the doctor THIS binary ships, in-process.
  //
  // This used to be `execSync('npx monomind@latest doctor --install')`, which
  // was wrong in three ways at once: it downloaded and ran a DIFFERENT version
  // than the one the user deliberately invoked (so `monomind@2.7.0 init` was
  // finished by whatever `latest` happened to be), it silently required network
  // — on a machine without it, the 120s timeout elapsed and init reported
  // "skipped" with no explanation — and `stdio: 'ignore'` discarded everything
  // it said, so a failed health check looked identical to a passing one.
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
    // Report what actually happened rather than asserting success either way.
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
 * Upgrade result interface
 */
export interface UpgradeResult {
  success: boolean;
  updated: string[];
  created: string[];
  preserved: string[];
  errors: string[];
  /** Added by --add-missing flag */
  addedSkills?: string[];
  addedAgents?: string[];
  addedCommands?: string[];
  /** Added by --settings flag */
  settingsUpdated?: string[];
}

/**
 * Merge new settings into existing settings.json
 * Preserves user customizations while adding new features like Agent Teams
 * Uses platform-specific commands for Mac, Linux, and Windows
 */
function mergeSettingsForUpgrade(existing: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  const platform = detectPlatform();
  const isWindows = platform.os === 'windows';

  // Platform-specific command wrappers
  // Windows: Use PowerShell-compatible commands
  // Mac/Linux: Use bash-compatible commands with 2>/dev/null
  // NOTE: teammateIdleCmd and taskCompletedCmd were removed.
  // TeammateIdle/TaskCompleted are not valid Claude Code hook events and caused warnings.
  // Agent Teams hook config lives in monomind.agentTeams.hooks instead.

  // 1. Merge env vars (preserve existing, add new)
  const existingEnv = (existing.env as Record<string, string>) || {};
  merged.env = {
    ...existingEnv,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    MONOMIND_V1_ENABLED: existingEnv.MONOMIND_V1_ENABLED || 'true',
    MONOMIND_HOOKS_ENABLED: existingEnv.MONOMIND_HOOKS_ENABLED || 'true',
  };

  // 2. Merge hooks (preserve existing, add new Agent Teams + auto-memory hooks)
  const existingHooks = (existing.hooks as Record<string, unknown[]>) || {};
  merged.hooks = { ...existingHooks };

  // Cross-platform auto-memory hook commands that resolve paths via git root.
  // Uses node -e with git rev-parse so hooks work regardless of CWD (#1259, #1284).
  const gitRootResolver = "var c=require('child_process'),p=require('path'),u=require('url'),r;"
    + "try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}"
    + 'catch(e){r=process.cwd()}';
  const autoMemoryScript = '.claude/helpers/auto-memory-hook.mjs';
  const autoMemoryImportCmd = `node -e "${gitRootResolver}var f=p.join(r,'${autoMemoryScript}');import(u.pathToFileURL(f).href)" import`;
  const autoMemorySyncCmd = `node -e "${gitRootResolver}var f=p.join(r,'${autoMemoryScript}');import(u.pathToFileURL(f).href)" sync`;

  // Add auto-memory import to SessionStart (if not already present)
  const sessionStartHooks = existingHooks.SessionStart as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
  const hasAutoMemoryImport = sessionStartHooks?.some(group =>
    group.hooks?.some(h => h.command?.includes('auto-memory-hook')));
  if (!hasAutoMemoryImport) {
    const startHooks = merged.hooks as Record<string, unknown[]>;
    if (!startHooks.SessionStart) {
      startHooks.SessionStart = [{ hooks: [] }];
    }
    const startGroup = startHooks.SessionStart[0] as { hooks: unknown[] };
    if (!startGroup.hooks) startGroup.hooks = [];
    startGroup.hooks.push({
      type: 'command',
      command: autoMemoryImportCmd,
      timeout: 6000,
      continueOnError: true,
    });
  }

  // Add auto-memory sync to SessionEnd (if not already present)
  const sessionEndHooks = existingHooks.SessionEnd as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
  const hasAutoMemorySync = sessionEndHooks?.some(group =>
    group.hooks?.some(h => h.command?.includes('auto-memory-hook')));
  if (!hasAutoMemorySync) {
    const endHooks = merged.hooks as Record<string, unknown[]>;
    if (!endHooks.SessionEnd) {
      endHooks.SessionEnd = [{ hooks: [] }];
    }
    const endGroup = endHooks.SessionEnd[0] as { hooks: unknown[] };
    if (!endGroup.hooks) endGroup.hooks = [];
    // Insert at beginning so sync runs before other cleanup
    endGroup.hooks.unshift({
      type: 'command',
      command: autoMemorySyncCmd,
      timeout: 8000,
      continueOnError: true,
    });
  }

  // NOTE: TeammateIdle and TaskCompleted are NOT valid Claude Code hook events.
  // They cause warnings when present in settings.json hooks.
  // Remove them if they exist from a previous init.
  delete (merged.hooks as Record<string, unknown>).TeammateIdle;
  delete (merged.hooks as Record<string, unknown>).TaskCompleted;
  // Their configuration lives in monomind.agentTeams.hooks instead.

  // 3. Fix statusLine config (remove invalid fields, ensure correct format)
  // Claude Code only supports: type, command, padding
  const existingStatusLine = existing.statusLine as Record<string, unknown> | undefined;
  if (existingStatusLine) {
    merged.statusLine = {
      type: 'command',
      command: existingStatusLine.command || `node -e "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}var s=p.join(r,'.claude/helpers/statusline.cjs');process.argv.splice(1,0,s);require(s)"`,
      // Remove invalid fields: refreshMs, enabled (not supported by Claude Code)
    };
  }

  // 4. Merge monomind settings (preserve existing, add agentTeams + memory)
  const existingMonomind = (existing.monomind as Record<string, unknown>) || {};
  const existingMemory = (existingMonomind.memory as Record<string, unknown>) || {};
  merged.monomind = {
    ...existingMonomind,
    version: existingMonomind.version || '3.0.0',
    enabled: existingMonomind.enabled !== false,
    agentTeams: {
      enabled: true,
      teammateMode: 'auto',
      taskListEnabled: true,
      mailboxEnabled: true,
      coordination: {
        autoAssignOnIdle: true,
        trainPatternsOnComplete: true,
        notifyLeadOnComplete: true,
        sharedMemoryNamespace: 'agent-teams',
      },
      hooks: {
        teammateIdle: { enabled: true, autoAssign: true, checkTaskList: true },
        taskCompleted: { enabled: true, trainPatterns: true, notifyLead: true },
      },
    },
    memory: {
      ...existingMemory,
      learningBridge: existingMemory.learningBridge ?? { enabled: true },
      memoryGraph: existingMemory.memoryGraph ?? { enabled: true },
      agentScopes: existingMemory.agentScopes ?? { enabled: true },
    },
  };

  return merged;
}

/**
 * Execute upgrade - updates helpers and creates missing metrics without losing data
 * This is safe for existing users who want the latest statusline fixes
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export async function executeUpgrade(targetDir: string, upgradeSettings = false): Promise<UpgradeResult> {
  const result: UpgradeResult = {
    success: true,
    updated: [],
    created: [],
    preserved: [],
    errors: [],
    settingsUpdated: [],
  };

  try {
    // Ensure required directories exist
    const dirs = [
      '.claude/helpers',
      '.monomind/metrics',
      '.monomind/security',
      '.monomind/learning',
    ];

    for (const dir of dirs) {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // 0. ALWAYS update critical helpers + subdirectories (force overwrite)
    const sourceHelpersForUpgrade = findSourceHelpersDir();
    if (sourceHelpersForUpgrade) {
      const destHelpersDir = path.join(targetDir, '.claude', 'helpers');
      // Copy top-level critical files atomically. Membership and fallback
      // generators come from the shared HELPER_FILES registry (helpers-generator.ts)
      // rather than a hardcoded list here — see that file's comment for why.
      const criticalHelpers = FORCE_SYNC_HELPERS;
      // Generated fallback for any critical helper missing from the source dir itself
      // (e.g. the published npm template lacking auto-memory-hook.mjs).
      const criticalGenerators: Record<string, () => string> = FORCE_SYNC_GENERATORS;
      for (const helperName of criticalHelpers) {
        const targetPath = path.join(destHelpersDir, helperName);
        const sourcePath = path.join(sourceHelpersForUpgrade, helperName);
        if (fs.existsSync(sourcePath)) {
          if (fs.existsSync(targetPath)) {
            result.updated.push(`.claude/helpers/${helperName}`);
          } else {
            result.created.push(`.claude/helpers/${helperName}`);
          }
          // Atomic copy-via-rename so a partial write can't leave a broken hook
          const tmp = targetPath + '.tmp';
          fs.copyFileSync(sourcePath, tmp);
          try { fs.chmodSync(tmp, 0o755); } catch {}
          fs.renameSync(tmp, targetPath);
        } else if (!fs.existsSync(targetPath) && criticalGenerators[helperName]) {
          const content = criticalGenerators[helperName]();
          const tmp = `${targetPath}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, content, 'utf-8');
          try { fs.chmodSync(tmp, 0o755); } catch {}
          fs.renameSync(tmp, targetPath);
          result.created.push(`.claude/helpers/${helperName}`);
        }
      }
      // Always recursively sync subdirectories (utils/, handlers/) — required by hook-handler.cjs.
      // Uses recursive copy so any future nested subdirs are also covered.
      for (const subdir of ['utils', 'handlers']) {
        const srcSubdir = path.join(sourceHelpersForUpgrade, subdir);
        const destSubdir = path.join(destHelpersDir, subdir);
        if (fs.existsSync(srcSubdir)) {
          copyDirRecursive(srcSubdir, destSubdir);
          result.updated.push(`.claude/helpers/${subdir}/`);
        }
      }
    } else {
      // Source not found (npx with broken paths) — use generated fallbacks
      // for every force-synced helper that has one (see HELPER_FILES registry).
      const generatedCritical: Record<string, string> = Object.fromEntries(
        Object.entries(FORCE_SYNC_GENERATORS).map(([name, generate]) => [name, generate()]),
      );
      for (const [helperName, content] of Object.entries(generatedCritical)) {
        const targetPath = path.join(targetDir, '.claude', 'helpers', helperName);
        if (fs.existsSync(targetPath)) {
          result.updated.push(`.claude/helpers/${helperName}`);
        } else {
          result.created.push(`.claude/helpers/${helperName}`);
        }
        // Atomic write (PID-suffixed) so a partial hook-handler.cjs cannot
        // ship if init is interrupted, and concurrent inits don't collide on
        // the same .tmp filename.
        const tmp = `${targetPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, content, 'utf-8');
        try { fs.chmodSync(tmp, 0o755); } catch {}
        fs.renameSync(tmp, targetPath);
      }
    }

    // 1. Statusline fallback — only generate if source copy above didn't cover it
    const statuslinePath = path.join(targetDir, '.claude', 'helpers', 'statusline.cjs');
    if (!sourceHelpersForUpgrade || !fs.existsSync(path.join(sourceHelpersForUpgrade, 'statusline.cjs'))) {
      const upgradeOptions: InitOptions = {
        ...DEFAULT_INIT_OPTIONS,
        targetDir,
        force: true,
        statusline: {
          ...DEFAULT_INIT_OPTIONS.statusline,
          refreshInterval: 5000,
        },
      };
      const statuslineContent = generateStatuslineScript(upgradeOptions);
      if (fs.existsSync(statuslinePath)) {
        result.updated.push('.claude/helpers/statusline.cjs');
      } else {
        result.created.push('.claude/helpers/statusline.cjs');
      }
      atomicWriteFile(statuslinePath, statuslineContent);
    }

    // 2. Create MISSING metrics files only (preserve existing data)
    const metricsDir = path.join(targetDir, '.monomind', 'metrics');
    const securityDir = path.join(targetDir, '.monomind', 'security');

    // v1-progress.json
    const progressPath = path.join(metricsDir, 'v1-progress.json');
    if (!fs.existsSync(progressPath)) {
      const progress = {
        version: '3.0.0',
        initialized: new Date().toISOString(),
        domains: { completed: 0, total: 5, status: 'INITIALIZING' },
        ddd: { progress: 0, modules: 0, totalFiles: 0, totalLines: 0 },
        swarm: { activeAgents: 0, maxAgents: 15, topology: 'hierarchical-mesh' },
        learning: { status: 'READY', patternsLearned: 0, sessionsCompleted: 0 },
        _note: 'Metrics will update as you use Monomind'
      };
      atomicWriteFile(progressPath, JSON.stringify(progress, null, 2));
      result.created.push('.monomind/metrics/v1-progress.json');
    } else {
      result.preserved.push('.monomind/metrics/v1-progress.json');
    }

    // swarm-activity.json
    const activityPath = path.join(metricsDir, 'swarm-activity.json');
    if (!fs.existsSync(activityPath)) {
      const activity = {
        timestamp: new Date().toISOString(),
        processes: { mcp_server: 0, estimated_agents: 0 },
        swarm: { active: false, agent_count: 0, coordination_active: false },
        integration: { mcp_active: false },
        _initialized: true
      };
      atomicWriteFile(activityPath, JSON.stringify(activity, null, 2));
      result.created.push('.monomind/metrics/swarm-activity.json');
    } else {
      result.preserved.push('.monomind/metrics/swarm-activity.json');
    }

    // learning.json
    const learningPath = path.join(metricsDir, 'learning.json');
    if (!fs.existsSync(learningPath)) {
      const learning = {
        initialized: new Date().toISOString(),
        routing: { accuracy: 0, decisions: 0 },
        patterns: { shortTerm: 0, longTerm: 0, quality: 0 },
        sessions: { total: 0, current: null },
        _note: 'Intelligence grows as you use Monomind'
      };
      atomicWriteFile(learningPath, JSON.stringify(learning, null, 2));
      result.created.push('.monomind/metrics/learning.json');
    } else {
      result.preserved.push('.monomind/metrics/learning.json');
    }

    // audit-status.json
    const auditPath = path.join(securityDir, 'audit-status.json');
    if (!fs.existsSync(auditPath)) {
      const audit = {
        initialized: new Date().toISOString(),
        status: 'PENDING',
        cvesFixed: 0,
        totalCves: 3,
        lastScan: null,
        _note: 'Run: npx monomind@latest security scan'
      };
      atomicWriteFile(auditPath, JSON.stringify(audit, null, 2));
      result.created.push('.monomind/security/audit-status.json');
    } else {
      result.preserved.push('.monomind/security/audit-status.json');
    }

    // 3. Merge settings if requested
    if (upgradeSettings) {
      const settingsPath = path.join(targetDir, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath) && fs.statSync(settingsPath).size <= MAX_EXEC_FILE_BYTES) {
        try {
          const existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const mergedSettings = mergeSettingsForUpgrade(existingSettings);
          atomicWriteFile(settingsPath, JSON.stringify(mergedSettings, null, 2));
          result.updated.push('.claude/settings.json');
          result.settingsUpdated = [
            'env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
            'hooks.SessionStart (auto-memory import)',
            'hooks.SessionEnd (auto-memory sync)',
            'hooks.TeammateIdle (removed — not a valid Claude Code hook)',
            'hooks.TaskCompleted (removed — not a valid Claude Code hook)',
            'monomind.agentTeams',
            'monomind.memory (learningBridge, memoryGraph, agentScopes)',
          ];
        } catch (settingsError) {
          result.errors.push(`Settings merge failed: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`);
        }
      } else {
        // Create new settings.json with defaults
        const defaultSettings = generateSettings(DEFAULT_INIT_OPTIONS);
        atomicWriteFile(settingsPath, JSON.stringify(defaultSettings, null, 2));
        result.created.push('.claude/settings.json');
        result.settingsUpdated = ['Created new settings.json with Agent Teams'];
      }
    }

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Execute upgrade with --add-missing flag
 * Adds any new skills, agents, and commands that don't exist yet
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export async function executeUpgradeWithMissing(targetDir: string, upgradeSettings = false): Promise<UpgradeResult> {
  // First do the normal upgrade (pass through upgradeSettings)
  const result = await executeUpgrade(targetDir, upgradeSettings);

  if (!result.success) {
    return result;
  }

  // Initialize tracking arrays
  result.addedSkills = [];
  result.addedAgents = [];
  result.addedCommands = [];

  try {
    // Ensure target directories exist
    const skillsDir = path.join(targetDir, '.claude', 'skills');
    const agentsDir = path.join(targetDir, '.claude', 'agents');
    const commandsDir = path.join(targetDir, '.claude', 'commands');

    for (const dir of [skillsDir, agentsDir, commandsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Find source directories
    const sourceSkillsDir = findSourceDir('skills');
    const sourceAgentsDir = findSourceDir('agents');
    const sourceCommandsDir = findSourceDir('commands');

    // Debug: Log source directories found
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
      console.log('[DEBUG] Source directories:');
      console.log(`  Skills: ${sourceSkillsDir || 'NOT FOUND'}`);
      console.log(`  Agents: ${sourceAgentsDir || 'NOT FOUND'}`);
      console.log(`  Commands: ${sourceCommandsDir || 'NOT FOUND'}`);
    }

    // Add missing skills
    if (sourceSkillsDir) {
      const allSkills = Object.values(SKILLS_MAP).flat();
      const debugMode = process.env.DEBUG || process.env.MONOMIND_DEBUG;
      if (debugMode) {
        console.log(`[DEBUG] Checking ${allSkills.length} skills from SKILLS_MAP`);
      }
      for (const skillName of [...new Set(allSkills)]) {
        const sourcePath = path.join(sourceSkillsDir, skillName);
        const targetPath = path.join(skillsDir, skillName);
        const sourceExists = fs.existsSync(sourcePath);
        const targetExists = fs.existsSync(targetPath);

        if (debugMode) {
          console.log(`[DEBUG] Skill '${skillName}': source=${sourceExists}, target=${targetExists}`);
        }

        if (sourceExists && !targetExists) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedSkills.push(skillName);
          result.created.push(`.claude/skills/${skillName}`);
        }
      }
    }

    // Add missing agents
    if (sourceAgentsDir) {
      const allAgents = Object.values(AGENTS_MAP).flat();
      for (const agentCategory of [...new Set(allAgents)]) {
        const sourcePath = path.join(sourceAgentsDir, agentCategory);
        const targetPath = path.join(agentsDir, agentCategory);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedAgents.push(agentCategory);
          result.created.push(`.claude/agents/${agentCategory}`);
        }
      }
    }

    // Add missing commands
    if (sourceCommandsDir) {
      const allCommands = Object.values(COMMANDS_MAP).flat();
      for (const cmdName of [...new Set(allCommands)]) {
        const sourcePath = path.join(sourceCommandsDir, cmdName);
        const targetPath = path.join(commandsDir, cmdName);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          if (fs.statSync(sourcePath).isDirectory()) {
            copyDirRecursive(sourcePath, targetPath);
          } else {
            fs.copyFileSync(sourcePath, targetPath);
          }
          result.addedCommands.push(cmdName);
          result.created.push(`.claude/commands/${cmdName}`);
        }
      }
    }

  } catch (error) {
    result.errors.push(`Add missing failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
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
 * Write settings.json
 */
async function writeSettings(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const generated = JSON.parse(generateSettingsJson(options));

  if (fs.existsSync(settingsPath) && !options.force && fs.statSync(settingsPath).size <= MAX_EXEC_FILE_BYTES) {
    // Merge hooks/env/permissions into existing settings instead of skipping
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      let merged = false;

      // Merge hooks (the critical missing piece — #1484)
      if (generated.hooks && !existing.hooks) {
        existing.hooks = generated.hooks;
        merged = true;
      }

      // Merge env vars (for CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS etc.)
      if (generated.env) {
        existing.env = { ...(existing.env || {}), ...generated.env };
        merged = true;
      }

      // Merge permissions (add monomind allow rules)
      if (generated.permissions?.allow) {
        const existingAllow = existing.permissions?.allow || [];
        const newRules = generated.permissions.allow.filter(
          (r: string) => !existingAllow.includes(r)
        );
        if (newRules.length > 0) {
          existing.permissions = existing.permissions || {};
          existing.permissions.allow = [...existingAllow, ...newRules];
          merged = true;
        }
      }

      if (merged) {
        atomicWriteFile(settingsPath, JSON.stringify(existing, null, 2));
        result.created.files.push('.claude/settings.json (merged hooks)');
      } else {
        result.skipped.push('.claude/settings.json');
      }
    } catch (e) {
      // Existing file is corrupt — overwrite
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeSettings] existing settings.json unparseable, overwriting with generated defaults:', e);
      atomicWriteFile(settingsPath, JSON.stringify(generated, null, 2));
      result.created.files.push('.claude/settings.json');
    }
    return;
  }

  atomicWriteFile(settingsPath, JSON.stringify(generated, null, 2));
  result.created.files.push('.claude/settings.json');
}

/**
 * Write .mcp.json
 */
async function writeMCPConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const mcpPath = path.join(targetDir, '.mcp.json');

  if (fs.existsSync(mcpPath) && !options.force) {
    result.skipped.push('.mcp.json');
    return;
  }

  const content = generateMCPJson(options);
  atomicWriteFile(mcpPath, content);
  result.created.files.push('.mcp.json');
}

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
const INIT_MANIFEST_REL = path.join('.monomind', 'init-manifest.json');

interface InitManifest {
  version: number;
  /** Entry names directly under .claude/skills that init generated. */
  skills: string[];
  /** Entry names directly under .claude/commands that init generated. */
  commands: string[];
  /** Entry names (category dirs) directly under .claude/agents that init generated. */
  agents: string[];
}

type InitManifestSection = 'skills' | 'commands' | 'agents';

/**
 * Read the provenance manifest. Returns null when absent or unreadable —
 * callers must treat that as "provenance unknown", i.e. delete nothing.
 */
function readInitManifest(targetDir: string): InitManifest | null {
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
function previouslyGenerated(targetDir: string, section: InitManifestSection): Set<string> {
  return new Set(readInitManifest(targetDir)?.[section] ?? []);
}

/**
 * Record the entries init just wrote for one section, merging into any
 * existing manifest so a partial run (e.g. --only-claude, or a section whose
 * source dir was missing) never drops provenance for the other sections.
 */
function recordGenerated(targetDir: string, section: InitManifestSection, entries: string[]): void {
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
 * Copy skills from source
 */
async function copySkills(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const skillsConfig = options.skills;
  const targetSkillsDir = path.join(targetDir, '.claude', 'skills');

  // Determine which skills to copy
  const skillsToCopy: string[] = [];

  if (skillsConfig.all) {
    // Copy all available skills
    Object.values(SKILLS_MAP).forEach(skills => skillsToCopy.push(...skills));
  } else {
    if (skillsConfig.core) skillsToCopy.push(...SKILLS_MAP.core);
    if (skillsConfig.memory) skillsToCopy.push(...SKILLS_MAP.memory);
    if (skillsConfig.github) skillsToCopy.push(...SKILLS_MAP.github);
    if (skillsConfig.browser) skillsToCopy.push(...SKILLS_MAP.browser);
    if (skillsConfig.advanced) skillsToCopy.push(...SKILLS_MAP.advanced);
  }

  // Find source skills directory
  const sourceSkillsDir = findSourceDir('skills', options.sourceBaseDir);
  if (!sourceSkillsDir) {
    result.errors.push('Could not find source skills directory');
    return;
  }

  // Expand glob-style entries ('mastermind-*') against the source tree.
  // Only directories that actually contain a SKILL.md count — this also
  // filters exFAT AppleDouble junk (._mastermind-…).
  for (const entry of skillsToCopy.filter(e => e.endsWith('*'))) {
    const prefix = entry.slice(0, -1);
    skillsToCopy.splice(skillsToCopy.indexOf(entry), 1);
    skillsToCopy.push(
      ...fs.readdirSync(sourceSkillsDir).filter(n =>
        n.startsWith(prefix) &&
        fs.existsSync(path.join(sourceSkillsDir, n, 'SKILL.md'))
      )
    );
  }

  // Remove stale skill directories that a PREVIOUS init generated and this
  // version no longer ships. Entries init never wrote (user-authored skills,
  // skills installed by other tools) are left untouched — see readInitManifest.
  const knownSkills = new Set([...new Set(skillsToCopy)]);
  const priorSkills = previouslyGenerated(targetDir, 'skills');
  if (fs.existsSync(targetSkillsDir)) {
    for (const existing of fs.readdirSync(targetSkillsDir)) {
      if (!knownSkills.has(existing) && priorSkills.has(existing)) {
        const stalePath = path.join(targetSkillsDir, existing);
        fs.rmSync(stalePath, { recursive: true, force: true });
        result.created.files.push(`[cleaned] .claude/skills/${existing} (stale)`);
      }
    }
  }

  // Always copy/overwrite skills (never skip — ensures new version content lands)
  const writtenSkills: string[] = [];
  for (const skillName of knownSkills) {
    const sourcePath = path.join(sourceSkillsDir, skillName);
    const targetPath = path.join(targetSkillsDir, skillName);

    if (fs.existsSync(sourcePath)) {
      // Deliberately NOT rmSync'd first. copyDirRecursive overwrites every
      // file it ships, so wiping the directory adds nothing except destroying
      // anything the user put inside it — notes beside a shipped skill, an
      // extra command in a shipped folder. `init --force` did exactly that.
      // The cost of not wiping is that a file removed from a newer version
      // lingers; the cost of wiping is silent data loss, which is worse.
      copyDirRecursive(sourcePath, targetPath);
      writtenSkills.push(skillName);
      result.created.files.push(`.claude/skills/${skillName}`);
      result.summary.skillsCount++;
    } else {
      // A skill referenced in SKILLS_MAP has no matching source directory —
      // surface this instead of silently copying nothing, so drift between
      // SKILLS_MAP and the actual .claude/skills/ tree gets caught.
      result.errors.push(`Skill '${skillName}' listed in SKILLS_MAP has no source directory at ${sourcePath} — skipped`);
    }
  }

  // Record provenance so the next run can distinguish "we wrote this" from
  // "the user wrote this". Keep entries this run did not re-write but that a
  // previous run generated and that still exist, so provenance is not lost
  // when a section is partially skipped.
  const retainedSkills = [...priorSkills].filter(
    n => !writtenSkills.includes(n) && fs.existsSync(path.join(targetSkillsDir, n))
  );
  recordGenerated(targetDir, 'skills', [...writtenSkills, ...retainedSkills]);
}

/**
 * Copy commands from source
 */
async function copyCommands(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const commandsConfig = options.commands;
  const targetCommandsDir = path.join(targetDir, '.claude', 'commands');

  // Determine which commands to copy
  const commandsToCopy: string[] = [];

  if (commandsConfig.all) {
    Object.values(COMMANDS_MAP).forEach(cmds => commandsToCopy.push(...cmds));
  } else {
    if (commandsConfig.core) commandsToCopy.push(...COMMANDS_MAP.core);
    if (commandsConfig.agents) commandsToCopy.push(...(COMMANDS_MAP.agents || []));
    if (commandsConfig.analysis) commandsToCopy.push(...COMMANDS_MAP.analysis);
    if (commandsConfig.automation) commandsToCopy.push(...COMMANDS_MAP.automation);
    if (commandsConfig.coordination) commandsToCopy.push(...(COMMANDS_MAP.coordination || []));
    if (commandsConfig.github) commandsToCopy.push(...COMMANDS_MAP.github);
    if (commandsConfig.hiveMind) commandsToCopy.push(...(COMMANDS_MAP.hiveMind || []));
    if (commandsConfig.hooks) commandsToCopy.push(...COMMANDS_MAP.hooks);
    if (commandsConfig.mastermind) commandsToCopy.push(...(COMMANDS_MAP.mastermind || []));
    if (commandsConfig.memory) commandsToCopy.push(...(COMMANDS_MAP.memory || []));
    if (commandsConfig.monitoring) commandsToCopy.push(...COMMANDS_MAP.monitoring);
    if (commandsConfig.monograph) commandsToCopy.push(...(COMMANDS_MAP.monograph || []));
    if (commandsConfig.monomind) commandsToCopy.push(...(COMMANDS_MAP.monomind || []));
    if (commandsConfig.optimization) commandsToCopy.push(...COMMANDS_MAP.optimization);
    if (commandsConfig.pair) commandsToCopy.push(...(COMMANDS_MAP.pair || []));
    if (commandsConfig.streamChain) commandsToCopy.push(...(COMMANDS_MAP.streamChain || []));
    if (commandsConfig.swarm) commandsToCopy.push(...(COMMANDS_MAP.swarm || []));
    if (commandsConfig.training) commandsToCopy.push(...(COMMANDS_MAP.training || []));
    if (commandsConfig.truth) commandsToCopy.push(...(COMMANDS_MAP.truth || []));
    if (commandsConfig.verify) commandsToCopy.push(...(COMMANDS_MAP.verify || []));
    if (commandsConfig.workflows) commandsToCopy.push(...(COMMANDS_MAP.workflows || []));
  }

  // Find source commands directory
  const sourceCommandsDir = findSourceDir('commands', options.sourceBaseDir);
  if (!sourceCommandsDir) {
    result.errors.push('Could not find source commands directory');
    return;
  }

  // Remove stale command files/directories that a PREVIOUS init generated and
  // this version no longer ships. User-authored commands are never touched.
  const knownCommands = new Set([...new Set(commandsToCopy)]);
  const priorCommands = previouslyGenerated(targetDir, 'commands');
  if (fs.existsSync(targetCommandsDir)) {
    for (const existing of fs.readdirSync(targetCommandsDir)) {
      if (!knownCommands.has(existing) && priorCommands.has(existing)) {
        const stalePath = path.join(targetCommandsDir, existing);
        fs.rmSync(stalePath, { recursive: true, force: true });
        result.created.files.push(`[cleaned] .claude/commands/${existing} (stale)`);
      }
    }
  }

  // Always copy/overwrite commands (never skip — ensures new version content lands)
  const writtenCommands: string[] = [];
  for (const cmdName of knownCommands) {
    const sourcePath = path.join(sourceCommandsDir, cmdName);
    const targetPath = path.join(targetCommandsDir, cmdName);

    if (fs.existsSync(sourcePath)) {
      // No pre-copy rmSync — see the note in copySkills. Both branches below
      // overwrite what they ship, so wiping first only destroys files the user
      // added inside a shipped command directory.
      if (fs.statSync(sourcePath).isDirectory()) {
        copyDirRecursive(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
      writtenCommands.push(cmdName);
      result.created.files.push(`.claude/commands/${cmdName}`);
      result.summary.commandsCount++;
    }
  }

  const retainedCommands = [...priorCommands].filter(
    n => !writtenCommands.includes(n) && fs.existsSync(path.join(targetCommandsDir, n))
  );
  recordGenerated(targetDir, 'commands', [...writtenCommands, ...retainedCommands]);
}

/**
 * Copy agents from source
 */
async function copyAgents(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const agentsConfig = options.agents;
  const targetAgentsDir = path.join(targetDir, '.claude', 'agents');

  // Determine which agents to copy
  const agentsToCopy: string[] = [];

  if (agentsConfig.all) {
    Object.values(AGENTS_MAP).forEach(agents => agentsToCopy.push(...agents));
  } else {
    if (agentsConfig.core) agentsToCopy.push(...AGENTS_MAP.core);
    if (agentsConfig.consensus) agentsToCopy.push(...AGENTS_MAP.consensus);
    if (agentsConfig.github) agentsToCopy.push(...AGENTS_MAP.github);
    if (agentsConfig.hiveMind) agentsToCopy.push(...AGENTS_MAP.hiveMind);
    if (agentsConfig.swarm) agentsToCopy.push(...AGENTS_MAP.swarm);
    if (agentsConfig.optimization) agentsToCopy.push(...(AGENTS_MAP.optimization || []));
    if (agentsConfig.testing) agentsToCopy.push(...(AGENTS_MAP.testing || []));
  }

  // Find source agents directory
  const sourceAgentsDir = findSourceDir('agents', options.sourceBaseDir);
  if (!sourceAgentsDir) {
    result.errors.push('Could not find source agents directory');
    return;
  }

  // Remove stale agent category directories that a PREVIOUS init generated and
  // this version no longer ships. User-authored agent dirs are never touched.
  const knownAgents = new Set([...new Set(agentsToCopy)]);
  const priorAgents = previouslyGenerated(targetDir, 'agents');
  if (fs.existsSync(targetAgentsDir)) {
    for (const existing of fs.readdirSync(targetAgentsDir)) {
      if (!knownAgents.has(existing) && priorAgents.has(existing)) {
        const stalePath = path.join(targetAgentsDir, existing);
        fs.rmSync(stalePath, { recursive: true, force: true });
        result.created.files.push(`[cleaned] .claude/agents/${existing} (stale)`);
      }
    }
  }

  // Always copy/overwrite agents (never skip — ensures new version content lands)
  const writtenAgents: string[] = [];
  for (const agentCategory of knownAgents) {
    const sourcePath = path.join(sourceAgentsDir, agentCategory);
    const targetPath = path.join(targetAgentsDir, agentCategory);

    if (fs.existsSync(sourcePath)) {
      // Deliberately NOT rmSync'd first. copyDirRecursive overwrites every
      // file it ships, so wiping the directory adds nothing except destroying
      // anything the user put inside it — notes beside a shipped skill, an
      // extra command in a shipped folder. `init --force` did exactly that.
      // The cost of not wiping is that a file removed from a newer version
      // lingers; the cost of wiping is silent data loss, which is worse.
      copyDirRecursive(sourcePath, targetPath);
      // Count agent files (.md only — .yaml agents were migrated to .md)
      const mdFiles = countFiles(sourcePath, '.md');
      result.summary.agentsCount += mdFiles;
      writtenAgents.push(agentCategory);
      result.created.files.push(`.claude/agents/${agentCategory}`);
    }
  }

  const retainedAgents = [...priorAgents].filter(
    n => !writtenAgents.includes(n) && fs.existsSync(path.join(targetAgentsDir, n))
  );
  recordGenerated(targetDir, 'agents', [...writtenAgents, ...retainedAgents]);
}

/**
 * Find source helpers directory.
 * Validates that the directory contains hook-handler.cjs AND its required
 * subdirectory files (utils/telemetry.cjs etc.) to avoid accepting a partial
 * or corrupted source that would reproduce the missing-utils/ bug class.
 */
function findSourceHelpersDir(sourceBaseDir?: string): string | null {
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
 * Write helper scripts
 */
async function writeHelpers(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source helpers directory (works for npm package and local dev)
  const sourceHelpersDir = findSourceHelpersDir(options.sourceBaseDir);

  // Try to copy existing helpers from source first (recursive — includes utils/ and handlers/)
  if (sourceHelpersDir && fs.existsSync(sourceHelpersDir)) {
    const copyRecursive = (srcDir: string, destDir: string, relBase: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        // Skip exFAT/macOS AppleDouble junk files (e.g. "._foo.cjs").
        if (entry.name.startsWith('._')) continue;

        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath, relPath);
        } else {
          if (!fs.existsSync(destPath) || options.force) {
            fs.copyFileSync(srcPath, destPath);
            if (entry.name.endsWith('.sh') || entry.name.endsWith('.mjs')) {
              fs.chmodSync(destPath, '755');
            }
            result.created.files.push(`.claude/helpers/${relPath}`);
          } else {
            result.skipped.push(`.claude/helpers/${relPath}`);
          }
        }
      }
    };

    copyRecursive(sourceHelpersDir, helpersDir, '');
    const geminiHelpersDir = path.join(targetDir, '.gemini', 'helpers');
    copyRecursive(sourceHelpersDir, geminiHelpersDir, '');
  }

  // Always run the fallback generator too — it only fills in files still missing
  // after the source copy above (it no-ops on anything the copy already wrote).
  // Without this, a source dir that's present but incomplete (e.g. missing
  // auto-memory-hook.mjs) silently ships a project wired to hooks that reference
  // a file that was never installed.
  const helpers: Record<string, string> = Object.fromEntries(
    Object.entries(INIT_FALLBACK_HELPERS).map(([name, generate]) => [name, generate()]),
  );

  for (const [name, content] of Object.entries(helpers)) {
    const filePath = path.join(helpersDir, name);

    // If the source dir has this file, copyRecursive above already applied
    // the correct (force-aware) copy — never let this generated fallback
    // clobber it with a bare-bones stub. Only step in when source truly
    // doesn't have the file, regardless of `force`.
    const inSource = !!(sourceHelpersDir && fs.existsSync(path.join(sourceHelpersDir, name)));
    if (inSource) continue;

    if (!fs.existsSync(filePath) || options.force) {
      atomicWriteFile(filePath, content);

      // Make shell scripts executable
      if (!name.endsWith('.js')) {
        fs.chmodSync(filePath, '755');
      }

      result.created.files.push(`.claude/helpers/${name}`);
    } else {
      result.skipped.push(`.claude/helpers/${name}`);
    }
  }
}

/**
 * Find source .claude directory for statusline files
 */
function findSourceClaudeDir(sourceBaseDir?: string): string | null {
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
 * Write statusline configuration
 */
async function writeStatusline(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const claudeDir = path.join(targetDir, '.claude');
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source .claude directory (works for npm package and local dev)
  const sourceClaudeDir = findSourceClaudeDir(options.sourceBaseDir);

  // Try to copy existing advanced statusline files from source
  const advancedStatuslineFiles = [
    { src: 'statusline.sh', dest: 'statusline.sh', dir: claudeDir },
    { src: 'statusline.mjs', dest: 'statusline.mjs', dir: claudeDir },
  ];

  if (sourceClaudeDir) {
    for (const file of advancedStatuslineFiles) {
      const sourcePath = path.join(sourceClaudeDir, file.src);
      const destPath = path.join(file.dir, file.dest);

      if (fs.existsSync(sourcePath)) {
        if (!fs.existsSync(destPath) || options.force) {
          fs.copyFileSync(sourcePath, destPath);
          // Make shell scripts and mjs executable
          if (file.src.endsWith('.sh') || file.src.endsWith('.mjs')) {
            fs.chmodSync(destPath, '755');
          }
          result.created.files.push(`.claude/${file.dest}`);
        } else {
          result.skipped.push(`.claude/${file.dest}`);
        }
      }
    }
  }

  // ALWAYS generate statusline.cjs — the generated version includes
  // vectors/size, tests, ADRs, hooks, and integration stats that the
  // pre-installed static copy in the npm package lacks.
  // This must overwrite any copy from writeHelpers() which copies the legacy file.
  const statuslineScript = generateStatuslineScript(options);
  const statuslinePath = path.join(helpersDir, 'statusline.cjs');

  atomicWriteFile(statuslinePath, statuslineScript);
  result.created.files.push('.claude/helpers/statusline.cjs');
}

/**
 * Write runtime configuration (.monomind/)
 */
async function writeRuntimeConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const configPath = path.join(targetDir, '.monomind', 'config.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    result.skipped.push('.monomind/config.yaml');
    return;
  }

  const config = `# Monomind Runtime Configuration
# Generated: ${new Date().toISOString()}

version: "3.0.0"

swarm:
  topology: ${options.runtime.topology}
  maxAgents: ${options.runtime.maxAgents}
  autoScale: true
  coordinationStrategy: consensus

memory:
  backend: ${options.runtime.memoryBackend}
  enableHNSW: ${options.runtime.enableHNSW}
  persistPath: .monomind/data
  cacheSize: 100
  # ADR-049: Self-Learning Memory
  learningBridge:
    enabled: ${options.runtime.enableLearningBridge ?? options.runtime.enableNeural}
    confidenceDecayRate: 0.005
    accessBoostAmount: 0.03
    consolidationThreshold: 10
  agentScopes:
    enabled: ${options.runtime.enableAgentScopes ?? true}
    defaultScope: project

neural:
  enabled: ${options.runtime.enableNeural}
  modelPath: .monomind/neural

hooks:
  enabled: true
  autoExecute: true

mcp:
  autoStart: ${options.mcp.autoStart}
  port: ${options.mcp.port}
`;

  atomicWriteFile(configPath, config);
  result.created.files.push('.monomind/config.yaml');

  // Write .monomind/.gitignore — commit config/knowledge/metrics, exclude sensitive data
  const gitignorePath = path.join(targetDir, '.monomind', '.gitignore');
  const gitignore = `# Monomind — exclude files that may contain secrets or sensitive prompt data
# Sessions contain conversation history (prompts, code snippets, user data)
sessions/
# Security scan results may expose vulnerability details
security/
# Temporary and machine-specific files
*.tmp
*.log
daemon.pid
# Never commit credentials or keys
*.key
*.token
*.secret
.env
`;

  if (!fs.existsSync(gitignorePath) || options.force) {
    atomicWriteFile(gitignorePath, gitignore);
    result.created.files.push('.monomind/.gitignore');
  }

  // Ensure the project-level .gitignore does NOT blanket-ignore .monomind/
  // A blanket ignore prevents config, metrics, and knowledge graph from being committed.
  // We remove any bare `.monomind/` or `**/.monomind/` lines and add specific excludes instead.
  const projectGitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(projectGitignorePath) && fs.statSync(projectGitignorePath).size <= MAX_EXEC_FILE_BYTES) {
    const existing = fs.readFileSync(projectGitignorePath, 'utf-8');
    const blanketPattern = /^(\*\*\/)?\.monomind\/?\s*$/gm;
    if (blanketPattern.test(existing)) {
      const fixed = existing
        .split('\n')
        .filter(line => !/^(\*\*\/)?\.monomind\/?\s*$/.test(line))
        .join('\n');
      const specificExcludes = [
        '# monomind runtime — exclude sensitive and machine-specific data',
        '.monomind/sessions/',
        '.monomind/security/',
        '.monomind/*.tmp',
        '.monomind/*.log',
        '.monomind/daemon.pid',
        '.monomind/*.db',
        '.monomind/*.db-wal',
        '.monomind/*.db-shm',
      ].join('\n');
      atomicWriteFile(projectGitignorePath, fixed.trimEnd() + '\n' + specificExcludes + '\n');
      result.updated.push('.gitignore (replaced blanket .monomind/ ignore with specific excludes)');
    }
  }

  // Write CAPABILITIES.md with full system overview
  await writeCapabilitiesDoc(targetDir, options, result);
}

/**
 * Write initial metrics files for statusline
 * Creates baseline data so statusline shows meaningful state instead of all zeros
 */
async function writeInitialMetrics(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const metricsDir = path.join(targetDir, '.monomind', 'metrics');
  const learningDir = path.join(targetDir, '.monomind', 'learning');
  const securityDir = path.join(targetDir, '.monomind', 'security');

  // Ensure directories exist
  for (const dir of [metricsDir, learningDir, securityDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create initial v1-progress.json
  const progressPath = path.join(metricsDir, 'v1-progress.json');
  if (!fs.existsSync(progressPath) || options.force) {
    const progress = {
      version: '3.0.0',
      initialized: new Date().toISOString(),
      domains: {
        completed: 0,
        total: 5,
        status: 'INITIALIZING'
      },
      ddd: {
        progress: 0,
        modules: 0,
        totalFiles: 0,
        totalLines: 0
      },
      swarm: {
        activeAgents: 0,
        maxAgents: options.runtime.maxAgents,
        topology: options.runtime.topology
      },
      learning: {
        status: 'READY',
        patternsLearned: 0,
        sessionsCompleted: 0
      },
      _note: 'Metrics will update as you use Monomind (workers refresh at session start).'
    };
    atomicWriteFile(progressPath, JSON.stringify(progress, null, 2));
    result.created.files.push('.monomind/metrics/v1-progress.json');
  }

  // Create initial swarm-activity.json
  const activityPath = path.join(metricsDir, 'swarm-activity.json');
  if (!fs.existsSync(activityPath) || options.force) {
    const activity = {
      timestamp: new Date().toISOString(),
      processes: {
        mcp_server: 0,
        estimated_agents: 0
      },
      swarm: {
        active: false,
        agent_count: 0,
        coordination_active: false
      },
      integration: {
        mcp_active: false
      },
      _initialized: true
    };
    atomicWriteFile(activityPath, JSON.stringify(activity, null, 2));
    result.created.files.push('.monomind/metrics/swarm-activity.json');
  }

  // Create initial learning.json
  const learningPath = path.join(metricsDir, 'learning.json');
  if (!fs.existsSync(learningPath) || options.force) {
    const learning = {
      initialized: new Date().toISOString(),
      routing: {
        accuracy: 0,
        decisions: 0
      },
      patterns: {
        shortTerm: 0,
        longTerm: 0,
        quality: 0
      },
      sessions: {
        total: 0,
        current: null
      },
      _note: 'Intelligence grows as you use Monomind'
    };
    atomicWriteFile(learningPath, JSON.stringify(learning, null, 2));
    result.created.files.push('.monomind/metrics/learning.json');
  }

  // Create initial audit-status.json
  const auditPath = path.join(securityDir, 'audit-status.json');
  if (!fs.existsSync(auditPath) || options.force) {
    const audit = {
      initialized: new Date().toISOString(),
      status: 'PENDING',
      cvesFixed: 0,
      totalCves: 3,
      lastScan: null,
      _note: 'Run: npx monomind@latest security scan'
    };
    atomicWriteFile(auditPath, JSON.stringify(audit, null, 2));
    result.created.files.push('.monomind/security/audit-status.json');
  }
}

/**
 * Write CAPABILITIES.md - comprehensive overview of all Monomind features
 */
async function writeCapabilitiesDoc(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const capabilitiesPath = path.join(targetDir, '.monomind', 'CAPABILITIES.md');

  if (fs.existsSync(capabilitiesPath) && !options.force) {
    result.skipped.push('.monomind/CAPABILITIES.md');
    return;
  }

  const hooksAvailable = _isOptionalPackageResolvable('@monoes/hooks');

  const capabilities = `# Monomind - Complete Capabilities Reference
> Generated: ${new Date().toISOString()}
> Full documentation: https://github.com/monoes/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Swarm Orchestration](#swarm-orchestration)
3. [Available Agents (60+)](#available-agents)
4. [CLI Commands](#cli-commands)
5. [Hooks System (29 Hook Subcommands + 15 Background Workers)](#hooks-system)
6. [Memory & Intelligence](#memory--intelligence)
7. [Hive-Mind Consensus](#hive-mind-consensus)
8. [Performance Targets](#performance-targets)
9. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Swarm Coordination** with hierarchical and mesh topologies
- **ANN Vector Search** - indexed pattern retrieval via SQLite (better-sqlite3, sql.js WASM fallback)
- **Keyword Routing** - deterministic task→agent routing with outcome measurement
- **Byzantine Fault Tolerance** - Queen-led consensus mechanisms
- **MCP Server Integration** - Model Context Protocol support

### Current Configuration
| Setting | Value |
|---------|-------|
| Topology | ${options.runtime.topology} |
| Max Agents | ${options.runtime.maxAgents} |
| Memory Backend | ${options.runtime.memoryBackend} |
| HNSW Indexing | ${options.runtime.enableHNSW ? 'Enabled' : 'Disabled'} |
| Neural Learning | ${options.runtime.enableNeural ? 'Enabled' : 'Disabled'} |
| Learning | ${options.runtime.enableLearningBridge ? 'Enabled' : 'Disabled'} |
| Agent Scopes | ${options.runtime.enableAgentScopes ? 'Enabled (project/local/user)' : 'Disabled'} |

---

## Swarm Orchestration

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Queen controls workers directly | Anti-drift, tight control |
| \`mesh\` | Fully connected peer network | Distributed tasks |
| \`hierarchical-mesh\` | V1 hybrid (recommended) | 10+ agents |
| \`ring\` | Circular communication | Sequential workflows |
| \`star\` | Central coordinator | Simple coordination |
| \`adaptive\` | Dynamic based on load | Variable workloads |

### Strategies
- \`balanced\` - Even distribution across agents
- \`specialized\` - Clear roles, no overlap (anti-drift)
- \`adaptive\` - Dynamic task routing

### Quick Commands
\`\`\`bash
# Initialize swarm
npx monomind@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check status
npx monomind@latest swarm status

# Monitor activity
npx monomind@latest swarm monitor
\`\`\`

---

## Available Agents

### Core Development (5)
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### V1 Specialized (4)
\`security-architect\`, \`security-auditor\`, \`memory-specialist\`, \`performance-engineer\`

### Swarm Coordination (5)
\`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`, \`collective-intelligence-coordinator\`, \`swarm-memory-manager\`

### Consensus & Distributed (7)
\`byzantine-coordinator\`, \`raft-manager\`, \`gossip-coordinator\`, \`consensus-builder\`, \`crdt-synchronizer\`, \`quorum-manager\`, \`security-manager\`

### Performance & Optimization (5)
\`perf-analyzer\`, \`performance-benchmarker\`, \`task-orchestrator\`, \`memory-coordinator\`, \`smart-agent\`

### GitHub & Repository (9)
\`github-modes\`, \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`, \`workflow-automation\`, \`project-board-sync\`, \`repo-architect\`, \`multi-repo-swarm\`

### Specialized Development (8)
\`backend-dev\`, \`mobile-dev\`, \`ml-developer\`, \`cicd-engineer\`, \`api-docs\`, \`system-architect\`, \`code-analyzer\`, \`base-template-generator\`

### Testing & Validation (2)
\`tdd-london-swarm\`, \`production-validator\`

### Agent Routing by Task
| Task Type | Recommended Agents | Topology |
|-----------|-------------------|----------|
| Bug Fix | researcher, coder, tester | mesh |
| New Feature | coordinator, architect, coder, tester, reviewer | hierarchical |
| Refactoring | architect, coder, reviewer | mesh |
| Performance | researcher, perf-engineer, coder | hierarchical |
| Security | security-architect, auditor, reviewer | hierarchical |
| Docs | researcher, api-docs | mesh |

---

## CLI Commands

### Core Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | 5 | Project initialization |
| \`agent\` | 7 | Agent lifecycle management |
| \`swarm\` | 6 | Multi-agent coordination |
| \`memory\` | 12 | SQLite with ANN vector search |
| \`mcp\` | 9 | MCP server management |
| \`task\` | 5 | Task assignment |
| \`session\` | 6 | Session persistence |
| \`config\` | 7 | Configuration |
| \`status\` | 3 | System monitoring |
| \`hooks\` | 29 | Self-learning hooks + 15 background workers${hooksAvailable ? '' : ' (background workers unavailable in this install)'} |

> Note: there is no \`hive-mind\`, \`workflow\`, \`neural\`, \`embeddings\`, \`claims\`, \`migrate\`, or \`process\` CLI command.
> Hive-Mind consensus (byzantine/raft/quorum) is available exclusively via MCP tools, not the CLI.
> Neural pattern learning was merged into \`hooks intelligence\`.

### Advanced Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`security\` | 6 | Security scanning |
| \`performance\` | 4 | Profiling & benchmarks |
| \`providers\` | 4 | AI provider config |
| \`guidance\` | 1 | Governance gate setup |
| \`doctor\` | 1 | Health diagnostics |
| \`completions\` | 4 | Shell completions |

### Example Commands
\`\`\`bash
# Initialize
npx monomind@latest init --wizard

# Spawn agent
npx monomind@latest agent spawn -t coder --name my-coder

# Memory operations
npx monomind@latest memory store --key "pattern" --value "data" --namespace patterns
npx monomind@latest memory search --query "authentication"

# Diagnostics
npx monomind@latest doctor --fix
\`\`\`

---

## Hooks System

### 29 Available Hook Subcommands${hooksAvailable ? '' : ' — background workers unavailable in this install (@monoes/hooks did not resolve)'}

#### Core Hooks (6)
| Hook | Description |
|------|-------------|
| \`pre-edit\` | Context before file edits |
| \`post-edit\` | Record edit outcomes |
| \`pre-command\` | Risk assessment |
| \`post-command\` | Command metrics |
| \`pre-task\` | Task start + agent suggestions |
| \`post-task\` | Task completion learning |

#### Session Hooks (4)
| Hook | Description |
|------|-------------|
| \`session-start\` | Start/restore session |
| \`session-end\` | Persist state |
| \`session-restore\` | Restore previous |
| \`notify\` | Cross-agent notifications |

#### Intelligence Hooks (5)
| Hook | Description |
|------|-------------|
| \`route\` | Optimal agent routing |
| \`explain\` | Routing decisions |
| \`pretrain\` | Bootstrap intelligence |
| \`build-agents\` | Generate configs |
| \`transfer\` | Pattern transfer |

#### Coverage Hooks (3)
| Hook | Description |
|------|-------------|
| \`coverage-route\` | Coverage-based routing |
| \`coverage-suggest\` | Improvement suggestions |
| \`coverage-gaps\` | Gap analysis |

### 15 Background Workers (@monoes/hooks, run in-process)
| Worker | Priority | Purpose |
|--------|----------|---------|
| \`performance\` | normal | Benchmark performance |
| \`health\` | high | System health monitoring |
| \`swarm\` | high | Swarm activity monitoring |
| \`git\` | normal | Branch/change tracking |
| \`learning\` | normal | Learning optimization |
| \`adr\` | low | ADR compliance |
| \`ddd\` | low | DDD progress |
| \`security\` | high | Secret/vulnerability scan |
| \`patterns\` | normal | Pattern consolidation |
| \`cache\` | background | Cache cleanup |
| \`progress\` | normal | Progress tracking |
| \`map\` | normal | Codebase mapping |
| \`audit\` | high | Security audit metrics |
| \`optimize\` | normal | Performance snapshot |
| \`consolidate\` | low | Memory consolidation |

Metrics-producing workers (ddd, map, audit, optimize, consolidate) refresh at
session start when their output is >6h old; run on demand with
\`monomind hooks worker run <name>\`.

---

## Memory & Intelligence

### Intelligence System
- **Keyword routing**: Deterministic task→agent routing with outcome measurement
- **ANN pattern search**: Indexed vector search via SQLite
- **ReasoningBank**: Stores learned patterns and trajectories for retrieval
- **Int8 Quantization**: ~4x memory reduction for stored embeddings

Routing and learning are JS-only — no native neural engine is required. Route
and command outcomes are recorded and scored so routing quality is measured.

### Self-Learning Memory (ADR-049)

| Component | Status | Description |
|-----------|--------|-------------|
| **Learning** | ${options.runtime.enableLearningBridge ? '✅ Enabled' : '⏸ Disabled'} | Connects insights to the pattern store |
| **AgentMemoryScope** | ${options.runtime.enableAgentScopes ? '✅ Enabled' : '⏸ Disabled'} | 3-scope agent memory (project/local/user) |

**Learning** — Insights trigger learning trajectories. Confidence evolves: +0.03 on access, -0.005/hour decay.

**AgentMemoryScope** - Maps Claude Code 3-scope directories:
- \`project\`: \`<gitRoot>/.claude/agent-memory/<agent>/\`
- \`local\`: \`<gitRoot>/.claude/agent-memory-local/<agent>/\`
- \`user\`: \`~/.claude/agent-memory/<agent>/\`

High-confidence insights (>0.8) can transfer between agents.

### Memory Commands
\`\`\`bash
# Store pattern
npx monomind@latest memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx monomind@latest memory search --query "authentication"

# List entries
npx monomind@latest memory list --namespace patterns

# Initialize database
npx monomind@latest memory init --force
\`\`\`

---

## Hive-Mind Consensus

> **Experimental, MCP-only.** There is no \`hive-mind\` CLI command — this is
> single-process vote counting exposed exclusively via MCP tools
> (\`hive-mind-tools.ts\`), not distributed networking. Reach it through the
> MCP server (\`npx monomind@latest mcp start\`) once connected to an MCP client.

### Queen Types
| Type | Role |
|------|------|
| Strategic Queen | Long-term planning |
| Tactical Queen | Execution coordination |
| Adaptive Queen | Dynamic optimization |

### Worker Types (8)
\`researcher\`, \`coder\`, \`analyst\`, \`tester\`, \`architect\`, \`reviewer\`, \`optimizer\`, \`documenter\`

### Consensus Mechanisms
| Mechanism | Fault Tolerance | Status |
|-----------|-----------------|--------|
| \`byzantine\` / \`bft\` | f < n/3 faulty | Implemented (vote counting) |
| \`raft\` | f < n/2 failed | Implemented (vote counting) |
| \`quorum\` | Configurable | Implemented |
| \`gossip\` | Eventually consistent | Planned — not implemented, rejected by \`hive_mind_init\` |
| \`crdt\` | Conflict-free | Planned — not implemented, rejected by \`hive_mind_init\` |

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| ANN Search | Indexed vector search | ✅ Implemented (SQLite) |
| Memory Reduction | 50-75% | ✅ Implemented (~4x via Int8 quantization) |
| Pattern Learning | Recorded + retrievable | ✅ Implemented (ReasoningBank) |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |
| Graph Build (1k) | <200ms | ✅ 2.78ms (71.9x headroom) |
| PageRank (1k) | <100ms | ✅ 12.21ms (8.2x headroom) |
| Insight Recording | <5ms/each | ✅ 0.12ms (41x headroom) |
| Consolidation | <500ms | ✅ 0.26ms (1,955x headroom) |
| Knowledge Transfer | <100ms | ✅ 1.25ms (80x headroom) |

---

## Integration Ecosystem

### Integrated Packages
| Package | Version | Purpose |
|---------|---------|---------|
| better-sqlite3 (sql.js WASM fallback) | latest | SQLite vector database (ANN search) |

### Optional Integrations
| Package | Command |
|---------|---------|
| agentic-jujutsu | \`npx agentic-jujutsu@latest\` |

### MCP Server Setup
\`\`\`bash
# Add Monomind MCP
claude mcp add monomind -- npx -y monomind@latest mcp start
\`\`\`

---

## Quick Reference

### Essential Commands
\`\`\`bash
# Setup
npx monomind@latest init --wizard
npx monomind@latest doctor --fix

# Swarm
npx monomind@latest swarm init --topology hierarchical --max-agents 8
npx monomind@latest swarm status

# Agents
npx monomind@latest agent spawn -t coder
npx monomind@latest agent list

# Memory
npx monomind@latest memory search --query "patterns"

# Hooks
npx monomind@latest hooks pre-task --description "task"
npx monomind@latest hooks worker run optimize
\`\`\`

### File Structure
\`\`\`
.monomind/
├── config.yaml      # Runtime configuration
├── CAPABILITIES.md  # This file
├── data/            # Memory storage
├── logs/            # Operation logs
├── sessions/        # Session state
├── hooks/           # Custom hooks
├── agents/          # Agent configs
└── workflows/       # Workflow templates
\`\`\`

---

**Full Documentation**: https://github.com/monoes/monomind
**Issues**: https://github.com/monoes/monomind/issues
`;

  atomicWriteFile(capabilitiesPath, capabilities);
  result.created.files.push('.monomind/CAPABILITIES.md');
}

/**
 * Write CLAUDE.md with swarm guidance
 */
async function writeClaudeMd(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath) && !options.force) {
    result.skipped.push('CLAUDE.md');
  } else {
    // Determine template: explicit option > infer from components > 'standard'
    const inferredTemplate = (!options.components.commands && !options.components.agents) ? 'minimal' : undefined;
    const content = generateClaudeMd(options, inferredTemplate);

    atomicWriteFile(claudeMdPath, content);
    result.created.files.push('CLAUDE.md');
  }

  // Also write/append global ~/.claude/CLAUDE.md so monomind tools are used automatically (#1497)
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir) {
    const globalClaudeDir = path.join(homeDir, '.claude');
    const globalClaudeMd = path.join(globalClaudeDir, 'CLAUDE.md');
    const monomindBlock = [
      '',
      '# Monomind Integration (auto-generated by monomind init)',
      'When working on multi-file tasks or complex features, use ToolSearch to find and invoke monomind MCP tools.',
      'Key tools: memory_store, memory_search, hooks_route, swarm_init, agent_spawn.',
      '**Code navigation**: ALWAYS call `mcp__monomind__monograph_query` BEFORE grep/rg/find for code exploration — it returns file path + line number from a pre-built knowledge graph. Call `mcp__monomind__monograph_suggest` with a task description for multi-file tasks. Only fall back to grep if monograph returns 0 results or the DB is not built.',
      'Check system-reminder tags for [INTELLIGENCE] pattern suggestions and [MONOGRAPH] context before starting work.',
      '',
    ].join('\n');

    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      if (fs.existsSync(globalClaudeMd) && fs.statSync(globalClaudeMd).size <= MAX_EXEC_FILE_BYTES) {
        const existing = fs.readFileSync(globalClaudeMd, 'utf-8');
        if (!existing.includes('Monomind Integration')) {
          fs.appendFileSync(globalClaudeMd, monomindBlock);
          result.created.files.push('~/.claude/CLAUDE.md (appended monomind block)');
        } else if (!existing.includes('monograph_query')) {
          // Upgrade existing block to include monograph instructions
          const updated = existing.replace(
            /# Monomind Integration[^\n]*\n(?:(?!^#).+\n)*/m,
            monomindBlock.trimStart() + '\n',
          );
          atomicWriteFile(globalClaudeMd, updated);
          result.created.files.push('~/.claude/CLAUDE.md (upgraded monomind block)');
        }
      } else {
        atomicWriteFile(globalClaudeMd, monomindBlock.trimStart());
        result.created.files.push('~/.claude/CLAUDE.md');
      }
    } catch (e) {
      // Non-critical — global CLAUDE.md is best-effort
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeClaudeMd] failed to write/append ~/.claude/CLAUDE.md:', e);
    }

    // Also inject the token-display hook into ~/.claude/settings.json
    const globalSettingsPath = path.join(globalClaudeDir, 'settings.json');
    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      let globalSettings: Record<string, unknown> = {};
      if (fs.existsSync(globalSettingsPath) && fs.statSync(globalSettingsPath).size <= MAX_EXEC_FILE_BYTES) {
        try {
          globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf-8'));
        } catch (e) {
          // malformed JSON — start fresh
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeClaudeMd] ~/.claude/settings.json unparseable, starting fresh:', e);
        }
      }

      // Inject SessionStart token hook if not already present
      const hooks = (globalSettings.hooks as Record<string, unknown[]> | undefined) ?? {};
      const sessionStartHooks = (hooks['SessionStart'] as Array<{ hooks: Array<{ type?: string; command?: string; timeout?: number }> }> | undefined) ?? [];
      const tokenHookCommand = 'npx --yes monomind@latest tokens today';
      const alreadyPresent = sessionStartHooks.some(entry =>
        Array.isArray(entry.hooks) && entry.hooks.some(h => h.command === tokenHookCommand)
      );

      if (!alreadyPresent) {
        sessionStartHooks.push({
          hooks: [{ type: 'command', command: tokenHookCommand, timeout: 10000 }],
        });
        hooks['SessionStart'] = sessionStartHooks;
        globalSettings.hooks = hooks;
        atomicWriteFile(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
        result.created.files.push('~/.claude/settings.json (added token hook)');
      }
    } catch (e) {
      // Non-critical — global settings hook is best-effort
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeClaudeMd] failed to inject token hook into ~/.claude/settings.json:', e);
    }
  }
}

/**
 * Write Antigravity (agy) integration files:
 *   GEMINI.md                       — agent instructions read by agy
 *   .gemini/rules/monomind.md       — workflow rules file
 *   .gemini/helpers/statusline.sh   — shell wrapper for the agy status bar
 *   .gemini/settings.json           — wires the statusline command into agy
 */
async function writeGeminiFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  // GEMINI.md
  const geminiMdPath = path.join(targetDir, 'GEMINI.md');
  if (!fs.existsSync(geminiMdPath) || options.force) {
    atomicWriteFile(geminiMdPath, generateGeminiMd(options));
    result.created.files.push('GEMINI.md');
  } else {
    result.skipped.push('GEMINI.md');
  }

  // .gemini/rules/monomind.md
  const geminiRulesDir = path.join(targetDir, '.gemini', 'rules');
  fs.mkdirSync(geminiRulesDir, { recursive: true });
  const rulesPath = path.join(geminiRulesDir, 'monomind.md');
  if (!fs.existsSync(rulesPath) || options.force) {
    atomicWriteFile(rulesPath, generateGeminiRulesMd(options));
    result.created.files.push('.gemini/rules/monomind.md');
  } else {
    result.skipped.push('.gemini/rules/monomind.md');
  }

  // .gemini/helpers/statusline.sh
  const geminiHelpersDir = path.join(targetDir, '.gemini', 'helpers');
  fs.mkdirSync(geminiHelpersDir, { recursive: true });
  const statuslineShPath = path.join(geminiHelpersDir, 'statusline.sh');
  if (!fs.existsSync(statuslineShPath) || options.force) {
    atomicWriteFile(statuslineShPath, generateStatuslineSh());
    try { fs.chmodSync(statuslineShPath, 0o755); } catch { /* ignore on Windows */ }
    result.created.files.push('.gemini/helpers/statusline.sh');
  } else {
    result.skipped.push('.gemini/helpers/statusline.sh');
  }

  // .gemini/settings.json — only write if not already present (user may have
  // their own agy settings; never clobber on force either — we only add to it)
  const geminiSettingsPath = path.join(targetDir, '.gemini', 'settings.json');
  try {
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(geminiSettingsPath) && fs.statSync(geminiSettingsPath).size <= MAX_EXEC_FILE_BYTES) {
      existing = JSON.parse(fs.readFileSync(geminiSettingsPath, 'utf-8'));
    }
    if (!existing.statusLine) {
      existing.statusLine = { type: 'command', command: '.gemini/helpers/statusline.sh' };
      atomicWriteFile(geminiSettingsPath, JSON.stringify(existing, null, 2));
      result.created.files.push('.gemini/settings.json (statusLine wired)');
    } else {
      result.skipped.push('.gemini/settings.json (statusLine already configured)');
    }
  } catch (e) {
    result.errors.push(`writeGeminiFiles: failed to write .gemini/settings.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Also update the global ~/.gemini/antigravity-cli/settings.json (best-effort)
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir) {
    const globalAgyDir = path.join(homeDir, '.gemini', 'antigravity-cli');
    const globalAgySettings = path.join(globalAgyDir, 'settings.json');
    const globalStatuslineSh = path.join(globalAgyDir, 'statusline.sh');
    try {
      // Only touch the global config when it already exists — i.e. the user
      // actually runs agy. Creating the directory for non-agy users would be
      // init mutating state outside the project for no benefit.
      if (fs.existsSync(globalAgyDir)) {
      // Write/overwrite the global statusline wrapper
      if (!fs.existsSync(globalStatuslineSh) || options.force) {
        atomicWriteFile(globalStatuslineSh, generateStatuslineSh());
        try { fs.chmodSync(globalStatuslineSh, 0o755); } catch { /* ignore */ }
        result.created.files.push('~/.gemini/antigravity-cli/statusline.sh');
      }
      // Inject statusLine into global agy settings without clobbering existing keys
      let globalSettings: Record<string, unknown> = {};
      if (fs.existsSync(globalAgySettings) && fs.statSync(globalAgySettings).size <= MAX_EXEC_FILE_BYTES) {
        try { globalSettings = JSON.parse(fs.readFileSync(globalAgySettings, 'utf-8')); } catch { /* reset */ }
      }
      if (!globalSettings.statusLine) {
        globalSettings.statusLine = {
          type: 'command',
          command: `${globalAgyDir}/statusline.sh`,
        };
        atomicWriteFile(globalAgySettings, JSON.stringify(globalSettings, null, 2));
        result.created.files.push('~/.gemini/antigravity-cli/settings.json (statusLine wired)');
      }
      }
    } catch (e) {
      // Non-critical — global agy settings is best-effort
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
        console.error('[writeGeminiFiles] failed to update global agy settings:', e);
      }
    }
  }
}

/**
 * Write opencode artifacts. ADDITIVE — only invoked when
 * `components.opencode` is set. Never touches .claude/ or .gemini/.
 *
 * Tier 1: opencode.json (MCP server + permissions + instructions).
 * Tier 2 (added next): AGENTS.md + .opencode/{agent,command,skills}/ converted
 * from the Claude tree.
 */
async function writeOpencodeFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  // opencode.json — write only if absent (or --force). Never clobber a user's
  // hand-written config; mirror writeGeminiFiles' skip-if-exists policy.
  const opencodeJsonPath = path.join(targetDir, 'opencode.json');
  if (!fs.existsSync(opencodeJsonPath) || options.force) {
    atomicWriteFile(opencodeJsonPath, generateOpencodeJson(options));
    result.created.files.push('opencode.json');
  } else {
    result.skipped.push('opencode.json');
  }

  // AGENTS.md — opencode's instructions file (CLAUDE.md equivalent).
  const agentsMdPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath) || options.force) {
    atomicWriteFile(agentsMdPath, generateAgentsMd());
    result.created.files.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md');
  }

  // Hook-shim plugin (Tier 3) — bridges monomind's gate handlers into
  // opencode's tool.execute.before. .opencode/plugins/ (plural) per opencode docs.
  const pluginDir = path.join(targetDir, '.opencode', 'plugins');
  const pluginPath = path.join(pluginDir, 'monomind-hooks.ts');
  if (!fs.existsSync(pluginPath) || options.force) {
    fs.mkdirSync(pluginDir, { recursive: true });
    atomicWriteFile(pluginPath, generateHooksPlugin());
    result.created.files.push('.opencode/plugins/monomind-hooks.ts');
  } else {
    result.skipped.push('.opencode/plugins/monomind-hooks.ts');
  }

  // /monomind-status command — the opencode equivalent of the Claude Code
  // statusline (opencode has no custom statusbar UI). Runs statusline.cjs
  // unchanged and reports a formatted summary.
  const statusCmdPath = path.join(targetDir, '.opencode', 'command', 'monomind-status.md');
  if (!fs.existsSync(statusCmdPath) || options.force) {
    fs.mkdirSync(path.dirname(statusCmdPath), { recursive: true });
    atomicWriteFile(statusCmdPath, generateStatusCommand());
    result.created.files.push('.opencode/command/monomind-status.md');
  } else {
    result.skipped.push('.opencode/command/monomind-status.md');
  }

  // Convert the .claude/{agents,commands,skills} tree that copyAgents/Skills/
  // Commands just wrote into opencode shape. Reading from the target .claude/
  // dir (not the package source) means only the user's selected subset is
  // converted, and we never re-implement the MAP filtering logic.
  const claudeDir = path.join(targetDir, '.claude');
  let agentCount = 0, commandCount = 0, skillCount = 0;
  const seenAgents = new Set<string>();

  // Agents → .opencode/agent/<name>.md (flattened, deduped by name)
  const srcAgents = path.join(claudeDir, 'agents');
  if (fs.existsSync(srcAgents)) {
    const destAgents = path.join(targetDir, '.opencode', 'agent');
    for (const rel of walkMdFiles(srcAgents)) {
      const abs = path.join(srcAgents, rel);
      if (!isLikelyUserFile(rel)) continue; // skip READMEs etc.
      const src = fs.readFileSync(abs, 'utf-8');
      const fallback = path.basename(rel, '.md');
      const converted = convertAgentMd(src, fallback);
      const name = extractFmName(converted) || fallback;
      if (seenAgents.has(name)) continue;
      seenAgents.add(name);
      fs.mkdirSync(destAgents, { recursive: true });
      atomicWriteFile(path.join(destAgents, `${name}.md`), converted);
      agentCount++;
    }
  }

  // Commands → .opencode/command/<category>-<name>.md (namespace preserved)
  const srcCommands = path.join(claudeDir, 'commands');
  if (fs.existsSync(srcCommands)) {
    const destCommands = path.join(targetDir, '.opencode', 'command');
    for (const rel of walkMdFiles(srcCommands)) {
      const abs = path.join(srcCommands, rel);
      if (!isLikelyUserFile(rel)) continue;
      const segs = rel.split(path.sep);
      const category = segs.length > 1 ? segs[0] : 'monomind';
      const fileBase = path.basename(rel, '.md');
      const src = fs.readFileSync(abs, 'utf-8');
      const converted = convertCommandMd(src, category, fileBase);
      fs.mkdirSync(destCommands, { recursive: true });
      atomicWriteFile(path.join(destCommands, opencodeCommandFilename(category, fileBase)), converted);
      commandCount++;
    }
  }

  // Skills → .opencode/skills/<name>/SKILL.md (same shape)
  const srcSkills = path.join(claudeDir, 'skills');
  if (fs.existsSync(srcSkills)) {
    for (const rel of walkMdFiles(srcSkills)) {
      // rel looks like "<skillName>/SKILL.md"
      const segs = rel.split(path.sep);
      if (segs.length < 2 || segs[segs.length - 1] !== 'SKILL.md') continue;
      const skillName = segs[0];
      const abs = path.join(srcSkills, rel);
      const src = fs.readFileSync(abs, 'utf-8');
      const converted = convertSkillMd(src, skillName);
      const destDir = path.join(targetDir, '.opencode', 'skills', skillName);
      fs.mkdirSync(destDir, { recursive: true });
      atomicWriteFile(path.join(destDir, 'SKILL.md'), converted);
      skillCount++;
    }
  }

  if (agentCount) result.created.files.push(`.opencode/agent/ (${agentCount} agents)`);
  if (commandCount) result.created.files.push(`.opencode/command/ (${commandCount} commands)`);
  if (skillCount) result.created.files.push(`.opencode/skills/ (${skillCount} skills)`);
}

/**
 * Write Kimi Code artifacts. ADDITIVE — only invoked when
 * `components.kimicode` is set. Never touches .claude/, .gemini/, .opencode/.
 *
 * Tier 1: .kimi-code/mcp.json (merged, never clobbered), AGENTS.md (skip-if-exists),
 *         .kimi-code/{agents,skills}/ converted from the Claude tree.
 * Tier 2: .kimi-code/plugin/hooks/monomind-gate.mjs — stdin/exit-code bridge into
 *         the existing .claude/helpers gate handlers (kimi has no project-level
 *         hooks, so enforcement only activates via the Tier 3 plugin).
 * Tier 3: .kimi-code/plugin/kimi.plugin.json + commands/ — installable via
 *         `/plugins install ./.kimi-code/plugin` for /monomind:* slash commands
 *         and auto-wired hooks.
 */
async function writeKimiFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const kimiDir = path.join(targetDir, '.kimi-code');

  // .kimi-code/mcp.json — MERGE the monomind server into an existing file;
  // never clobber the user's other servers. Even --force merges (it refreshes
  // the monomind entry only) — a full overwrite would destroy unrelated
  // servers the user configured. Unparseable existing file → skip.
  const mcpJsonPath = path.join(kimiDir, 'mcp.json');
  if (!fs.existsSync(mcpJsonPath)) {
    fs.mkdirSync(kimiDir, { recursive: true });
    atomicWriteFile(mcpJsonPath, generateKimiMcpJson(options));
    result.created.files.push('.kimi-code/mcp.json');
  } else {
    const current = fs.readFileSync(mcpJsonPath, 'utf-8');
    const merged = mergeKimiMcpJson(current, options);
    if (merged === null) {
      result.skipped.push('.kimi-code/mcp.json (unparseable — not touched)');
    } else if (merged !== current) {
      atomicWriteFile(mcpJsonPath, merged);
      result.updated.push('.kimi-code/mcp.json (merged monomind server)');
    } else {
      result.skipped.push('.kimi-code/mcp.json');
    }
  }

  // AGENTS.md — kimi's workspace instructions file. Skip-if-exists, ALWAYS:
  // the opencode target or a hand-written file may already provide one, and
  // under --force the two generators would otherwise flip the file depending
  // on write order. Users who want regeneration delete the file first —
  // same never-clobber spirit as the mcp.json merge above.
  const agentsMdPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath)) {
    atomicWriteFile(agentsMdPath, generateKimiAgentsMd());
    result.created.files.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md');
  }

  // Convert the .claude/{agents,commands,skills} tree that copyAgents/Skills/
  // Commands just wrote into kimi shape — same approach as writeOpencodeFiles:
  // reading from the target .claude/ dir means only the user's selected subset
  // is converted.
  const claudeDir = path.join(targetDir, '.claude');
  let agentCount = 0, commandCount = 0, skillCount = 0;
  const seenAgents = new Set<string>();

  // Agents → .kimi-code/agents/<name>.md (flattened, deduped by name)
  const srcAgents = path.join(claudeDir, 'agents');
  if (fs.existsSync(srcAgents)) {
    const destAgents = path.join(kimiDir, 'agents');
    for (const rel of walkMdFiles(srcAgents)) {
      const abs = path.join(srcAgents, rel);
      if (!isLikelyUserFile(rel)) continue;
      const src = fs.readFileSync(abs, 'utf-8');
      const fallback = path.basename(rel, '.md');
      const converted = convertKimiAgentMd(src, fallback);
      const name = extractFmName(converted) || fallback;
      if (seenAgents.has(name)) continue;
      seenAgents.add(name);
      fs.mkdirSync(destAgents, { recursive: true });
      atomicWriteFile(path.join(destAgents, `${name}.md`), converted);
      agentCount++;
    }
  }

  // Skills → .kimi-code/skills/<name>/SKILL.md (same shape).
  // Track the directory names written here so command flow-skills below never
  // overwrite a REAL skill that happens to share the <category>-<name> slug
  // (e.g. a skill dir "mastermind-debug" vs a command "mastermind/debug.md").
  const writtenSkillDirs = new Set<string>();
  const srcSkills = path.join(claudeDir, 'skills');
  if (fs.existsSync(srcSkills)) {
    for (const rel of walkMdFiles(srcSkills)) {
      const segs = rel.split(path.sep);
      if (segs.length < 2 || segs[segs.length - 1] !== 'SKILL.md') continue;
      const skillName = segs[0];
      const abs = path.join(srcSkills, rel);
      const src = fs.readFileSync(abs, 'utf-8');
      const converted = convertKimiSkillMd(src, skillName);
      const destDir = path.join(kimiDir, 'skills', skillName);
      fs.mkdirSync(destDir, { recursive: true });
      atomicWriteFile(path.join(destDir, 'SKILL.md'), converted);
      writtenSkillDirs.add(skillName);
      skillCount++;
    }
  }

  // Commands → TWO outputs from the same source pass:
  //   (a) .kimi-code/skills/<cat>-<name>/SKILL.md as type:flow skills — the only
  //       project-level invocable-command mechanism kimi has (/skill:<name>).
  //   (b) .kimi-code/plugin/commands/<cat>-<name>.md for the Tier 3 plugin
  //       (/monomind:<name> slash commands once installed).
  const srcCommands = path.join(claudeDir, 'commands');
  const pluginDir = path.join(kimiDir, 'plugin');
  // Always create plugin/commands/ — the manifest declares ./commands/ and a
  // missing path surfaces as a plugin diagnostic in kimi (e.g. --skip-claude
  // runs where no commands were converted).
  const destPluginCommands = path.join(pluginDir, 'commands');
  fs.mkdirSync(destPluginCommands, { recursive: true });
  if (fs.existsSync(srcCommands)) {
    for (const rel of walkMdFiles(srcCommands)) {
      const abs = path.join(srcCommands, rel);
      if (!isLikelyUserFile(rel)) continue;
      const segs = rel.split(path.sep);
      const category = segs.length > 1 ? segs[0] : 'monomind';
      const fileBase = path.basename(rel, '.md');
      const src = fs.readFileSync(abs, 'utf-8');

      // (a) flow skill — skipped when a real skill already owns this directory
      // name (real skills win; the plugin command below still provides the
      // command under /monomind:<name>).
      const flowSkill = convertKimiCommandToFlowSkill(src, category, fileBase);
      const flowName = extractFmName(flowSkill) || `${category}-${fileBase}`;
      if (writtenSkillDirs.has(flowName)) {
        result.skipped.push(`.kimi-code/skills/${flowName}/ (command flow-skill conflicts with a real skill — plugin command kept)`);
      } else {
        const flowDir = path.join(kimiDir, 'skills', flowName);
        fs.mkdirSync(flowDir, { recursive: true });
        atomicWriteFile(path.join(flowDir, 'SKILL.md'), flowSkill);
        writtenSkillDirs.add(flowName);
        skillCount++;
      }

      // (b) plugin command
      const pluginCmd = convertKimiPluginCommandMd(src, category, fileBase);
      fs.mkdirSync(destPluginCommands, { recursive: true });
      atomicWriteFile(path.join(destPluginCommands, kimiCommandFilename(category, fileBase)), pluginCmd);
      commandCount++;
    }
  }

  // Tier 2: hook gate bridge script.
  const hooksDir = path.join(pluginDir, 'hooks');
  const gatePath = path.join(hooksDir, 'monomind-gate.mjs');
  if (!fs.existsSync(gatePath) || options.force) {
    fs.mkdirSync(hooksDir, { recursive: true });
    atomicWriteFile(gatePath, generateKimiGateScript());
    result.created.files.push('.kimi-code/plugin/hooks/monomind-gate.mjs');
  } else {
    result.skipped.push('.kimi-code/plugin/hooks/monomind-gate.mjs');
  }

  // Tier 3: plugin manifest.
  const manifestPath = path.join(pluginDir, 'kimi.plugin.json');
  if (!fs.existsSync(manifestPath) || options.force) {
    fs.mkdirSync(pluginDir, { recursive: true });
    atomicWriteFile(manifestPath, generateKimiPluginManifest(options));
    result.created.files.push('.kimi-code/plugin/kimi.plugin.json');
  } else {
    result.skipped.push('.kimi-code/plugin/kimi.plugin.json');
  }

  if (agentCount) result.created.files.push(`.kimi-code/agents/ (${agentCount} agents)`);
  if (skillCount) result.created.files.push(`.kimi-code/skills/ (${skillCount} skills)`);
  if (commandCount) result.created.files.push(`.kimi-code/plugin/commands/ (${commandCount} commands)`);
}

/** Recursively collect .md files under dir, returned relative to dir. */
function walkMdFiles(dir: string): string[] {
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
function isLikelyUserFile(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  if (base === 'readme.md' || base === 'readme') return false;
  return true;
}

/** Pull the `name:` scalar from a frontmatter block (best-effort). */
function extractFmName(md: string): string | null {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!m) return null;
  const fm = m[0];
  const nm = fm.match(/^name\s*:\s*(.+?)\s*$/m);
  return nm ? nm[1].replace(/^["']|["']$/g, '') : null;
}

/**
 * Find source directory for skills/commands/agents
 */
function findSourceDir(type: 'skills' | 'commands' | 'agents', sourceBaseDir?: string): string | null {
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
function copyDirRecursive(src: string, dest: string): void {
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
function countFiles(dir: string, ext: string): number {
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
      // Unparseable registry — proceeding with an empty list will overwrite it below, losing previously registered projects
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
    if (fs.existsSync(marker)) { found.add(dir); return; } // don't recurse into a monomind project
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
