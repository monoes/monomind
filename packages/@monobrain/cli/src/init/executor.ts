/**
 * Init Executor
 * Main execution logic for V1 initialization
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type { InitOptions, InitResult, PlatformInfo } from './types.js';
import { detectPlatform, DEFAULT_INIT_OPTIONS } from './types.js';
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
    'sparc-methodology',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'stream-chain',
    'skill-builder',
    'specialagent',
  ],
  browser: ['browser', 'agent-browser-testing'],  // agent-browser integration
  dualMode: ['dual-mode'],  // Claude Code + Codex hybrid execution
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
  v1: [
    'v1-cli-modernization',
    'v1-core-implementation',
    'v1-ddd-architecture',
    'v1-integration-deep',
    'v1-mcp-optimization',
    'v1-memory-unification',
    'v1-performance-optimization',
    'v1-security-overhaul',
    'v1-swarm-coordination',
  ],
};

/**
 * Commands to copy based on configuration
 */
const COMMANDS_MAP: Record<string, string[]> = {
  core: ['monobrain-help.md', 'monobrain-swarm.md', 'monobrain-memory.md'],
  analysis: ['analysis'],
  automation: ['automation'],
  github: ['github'],
  hooks: ['hooks'],
  monitoring: ['monitoring'],
  optimization: ['optimization'],
  sparc: ['sparc'],
};

/**
 * Agents to copy based on configuration
 */
const AGENTS_MAP: Record<string, string[]> = {
  core: ['core'],
  consensus: ['consensus'],
  github: ['github'],
  hiveMind: ['hive-mind'],
  sparc: ['sparc'],
  swarm: ['swarm'],
  // V1-specific agents
  optimization: ['optimization'],
  templates: ['templates'],
  testing: ['testing'],
  analysis: ['analysis'],
  architecture: ['architecture'],
  development: ['development'],
  devops: ['devops'],
  documentation: ['documentation'],
  specialized: ['specialized'],
  goal: ['goal'],
  sona: ['sona'],
  payments: ['payments'],
  data: ['data'],
  custom: ['custom'],
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
    '.monobrain',
    '.monobrain/data',
    '.monobrain/logs',
    '.monobrain/sessions',
    '.monobrain/hooks',
    '.monobrain/agents',
    '.monobrain/workflows',
  ],
};

/**
 * Execute initialization
 */
/**
 * Remove legacy ruflo/ruv-swarm configuration from existing project files.
 * Safe to call even if no legacy config exists.
 */
function cleanupLegacyTools(targetDir: string): string[] {
  const cleaned: string[] = [];

  // Helper to fix MCP server args: replace @monobrain/cli@latest with monobrain@latest
  function fixMcpArgs(servers: Record<string, any>): boolean {
    let changed = false;
    for (const name of Object.keys(servers)) {
      const srv = servers[name];
      if (Array.isArray(srv.args)) {
        srv.args = srv.args.map((a: string) => {
          if (typeof a === 'string' && a.includes('@monobrain/cli@')) {
            changed = true;
            return a.replace(/@monobrain\/cli@[^\s]*/g, 'monobrain@latest');
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
        cleaned.push('.mcp.json: updated MCP package name to monobrain@latest');
      }
      if (mcpChanged) {
        fs.writeFileSync(mcpJsonPath, JSON.stringify(mcp, null, 2));
      }
    } catch { /* non-fatal */ }
  }

  // Clean ruflo / ruv-swarm from .claude/settings.json hooks and fix MCP package name
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      let settingsChanged = false;

      if (raw.includes('ruflo') || raw.includes('ruv-swarm')) {
        // Remove ruflo-referencing hook entries from all hook arrays
        const hookKeys = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact'];
        for (const key of hookKeys) {
          if (Array.isArray(settings.hooks?.[key])) {
            const before = settings.hooks[key].length;
            settings.hooks[key] = settings.hooks[key].filter((entry: any) => {
              const str = JSON.stringify(entry);
              return !str.includes('ruflo') && !str.includes('ruv-swarm');
            });
            if (settings.hooks[key].length !== before) settingsChanged = true;
          }
        }
        if (settingsChanged) {
          cleaned.push('.claude/settings.json: removed ruflo/ruv-swarm hooks');
        }
      }

      // Fix wrong MCP package name in mcpServers
      if (settings.mcpServers && fixMcpArgs(settings.mcpServers)) {
        settingsChanged = true;
        cleaned.push('.claude/settings.json: updated MCP package name to monobrain@latest');
      }

      if (settingsChanged) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
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
    // Remove legacy ruflo/ruv-swarm configs before writing new ones
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

    // Count enabled hooks
    result.summary.hooksEnabled = countEnabledHooks(options);

    // Build knowledge graph in background (non-blocking)
    if (options.components.graphify) {
      await initKnowledgeGraph(targetDir, result);
    }

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Spawn a background process to build the @monobrain/graph knowledge graph.
 * Fire-and-forget: init does not wait for the ~20s graph build to complete.
 * Non-fatal: if @monobrain/graph is unavailable the step is simply skipped.
 */
async function initKnowledgeGraph(targetDir: string, result: InitResult): Promise<void> {
  try {
    // Verify the package is resolvable before spawning — fast path to skip gracefully.
    await import('@monoes/graph');
    const outputDir = path.join(targetDir, '.monobrain', 'graph');

    const { spawn } = await import('child_process');
    // Escape single quotes in path strings for the inline ES module script.
    const safePath = targetDir.replace(/'/g, "\\'");
    const safeOut = outputDir.replace(/'/g, "\\'");
    const script = `
import('@monoes/graph').then(({ buildGraph }) =>
  buildGraph('${safePath}', { codeOnly: true, outputDir: '${safeOut}' })
).then(r => console.log('[graph] built: ' + r.filesProcessed + ' files, ' + r.analysis.stats.nodes + ' nodes'))
 .catch(e => console.error('[graph] build failed:', e.message));
`;

    const child = spawn(process.execPath, ['--input-type=module'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
      cwd: targetDir,
    });
    // Write the script to stdin then close so node processes it.
    child.stdin?.write(script);
    child.stdin?.end();
    child.unref();

    result.created.files.push('.monobrain/graph/ (knowledge graph building in background)');
  } catch (_err) {
    // Non-fatal — @monobrain/graph is an optional enhancement.
    result.skipped.push('knowledge graph: @monobrain/graph not available');
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
  // Agent Teams hook config lives in monobrain.agentTeams.hooks instead.

  // 1. Merge env vars (preserve existing, add new)
  const existingEnv = (existing.env as Record<string, string>) || {};
  merged.env = {
    ...existingEnv,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    MONOBRAIN_V1_ENABLED: existingEnv.MONOBRAIN_V1_ENABLED || 'true',
    MONOBRAIN_HOOKS_ENABLED: existingEnv.MONOBRAIN_HOOKS_ENABLED || 'true',
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
  // Their configuration lives in monobrain.agentTeams.hooks instead.

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

  // 4. Merge monobrain settings (preserve existing, add agentTeams + memory)
  const existingMonobrain = (existing.monobrain as Record<string, unknown>) || {};
  const existingMemory = (existingMonobrain.memory as Record<string, unknown>) || {};
  merged.monobrain = {
    ...existingMonobrain,
    version: existingMonobrain.version || '3.0.0',
    enabled: existingMonobrain.enabled !== false,
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
    // Fix legacy ruflo/ruv-swarm configs and old MCP package names
    const legacyCleaned = cleanupLegacyTools(targetDir);
    for (const msg of legacyCleaned) {
      result.updated.push(`[cleaned] ${msg}`);
    }

    // Ensure required directories exist
    const dirs = [
      '.claude/helpers',
      '.monobrain/metrics',
      '.monobrain/security',
      '.monobrain/learning',
    ];

    for (const dir of dirs) {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // 0. ALWAYS update critical helpers (force overwrite)
    const sourceHelpersForUpgrade = findSourceHelpersDir();
    if (sourceHelpersForUpgrade) {
      const criticalHelpers = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs'];
      for (const helperName of criticalHelpers) {
        const targetPath = path.join(targetDir, '.claude', 'helpers', helperName);
        const sourcePath = path.join(sourceHelpersForUpgrade, helperName);
        if (fs.existsSync(sourcePath)) {
          if (fs.existsSync(targetPath)) {
            result.updated.push(`.claude/helpers/${helperName}`);
          } else {
            result.created.push(`.claude/helpers/${helperName}`);
          }
          fs.copyFileSync(sourcePath, targetPath);
          try { fs.chmodSync(targetPath, '755'); } catch {}
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
        fs.writeFileSync(targetPath, content, 'utf-8');
        try { fs.chmodSync(targetPath, '755'); } catch {}
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
    fs.writeFileSync(statuslinePath, statuslineContent, 'utf-8');

    // 2. Create MISSING metrics files only (preserve existing data)
    const metricsDir = path.join(targetDir, '.monobrain', 'metrics');
    const securityDir = path.join(targetDir, '.monobrain', 'security');

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
        _note: 'Metrics will update as you use Monobrain'
      };
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
      result.created.push('.monobrain/metrics/v1-progress.json');
    } else {
      result.preserved.push('.monobrain/metrics/v1-progress.json');
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
      fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2), 'utf-8');
      result.created.push('.monobrain/metrics/swarm-activity.json');
    } else {
      result.preserved.push('.monobrain/metrics/swarm-activity.json');
    }

    // learning.json
    const learningPath = path.join(metricsDir, 'learning.json');
    if (!fs.existsSync(learningPath)) {
      const learning = {
        initialized: new Date().toISOString(),
        routing: { accuracy: 0, decisions: 0 },
        patterns: { shortTerm: 0, longTerm: 0, quality: 0 },
        sessions: { total: 0, current: null },
        _note: 'Intelligence grows as you use Monobrain'
      };
      fs.writeFileSync(learningPath, JSON.stringify(learning, null, 2), 'utf-8');
      result.created.push('.monobrain/metrics/learning.json');
    } else {
      result.preserved.push('.monobrain/metrics/learning.json');
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
        _note: 'Run: npx monobrain@latest security scan'
      };
      fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
      result.created.push('.monobrain/security/audit-status.json');
    } else {
      result.preserved.push('.monobrain/security/audit-status.json');
    }

    // 3. Merge settings if requested
    if (upgradeSettings) {
      const settingsPath = path.join(targetDir, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const mergedSettings = mergeSettingsForUpgrade(existingSettings);
          fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
          result.updated.push('.claude/settings.json');
          result.settingsUpdated = [
            'env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
            'hooks.SessionStart (auto-memory import)',
            'hooks.SessionEnd (auto-memory sync)',
            'hooks.TeammateIdle (removed — not a valid Claude Code hook)',
            'hooks.TaskCompleted (removed — not a valid Claude Code hook)',
            'monobrain.agentTeams',
            'monobrain.memory (learningBridge, memoryGraph, agentScopes)',
          ];
        } catch (settingsError) {
          result.errors.push(`Settings merge failed: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`);
        }
      } else {
        // Create new settings.json with defaults
        const defaultSettings = generateSettings(DEFAULT_INIT_OPTIONS);
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf-8');
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
    if (process.env.DEBUG || process.env.MONOBRAIN_DEBUG) {
      console.log('[DEBUG] Source directories:');
      console.log(`  Skills: ${sourceSkillsDir || 'NOT FOUND'}`);
      console.log(`  Agents: ${sourceAgentsDir || 'NOT FOUND'}`);
      console.log(`  Commands: ${sourceCommandsDir || 'NOT FOUND'}`);
    }

    // Add missing skills
    if (sourceSkillsDir) {
      const allSkills = Object.values(SKILLS_MAP).flat();
      const debugMode = process.env.DEBUG || process.env.MONOBRAIN_DEBUG;
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

      // Merge permissions (add monobrain allow rules)
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
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2), 'utf-8');
        result.created.files.push('.claude/settings.json (merged hooks)');
      } else {
        result.skipped.push('.claude/settings.json');
      }
    } catch {
      // Existing file is corrupt — overwrite
      fs.writeFileSync(settingsPath, JSON.stringify(generated, null, 2), 'utf-8');
      result.created.files.push('.claude/settings.json');
    }
    return;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(generated, null, 2), 'utf-8');
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
  fs.writeFileSync(mcpPath, content, 'utf-8');
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
    if (skillsConfig.v1) skillsToCopy.push(...SKILLS_MAP.v1);
    if (skillsConfig.dualMode) skillsToCopy.push(...SKILLS_MAP.dualMode);
  }

  // Find source skills directory
  const sourceSkillsDir = findSourceDir('skills', options.sourceBaseDir);
  if (!sourceSkillsDir) {
    result.errors.push('Could not find source skills directory');
    return;
  }

  // Copy each skill
  for (const skillName of [...new Set(skillsToCopy)]) {
    const sourcePath = path.join(sourceSkillsDir, skillName);
    const targetPath = path.join(targetSkillsDir, skillName);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        copyDirRecursive(sourcePath, targetPath);
        result.created.files.push(`.claude/skills/${skillName}`);
        result.summary.skillsCount++;
      } else {
        result.skipped.push(`.claude/skills/${skillName}`);
      }
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
    if (commandsConfig.analysis) commandsToCopy.push(...COMMANDS_MAP.analysis);
    if (commandsConfig.automation) commandsToCopy.push(...COMMANDS_MAP.automation);
    if (commandsConfig.github) commandsToCopy.push(...COMMANDS_MAP.github);
    if (commandsConfig.hooks) commandsToCopy.push(...COMMANDS_MAP.hooks);
    if (commandsConfig.monitoring) commandsToCopy.push(...COMMANDS_MAP.monitoring);
    if (commandsConfig.optimization) commandsToCopy.push(...COMMANDS_MAP.optimization);
    if (commandsConfig.sparc) commandsToCopy.push(...COMMANDS_MAP.sparc);
  }

  // Find source commands directory
  const sourceCommandsDir = findSourceDir('commands', options.sourceBaseDir);
  if (!sourceCommandsDir) {
    result.errors.push('Could not find source commands directory');
    return;
  }

  // Copy each command/directory
  for (const cmdName of [...new Set(commandsToCopy)]) {
    const sourcePath = path.join(sourceCommandsDir, cmdName);
    const targetPath = path.join(targetCommandsDir, cmdName);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        if (fs.statSync(sourcePath).isDirectory()) {
          copyDirRecursive(sourcePath, targetPath);
        } else {
          fs.copyFileSync(sourcePath, targetPath);
        }
        result.created.files.push(`.claude/commands/${cmdName}`);
        result.summary.commandsCount++;
      } else {
        result.skipped.push(`.claude/commands/${cmdName}`);
      }
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
    if (agentsConfig.browser) agentsToCopy.push(...AGENTS_MAP.browser);
    // V1-specific agent categories
    if (agentsConfig.v1) agentsToCopy.push(...(AGENTS_MAP.v1 || []));
    if (agentsConfig.optimization) agentsToCopy.push(...(AGENTS_MAP.optimization || []));
    if (agentsConfig.testing) agentsToCopy.push(...(AGENTS_MAP.testing || []));
    // Dual-mode agents (Claude Code + Codex hybrid)
    if (agentsConfig.dualMode) agentsToCopy.push(...(AGENTS_MAP.dualMode || []));
  }

  // Find source agents directory
  const sourceAgentsDir = findSourceDir('agents', options.sourceBaseDir);
  if (!sourceAgentsDir) {
    result.errors.push('Could not find source agents directory');
    return;
  }

  // Copy each agent category
  for (const agentCategory of [...new Set(agentsToCopy)]) {
    const sourcePath = path.join(sourceAgentsDir, agentCategory);
    const targetPath = path.join(targetAgentsDir, agentCategory);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        copyDirRecursive(sourcePath, targetPath);
        // Count agent files (.md only — .yaml agents were migrated to .md)
        const mdFiles = countFiles(sourcePath, '.md');
        result.summary.agentsCount += mdFiles;
        result.created.files.push(`.claude/agents/${agentCategory}`);
      } else {
        result.skipped.push(`.claude/agents/${agentCategory}`);
      }
    }
  }
}

/**
 * Find source helpers directory.
 * Validates that the directory contains hook-handler.cjs to avoid
 * returning the target directory or an incomplete source.
 */
function findSourceHelpersDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];
  const SENTINEL_FILE = 'hook-handler.cjs'; // Must exist in valid source

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', 'helpers'));
  }

  // Strategy 1: require.resolve to find package root (most reliable for npx)
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgJsonPath = esmRequire.resolve('@monobrain/cli/package.json');
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

  // Return first path that exists AND contains the sentinel file
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, SENTINEL_FILE))) {
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

  // Try to copy existing helpers from source first
  if (sourceHelpersDir && fs.existsSync(sourceHelpersDir)) {
    const helperFiles = fs.readdirSync(sourceHelpersDir);
    let copiedCount = 0;

    for (const file of helperFiles) {
      const sourcePath = path.join(sourceHelpersDir, file);
      const destPath = path.join(helpersDir, file);

      // Skip directories and only copy files
      if (!fs.statSync(sourcePath).isFile()) continue;

      if (!fs.existsSync(destPath) || options.force) {
        fs.copyFileSync(sourcePath, destPath);

        // Make shell scripts and mjs files executable
        if (file.endsWith('.sh') || file.endsWith('.mjs')) {
          fs.chmodSync(destPath, '755');
        }

        result.created.files.push(`.claude/helpers/${file}`);
        copiedCount++;
      } else {
        result.skipped.push(`.claude/helpers/${file}`);
      }
    }

    if (copiedCount > 0) {
      return; // Skip generating if we copied from source
    }
  }

  // Fall back to generating helpers if source not available
  const helpers: Record<string, string> = {
    'pre-commit': generatePreCommitHook(),
    'post-commit': generatePostCommitHook(),
    'session.js': generateSessionManager(),
    'router.js': generateAgentRouter(),
    'memory.js': generateMemoryHelper(),
    'hook-handler.cjs': generateHookHandler(),
    'intelligence.cjs': generateIntelligenceStub(),
    'auto-memory-hook.mjs': generateAutoMemoryHook(),
  };

  for (const [name, content] of Object.entries(helpers)) {
    const filePath = path.join(helpersDir, name);

    if (!fs.existsSync(filePath) || options.force) {
      fs.writeFileSync(filePath, content, 'utf-8');

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

  fs.writeFileSync(statuslinePath, statuslineScript, 'utf-8');
  result.created.files.push('.claude/helpers/statusline.cjs');
}

/**
 * Write runtime configuration (.monobrain/)
 */
async function writeRuntimeConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const configPath = path.join(targetDir, '.monobrain', 'config.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    result.skipped.push('.monobrain/config.yaml');
    return;
  }

  const config = `# Monobrain Runtime Configuration
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
  persistPath: .monobrain/data
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
  modelPath: .monobrain/neural

hooks:
  enabled: true
  autoExecute: true

mcp:
  autoStart: ${options.mcp.autoStart}
  port: ${options.mcp.port}
`;

  fs.writeFileSync(configPath, config, 'utf-8');
  result.created.files.push('.monobrain/config.yaml');

  // Write .gitignore
  const gitignorePath = path.join(targetDir, '.monobrain', '.gitignore');
  const gitignore = `# Monobrain runtime files
data/
logs/
sessions/
neural/
*.log
*.tmp
`;

  if (!fs.existsSync(gitignorePath) || options.force) {
    fs.writeFileSync(gitignorePath, gitignore, 'utf-8');
    result.created.files.push('.monobrain/.gitignore');
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
  const metricsDir = path.join(targetDir, '.monobrain', 'metrics');
  const learningDir = path.join(targetDir, '.monobrain', 'learning');
  const securityDir = path.join(targetDir, '.monobrain', 'security');

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
      _note: 'Metrics will update as you use Monobrain. Run: npx monobrain@latest daemon start'
    };
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
    result.created.files.push('.monobrain/metrics/v1-progress.json');
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
    fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2), 'utf-8');
    result.created.files.push('.monobrain/metrics/swarm-activity.json');
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
      _note: 'Intelligence grows as you use Monobrain'
    };
    fs.writeFileSync(learningPath, JSON.stringify(learning, null, 2), 'utf-8');
    result.created.files.push('.monobrain/metrics/learning.json');
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
      _note: 'Run: npx monobrain@latest security scan'
    };
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
    result.created.files.push('.monobrain/security/audit-status.json');
  }
}

/**
 * Write CAPABILITIES.md - comprehensive overview of all Monobrain features
 */
async function writeCapabilitiesDoc(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const capabilitiesPath = path.join(targetDir, '.monobrain', 'CAPABILITIES.md');

  if (fs.existsSync(capabilitiesPath) && !options.force) {
    result.skipped.push('.monobrain/CAPABILITIES.md');
    return;
  }

  const capabilities = `# Monobrain - Complete Capabilities Reference
> Generated: ${new Date().toISOString()}
> Full documentation: https://github.com/nokhodian/monobrain

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

Monobrain is a domain-driven design architecture for multi-agent AI coordination with:

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
npx monobrain@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check status
npx monobrain@latest swarm status

# Monitor activity
npx monobrain@latest swarm monitor
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
npx monobrain@latest init --wizard

# Spawn agent
npx monobrain@latest agent spawn -t coder --name my-coder

# Memory operations
npx monobrain@latest memory store --key "pattern" --value "data" --namespace patterns
npx monobrain@latest memory search --query "authentication"

# Diagnostics
npx monobrain@latest doctor --fix
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
npx monobrain@latest memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx monobrain@latest memory search --query "authentication"

# List entries
npx monobrain@latest memory list --namespace patterns

# Initialize database
npx monobrain@latest memory init --force
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
npx monobrain@latest hive-mind init --queen-type strategic

# Status
npx monobrain@latest hive-mind status

# Spawn workers
npx monobrain@latest hive-mind spawn --count 5 --type worker

# Consensus
npx monobrain@latest hive-mind consensus --propose "task"
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
# Add Monobrain MCP
claude mcp add monobrain -- npx -y monobrain@latest mcp start
\`\`\`

---

## Quick Reference

### Essential Commands
\`\`\`bash
# Setup
npx monobrain@latest init --wizard
npx monobrain@latest daemon start
npx monobrain@latest doctor --fix

# Swarm
npx monobrain@latest swarm init --topology hierarchical --max-agents 8
npx monobrain@latest swarm status

# Agents
npx monobrain@latest agent spawn -t coder
npx monobrain@latest agent list

# Memory
npx monobrain@latest memory search --query "patterns"

# Hooks
npx monobrain@latest hooks pre-task --description "task"
npx monobrain@latest hooks worker dispatch --trigger optimize
\`\`\`

### File Structure
\`\`\`
.monobrain/
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

**Full Documentation**: https://github.com/nokhodian/monobrain
**Issues**: https://github.com/nokhodian/monobrain/issues
`;

  fs.writeFileSync(capabilitiesPath, capabilities, 'utf-8');
  result.created.files.push('.monobrain/CAPABILITIES.md');
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

    fs.writeFileSync(claudeMdPath, content, 'utf-8');
    result.created.files.push('CLAUDE.md');
  }

  // Also write/append global ~/.claude/CLAUDE.md so monobrain tools are used automatically (#1497)
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir) {
    const globalClaudeDir = path.join(homeDir, '.claude');
    const globalClaudeMd = path.join(globalClaudeDir, 'CLAUDE.md');
    const monobrainBlock = [
      '',
      '# Monobrain Integration (auto-generated by monobrain init)',
      'When working on multi-file tasks or complex features, use ToolSearch to find and invoke monobrain MCP tools.',
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
        if (!existing.includes('Monobrain Integration')) {
          fs.appendFileSync(globalClaudeMd, monobrainBlock);
          result.created.files.push('~/.claude/CLAUDE.md (appended monobrain block)');
        }
      } else {
        fs.writeFileSync(globalClaudeMd, monobrainBlock.trimStart(), 'utf-8');
        result.created.files.push('~/.claude/CLAUDE.md');
      }
    } catch {
      // Non-critical — global CLAUDE.md is best-effort
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
  // __dirname is typically /path/to/node_modules/@monobrain/cli/dist/src/init
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

export default executeInit;
