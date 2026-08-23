/**
 * Upgrade logic: executeUpgrade, executeUpgradeWithMissing, mergeSettingsForUpgrade.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FORCE_SYNC_GENERATORS, FORCE_SYNC_HELPERS } from './helpers-generator.js';
import { generateSettings } from './settings-generator.js';
import {
  AGENTS_MAP,
  atomicWriteFile,
  COMMANDS_MAP,
  copyDirRecursive,
  findSourceDir,
  findSourceHelpersDir,
  MAX_EXEC_FILE_BYTES,
  SKILLS_MAP,
} from './shared.js';
import { generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions } from './types.js';
import { DEFAULT_INIT_OPTIONS } from './types.js';

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

  // Hook commands now use portable `node` (from PATH) instead of
  // platform-specific wrappers — see settings-generator.ts.

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
  const gitRootResolver =
    "var c=require('child_process'),p=require('path'),u=require('url'),r;" +
    "try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}" +
    'catch(e){r=process.cwd()}';
  const autoMemoryScript = '.claude/helpers/auto-memory-hook.mjs';
  const autoMemoryImportCmd = `node -e "${gitRootResolver}var f=p.join(r,'${autoMemoryScript}');import(u.pathToFileURL(f).href)" import`;
  const autoMemorySyncCmd = `node -e "${gitRootResolver}var f=p.join(r,'${autoMemoryScript}');import(u.pathToFileURL(f).href)" sync`;

  // Add auto-memory import to SessionStart (if not already present)
  const sessionStartHooks = existingHooks.SessionStart as
    | Array<{ hooks?: Array<{ command?: string }> }>
    | undefined;
  const hasAutoMemoryImport = sessionStartHooks?.some((group) =>
    group.hooks?.some((h) => h.command?.includes('auto-memory-hook')),
  );
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
  const sessionEndHooks = existingHooks.SessionEnd as
    | Array<{ hooks?: Array<{ command?: string }> }>
    | undefined;
  const hasAutoMemorySync = sessionEndHooks?.some((group) =>
    group.hooks?.some((h) => h.command?.includes('auto-memory-hook')),
  );
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
      command:
        existingStatusLine.command ||
        `node -e "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}var s=p.join(r,'.claude/helpers/statusline.cjs');process.argv.splice(1,0,s);require(s)"`,
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
export async function executeUpgrade(
  targetDir: string,
  upgradeSettings = false,
): Promise<UpgradeResult> {
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
          const tmp = `${targetPath}.tmp`;
          fs.copyFileSync(sourcePath, tmp);
          try {
            fs.chmodSync(tmp, 0o755);
          } catch {}
          fs.renameSync(tmp, targetPath);
        } else if (!fs.existsSync(targetPath) && criticalGenerators[helperName]) {
          const content = criticalGenerators[helperName]();
          const tmp = `${targetPath}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, content, 'utf-8');
          try {
            fs.chmodSync(tmp, 0o755);
          } catch {}
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
        try {
          fs.chmodSync(tmp, 0o755);
        } catch {}
        fs.renameSync(tmp, targetPath);
      }
    }

    // 1. Statusline fallback — only generate if source copy above didn't cover it
    const statuslinePath = path.join(targetDir, '.claude', 'helpers', 'statusline.cjs');
    if (
      !sourceHelpersForUpgrade ||
      !fs.existsSync(path.join(sourceHelpersForUpgrade, 'statusline.cjs'))
    ) {
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
        _note: 'Metrics will update as you use Monomind',
      };
      atomicWriteFile(progressPath, JSON.stringify(progress, null, 2));
      result.created.push('.monomind/metrics/v1-progress.json');
    } else {
      result.preserved.push('.monomind/metrics/v1-progress.json');
    }

    // monoswarm-activity.json
    const activityPath = path.join(metricsDir, 'monoswarm-activity.json');
    if (!fs.existsSync(activityPath)) {
      const activity = {
        timestamp: new Date().toISOString(),
        processes: { mcp_server: 0, estimated_agents: 0 },
        monoswarm: { active: false, agent_count: 0, coordination_active: false },
        integration: { mcp_active: false },
        _initialized: true,
      };
      atomicWriteFile(activityPath, JSON.stringify(activity, null, 2));
      result.created.push('.monomind/metrics/monoswarm-activity.json');
    } else {
      result.preserved.push('.monomind/metrics/monoswarm-activity.json');
    }

    // learning.json
    const learningPath = path.join(metricsDir, 'learning.json');
    if (!fs.existsSync(learningPath)) {
      const learning = {
        initialized: new Date().toISOString(),
        routing: { accuracy: 0, decisions: 0 },
        patterns: { shortTerm: 0, longTerm: 0, quality: 0 },
        sessions: { total: 0, current: null },
        _note: 'Intelligence grows as you use Monomind',
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
        _note: 'Run: npx monomind@latest security scan',
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
          result.errors.push(
            `Settings merge failed: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`,
          );
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
export async function executeUpgradeWithMissing(
  targetDir: string,
  upgradeSettings = false,
): Promise<UpgradeResult> {
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
          console.log(
            `[DEBUG] Skill '${skillName}': source=${sourceExists}, target=${targetExists}`,
          );
        }

        if (sourceExists && !targetExists) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedSkills.push(skillName);
          result.created.push(`.claude/skills/${skillName}`);
        }
      }

      // Mirror added skills to .gemini/skills/ and .agents/skills/ (#100)
      if (result.addedSkills.length > 0) {
        const mirrorDirs = [
          path.join(targetDir, '.gemini', 'skills'),
          path.join(targetDir, '.agents', 'skills'),
        ];
        for (const mirrorDir of mirrorDirs) {
          fs.mkdirSync(mirrorDir, { recursive: true });
          for (const skillName of result.addedSkills) {
            const sourcePath = path.join(sourceSkillsDir, skillName);
            if (fs.existsSync(sourcePath)) {
              copyDirRecursive(sourcePath, path.join(mirrorDir, skillName));
            }
          }
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
    result.errors.push(
      `Add missing failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return result;
}
