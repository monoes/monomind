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
  generatePreCommitHook,
  generatePostCommitHook,
  generateSessionManager,
  generateAgentRouter,
  generateMemoryHelper,
  generateHookHandler,
  generateIntelligenceStub,
  generateAutoMemoryHook,
} from './helpers-generator.js';
import { generateClaudeMd } from './claudemd-generator.js';

/**
 * Skills to copy based on configuration
 */
const SKILLS_MAP: Record<string, string[]> = {
  core: [
    'swarm-orchestration',
    'swarm-advanced',
    'swarm-coordination',
    'sparc-methodology',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'stream-chain',
    'skill-builder',
    'specialagent',
    'mastermind',
    'monodesign',
    'monomotion',
    'hive-mind-advanced',
  ],
  browser: ['agent-browser-testing'],
  agentdb: [
    'agentdb-advanced',
    'agentdb-learning',
    'agentdb-memory-patterns',
    'agentdb-optimization',
    'agentdb-vector-search',
    'reasoningbank-agentdb',
    'reasoningbank-intelligence',
  ],
  github: [
    'github-code-review',
    'github-multi-repo',
    'github-project-management',
    'github-release-management',
    'github-workflow-automation',
  ],
  advanced: [
    'agentic-integration',
    'agentic-jujutsu',
    'cli-modernization',
    'core-implementation',
    'ddd-architecture',
    'mcp-optimization',
    'memory-unification',
    'performance-analysis',
    'performance-optimization',
    'security-hardening',
  ],
};

/**
 * Commands to copy based on configuration
 */
const COMMANDS_MAP: Record<string, string[]> = {
  core: [
    'mastermind.md', 'tokens.md', 'browse.md', 'sparc.md', 'ts.md',
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
  monomind: ['monomind'],
  optimization: ['optimization'],
  pair: ['pair'],
  sparc: ['sparc'],
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
  sparc: ['sparc'],
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
/**
 * Remove legacy ruv-swarm configuration from existing project files.
 * Safe to call even if no legacy config exists.
 */
function cleanupLegacyTools(targetDir: string): string[] {
  const cleaned: string[] = [];

  // Helper to fix MCP server args: replace @monomind/cli@latest with monomind@latest
  function fixMcpArgs(servers: Record<string, any>): boolean {
    let changed = false;
    for (const name of Object.keys(servers)) {
      const srv = servers[name];
      if (Array.isArray(srv.args)) {
        srv.args = srv.args.map((a: string) => {
          if (typeof a === 'string' && a.includes('@monomind/cli@')) {
            changed = true;
            return a.replace(/@monomind\/cli@[^\s]*/g, 'monomind@latest');
          }
          return a;
        });
      }
    }
    return changed;
  }

  // Clean ruv-swarm from .mcp.json and fix old MCP package name
  const mcpJsonPath = path.join(targetDir, '.mcp.json');
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      let mcpChanged = false;
      if (mcp.mcpServers && mcp.mcpServers['ruv-swarm']) {
        delete mcp.mcpServers['ruv-swarm'];
        mcpChanged = true;
        cleaned.push('.mcp.json: removed ruv-swarm entry');
      }
      if (mcp.mcpServers && fixMcpArgs(mcp.mcpServers)) {
        mcpChanged = true;
        cleaned.push('.mcp.json: updated MCP package name to monomind@latest');
      }
      if (mcpChanged) {
        atomicWriteFile(mcpJsonPath, JSON.stringify(mcp, null, 2));
      }
    } catch { /* non-fatal */ }
  }

  // Clean ruv-swarm from .claude/settings.json hooks and fix MCP package name
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      let settingsChanged = false;

      if (raw.includes('ruv-swarm')) {
        // Remove legacy ruv-swarm hook entries from all hook arrays
        const hookKeys = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact'];
        for (const key of hookKeys) {
          if (Array.isArray(settings.hooks?.[key])) {
            const before = settings.hooks[key].length;
            settings.hooks[key] = settings.hooks[key].filter((entry: any) => {
              const str = JSON.stringify(entry);
              return !str.includes('ruv-swarm');
            });
            if (settings.hooks[key].length !== before) settingsChanged = true;
          }
        }
        if (settingsChanged) {
          cleaned.push('.claude/settings.json: removed ruv-swarm hooks');
        }
      }

      // Fix wrong MCP package name in mcpServers
      if (settings.mcpServers && fixMcpArgs(settings.mcpServers)) {
        settingsChanged = true;
        cleaned.push('.claude/settings.json: updated MCP package name to monomind@latest');
      }

      if (settingsChanged) {
        atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch { /* non-fatal */ }
  }

  return cleaned;
}

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
    // Remove legacy ruv-swarm configs before writing new ones
    const legacyCleaned = cleanupLegacyTools(targetDir);
    for (const msg of legacyCleaned) {
      result.created.files.push(`[cleaned] ${msg}`);
    }

    // Create directory structure
    await createDirectories(targetDir, options, result);

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

    // Generate .agents/shared_instructions.md + seed project memory
    writeSharedInstructions(targetDir, options.force, result);

    // Count enabled hooks
    result.summary.hooksEnabled = countEnabledHooks(options);

    // Build knowledge graph in background (non-blocking)
    if (options.components.graphify) {
      await initKnowledgeGraph(targetDir, result);
    }

    // Start daemon with background workers (non-blocking)
    await startDaemonBackground(targetDir, result);

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
 * Start the monomind daemon with background workers.
 * Non-fatal: if daemon fails to start, init continues.
 */
async function startDaemonBackground(targetDir: string, result: InitResult): Promise<void> {
  try {
    const { execSync } = await import('child_process');
    // Check if daemon is already running
    const pidFile = path.join(targetDir, '.monomind', 'daemon.pid');
    const { existsSync, readFileSync } = await import('fs');
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      try {
        process.kill(pid, 0);
        result.skipped.push('daemon: already running (PID ' + pid + ')');
        return;
      } catch { /* stale PID, continue */ }
    }

    execSync('npx monomind@latest daemon start --background', {
      cwd: targetDir,
      stdio: 'ignore',
      timeout: 15000,
    });
    result.created.files.push('monomind daemon (background workers started)');
  } catch {
    result.skipped.push('daemon: could not auto-start (run: monomind daemon start)');
  }
}

/**
 * Run doctor --install to auto-fix any remaining issues.
 * Non-fatal: best-effort health check and auto-install.
 */
async function runDoctorFix(targetDir: string, result: InitResult): Promise<void> {
  try {
    const { execSync } = await import('child_process');
    execSync('npx monomind@latest doctor --install', {
      cwd: targetDir,
      stdio: 'ignore',
      timeout: 120000,
    });
    result.created.files.push('doctor --install (health check + auto-fix)');
  } catch {
    result.skipped.push('doctor: auto-fix skipped (run: monomind doctor --install)');
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
    // Fix legacy ruv-swarm configs and old MCP package names
    const legacyCleaned = cleanupLegacyTools(targetDir);
    for (const msg of legacyCleaned) {
      result.updated.push(`[cleaned] ${msg}`);
    }

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
      // Copy top-level critical files atomically
      const criticalHelpers = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs'];
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
      const generatedCritical: Record<string, string> = {
        'hook-handler.cjs': generateHookHandler(),
        'intelligence.cjs': generateIntelligenceStub(),
        'auto-memory-hook.mjs': generateAutoMemoryHook(),
      };
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

    // 1. ALWAYS update statusline helper (force overwrite)
    const statuslinePath = path.join(targetDir, '.claude', 'helpers', 'statusline.cjs');
    // Use default options with statusline config
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
        processes: { agentic_flow: 0, mcp_server: 0, estimated_agents: 0 },
        swarm: { active: false, agent_count: 0, coordination_active: false },
        integration: { agentic_flow_active: false, mcp_active: false },
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
      if (fs.existsSync(settingsPath)) {
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

  if (fs.existsSync(settingsPath) && !options.force) {
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
    } catch {
      // Existing file is corrupt — overwrite
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
    if (skillsConfig.agentdb) skillsToCopy.push(...SKILLS_MAP.agentdb);
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

  // Remove stale skill directories no longer in the current version's map
  const knownSkills = new Set([...new Set(skillsToCopy)]);
  if (fs.existsSync(targetSkillsDir)) {
    for (const existing of fs.readdirSync(targetSkillsDir)) {
      if (!knownSkills.has(existing)) {
        const stalePath = path.join(targetSkillsDir, existing);
        fs.rmSync(stalePath, { recursive: true, force: true });
        result.created.files.push(`[cleaned] .claude/skills/${existing} (stale)`);
      }
    }
  }

  // Always copy/overwrite skills (never skip — ensures new version content lands)
  for (const skillName of knownSkills) {
    const sourcePath = path.join(sourceSkillsDir, skillName);
    const targetPath = path.join(targetSkillsDir, skillName);

    if (fs.existsSync(sourcePath)) {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      copyDirRecursive(sourcePath, targetPath);
      result.created.files.push(`.claude/skills/${skillName}`);
      result.summary.skillsCount++;
    }
  }
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
    if (commandsConfig.sparc) commandsToCopy.push(...COMMANDS_MAP.sparc);
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

  // Remove stale command files/directories no longer in the current version's map
  const knownCommands = new Set([...new Set(commandsToCopy)]);
  if (fs.existsSync(targetCommandsDir)) {
    for (const existing of fs.readdirSync(targetCommandsDir)) {
      if (!knownCommands.has(existing)) {
        const stalePath = path.join(targetCommandsDir, existing);
        fs.rmSync(stalePath, { recursive: true, force: true });
        result.created.files.push(`[cleaned] .claude/commands/${existing} (stale)`);
      }
    }
  }

  // Always copy/overwrite commands (never skip — ensures new version content lands)
  for (const cmdName of knownCommands) {
    const sourcePath = path.join(sourceCommandsDir, cmdName);
    const targetPath = path.join(targetCommandsDir, cmdName);

    if (fs.existsSync(sourcePath)) {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      if (fs.statSync(sourcePath).isDirectory()) {
        copyDirRecursive(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
      result.created.files.push(`.claude/commands/${cmdName}`);
      result.summary.commandsCount++;
    }
  }
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
    if (agentsConfig.sparc) agentsToCopy.push(...AGENTS_MAP.sparc);
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

  // Remove stale agent category directories no longer in the current version's map
  const knownAgents = new Set([...new Set(agentsToCopy)]);
  if (fs.existsSync(targetAgentsDir)) {
    for (const existing of fs.readdirSync(targetAgentsDir)) {
      if (!knownAgents.has(existing)) {
        const stalePath = path.join(targetAgentsDir, existing);
        fs.rmSync(stalePath, { recursive: true, force: true });
        result.created.files.push(`[cleaned] .claude/agents/${existing} (stale)`);
      }
    }
  }

  // Always copy/overwrite agents (never skip — ensures new version content lands)
  for (const agentCategory of knownAgents) {
    const sourcePath = path.join(sourceAgentsDir, agentCategory);
    const targetPath = path.join(targetAgentsDir, agentCategory);

    if (fs.existsSync(sourcePath)) {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      copyDirRecursive(sourcePath, targetPath);
      // Count agent files (.md only — .yaml agents were migrated to .md)
      const mdFiles = countFiles(sourcePath, '.md');
      result.summary.agentsCount += mdFiles;
      result.created.files.push(`.claude/agents/${agentCategory}`);
    }
  }
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
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgJsonPath = esmRequire.resolve('@monomind/cli/package.json');
    const pkgRoot = path.dirname(pkgJsonPath);
    possiblePaths.push(path.join(pkgRoot, '.claude', 'helpers'));
  } catch {
    // Not installed as a package — skip
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

  // Strategy 4: Check cwd-relative paths (for local dev)
  const cwdBased = [
    path.join(process.cwd(), '.claude', 'helpers'),
    path.join(process.cwd(), '..', '.claude', 'helpers'),
    path.join(process.cwd(), '..', '..', '.claude', 'helpers'),
  ];
  possiblePaths.push(...cwdBased);

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
    let copiedCount = 0;

    const copyRecursive = (srcDir: string, destDir: string, relBase: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
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
            copiedCount++;
          } else {
            result.skipped.push(`.claude/helpers/${relPath}`);
          }
        }
      }
    };

    copyRecursive(sourceHelpersDir, helpersDir, '');

    if (copiedCount > 0) {
      return; // Skip generating if we copied from source
    }
  }

  // Fall back to generating helpers if source not available
  const helpers: Record<string, string> = {
    'pre-commit': generatePreCommitHook(),
    'post-commit': generatePostCommitHook(),
    'session.cjs': generateSessionManager(),
    'router.cjs': generateAgentRouter(),
    'memory.cjs': generateMemoryHelper(),
    'hook-handler.cjs': generateHookHandler(),
    'intelligence.cjs': generateIntelligenceStub(),
    'auto-memory-hook.mjs': generateAutoMemoryHook(),
  };

  for (const [name, content] of Object.entries(helpers)) {
    const filePath = path.join(helpersDir, name);

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

  // ALWAYS generate statusline.cjs — the generated version includes AgentDB
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
    sonaMode: balanced
    confidenceDecayRate: 0.005
    accessBoostAmount: 0.03
    consolidationThreshold: 10
  memoryGraph:
    enabled: ${options.runtime.enableMemoryGraph ?? true}
    pageRankDamping: 0.85
    maxNodes: 5000
    similarityThreshold: 0.8
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
      _note: 'Metrics will update as you use Monomind. Run: npx monomind@latest daemon start'
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
        agentic_flow: 0,
        mcp_server: 0,
        estimated_agents: 0
      },
      swarm: {
        active: false,
        agent_count: 0,
        coordination_active: false
      },
      integration: {
        agentic_flow_active: false,
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

  const capabilities = `# Monomind - Complete Capabilities Reference
> Generated: ${new Date().toISOString()}
> Full documentation: https://github.com/nokhodian/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Swarm Orchestration](#swarm-orchestration)
3. [Available Agents (60+)](#available-agents)
4. [CLI Commands (26 Commands, 140+ Subcommands)](#cli-commands)
5. [Hooks System (27 Hooks + 12 Workers)](#hooks-system)
6. [Memory & Intelligence (RuVector)](#memory--intelligence)
7. [Hive-Mind Consensus](#hive-mind-consensus)
8. [Performance Targets](#performance-targets)
9. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Swarm Coordination** with hierarchical and mesh topologies
- **HNSW Vector Search** - 150x-12,500x faster pattern retrieval
- **SONA Neural Learning** - Self-optimizing with <0.05ms adaptation
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
| LearningBridge | ${options.runtime.enableLearningBridge ? 'Enabled (SONA + ReasoningBank)' : 'Disabled'} |
| Knowledge Graph | ${options.runtime.enableMemoryGraph ? 'Enabled (PageRank + Communities)' : 'Disabled'} |
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

### SPARC Methodology (6)
\`sparc-coord\`, \`sparc-coder\`, \`specification\`, \`pseudocode\`, \`architecture\`, \`refinement\`

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

### Core Commands (12)
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | 4 | Project initialization |
| \`agent\` | 8 | Agent lifecycle management |
| \`swarm\` | 6 | Multi-agent coordination |
| \`memory\` | 11 | AgentDB with HNSW search |
| \`mcp\` | 9 | MCP server management |
| \`task\` | 6 | Task assignment |
| \`session\` | 7 | Session persistence |
| \`config\` | 7 | Configuration |
| \`status\` | 3 | System monitoring |
| \`workflow\` | 6 | Workflow templates |
| \`hooks\` | 17 | Self-learning hooks |
| \`hive-mind\` | 6 | Consensus coordination |

### Advanced Commands (14)
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`daemon\` | 5 | Background workers |
| \`neural\` | 5 | Pattern training |
| \`security\` | 6 | Security scanning |
| \`performance\` | 5 | Profiling & benchmarks |
| \`providers\` | 5 | AI provider config |
| \`plugins\` | 5 | Plugin management |
| \`deployment\` | 5 | Deploy management |
| \`embeddings\` | 4 | Vector embeddings |
| \`claims\` | 4 | Authorization |
| \`migrate\` | 5 | V2→V1 migration |
| \`process\` | 4 | Process management |
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

### 27 Available Hooks

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

### 12 Background Workers
| Worker | Priority | Purpose |
|--------|----------|---------|
| \`ultralearn\` | normal | Deep knowledge |
| \`optimize\` | high | Performance |
| \`consolidate\` | low | Memory consolidation |
| \`predict\` | normal | Predictive preload |
| \`audit\` | critical | Security |
| \`map\` | normal | Codebase mapping |
| \`preload\` | low | Resource preload |
| \`deepdive\` | normal | Deep analysis |
| \`document\` | normal | Auto-docs |
| \`refactor\` | normal | Suggestions |
| \`benchmark\` | normal | Benchmarking |
| \`testgaps\` | normal | Coverage gaps |

---

## Memory & Intelligence

### RuVector Intelligence System
- **SONA**: Self-Optimizing Neural Architecture (<0.05ms)
- **MoE**: Mixture of Experts routing
- **HNSW**: 150x-12,500x faster search
- **EWC++**: Prevents catastrophic forgetting
- **Flash Attention**: 2.49x-7.47x speedup
- **Int8 Quantization**: 3.92x memory reduction

### 4-Step Intelligence Pipeline
1. **RETRIEVE** - HNSW pattern search
2. **JUDGE** - Success/failure verdicts
3. **DISTILL** - LoRA learning extraction
4. **CONSOLIDATE** - EWC++ preservation

### Self-Learning Memory (ADR-049)

| Component | Status | Description |
|-----------|--------|-------------|
| **LearningBridge** | ${options.runtime.enableLearningBridge ? '✅ Enabled' : '⏸ Disabled'} | Connects insights to SONA/ReasoningBank neural pipeline |
| **MemoryGraph** | ${options.runtime.enableMemoryGraph ? '✅ Enabled' : '⏸ Disabled'} | PageRank knowledge graph + community detection |
| **AgentMemoryScope** | ${options.runtime.enableAgentScopes ? '✅ Enabled' : '⏸ Disabled'} | 3-scope agent memory (project/local/user) |

**LearningBridge** - Insights trigger learning trajectories. Confidence evolves: +0.03 on access, -0.005/hour decay. Consolidation runs the JUDGE/DISTILL/CONSOLIDATE pipeline.

**MemoryGraph** - Builds a knowledge graph from entry references. PageRank identifies influential insights. Communities group related knowledge. Graph-aware ranking blends vector + structural scores.

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

### Queen Types
| Type | Role |
|------|------|
| Strategic Queen | Long-term planning |
| Tactical Queen | Execution coordination |
| Adaptive Queen | Dynamic optimization |

### Worker Types (8)
\`researcher\`, \`coder\`, \`analyst\`, \`tester\`, \`architect\`, \`reviewer\`, \`optimizer\`, \`documenter\`

### Consensus Mechanisms
| Mechanism | Fault Tolerance | Use Case |
|-----------|-----------------|----------|
| \`byzantine\` | f < n/3 faulty | Adversarial |
| \`raft\` | f < n/2 failed | Leader-based |
| \`gossip\` | Eventually consistent | Large scale |
| \`crdt\` | Conflict-free | Distributed |
| \`quorum\` | Configurable | Flexible |

### Hive-Mind Commands
\`\`\`bash
# Initialize
npx monomind@latest hive-mind init --queen-type strategic

# Status
npx monomind@latest hive-mind status

# Spawn workers
npx monomind@latest hive-mind spawn --count 5 --type worker

# Consensus
npx monomind@latest hive-mind consensus --propose "task"
\`\`\`

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | 150x-12,500x faster | ✅ Implemented |
| Memory Reduction | 50-75% | ✅ Implemented (3.92x) |
| SONA Integration | Pattern learning | ✅ Implemented |
| Flash Attention | 2.49x-7.47x | 🔄 In Progress |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |
| SONA Adaptation | <0.05ms | 🔄 In Progress |
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
| agentic-flow | 3.0.0-alpha.1 | Core coordination + ReasoningBank + Router |
| agentdb | 3.0.0-alpha.10 | Vector database + 8 controllers |
| @ruvector/attention | 0.1.3 | Flash attention |
| @ruvector/sona | 0.1.5 | Neural learning |

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
npx monomind@latest daemon start
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
npx monomind@latest hooks worker dispatch --trigger optimize
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

**Full Documentation**: https://github.com/nokhodian/monomind
**Issues**: https://github.com/nokhodian/monomind/issues
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
      'Check system-reminder tags for [INTELLIGENCE] pattern suggestions before starting work.',
      '',
    ].join('\n');

    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      if (fs.existsSync(globalClaudeMd)) {
        const existing = fs.readFileSync(globalClaudeMd, 'utf-8');
        if (!existing.includes('Monomind Integration')) {
          fs.appendFileSync(globalClaudeMd, monomindBlock);
          result.created.files.push('~/.claude/CLAUDE.md (appended monomind block)');
        }
      } else {
        atomicWriteFile(globalClaudeMd, monomindBlock.trimStart());
        result.created.files.push('~/.claude/CLAUDE.md');
      }
    } catch {
      // Non-critical — global CLAUDE.md is best-effort
    }

    // Also inject the token-display hook into ~/.claude/settings.json
    const globalSettingsPath = path.join(globalClaudeDir, 'settings.json');
    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      let globalSettings: Record<string, unknown> = {};
      if (fs.existsSync(globalSettingsPath)) {
        try {
          globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf-8'));
        } catch { /* malformed JSON — start fresh */ }
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
    } catch {
      // Non-critical — global settings hook is best-effort
    }
  }
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
    try { reg = JSON.parse(fs.readFileSync(registryPath, 'utf-8')); } catch {}
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
  if (fs.existsSync(registryPath)) {
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
