/**
 * Upgrade logic: executeUpgrade, executeUpgradeWithMissing, mergeSettingsForUpgrade.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { foldLegacySharedSkills } from '../platform-adapters/shared-surface.js';
import { refreshBundledAgents } from './agent-refresh.js';
import { type FileGuard, finalizeGuard, guardFor, pruneBackups } from './file-guard.js';
import { FORCE_SYNC_GENERATORS, FORCE_SYNC_HELPERS, helperFileMode } from './helpers-generator.js';
import { type HooksByEvent, mergeMonomindHooks } from './hook-settings.js';
import { buildProjectIndexes, type ProjectIndexCounts } from './project-indexes.js';
import { generateSettings } from './settings-generator.js';
import {
  AGENTS_MAP,
  atomicWriteFile,
  COMMANDS_MAP,
  copyDirRecursive,
  findSourceDir,
  findSourceHelpersDir,
  GENERATED_HELPERS,
  MAX_EXEC_FILE_BYTES,
  SKILLS_MAP,
} from './shared.js';
import { generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions, InitResult } from './types.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform } from './types.js';
import { writeCapabilitiesDoc } from './write-capabilities.js';
import { writeClaudeMd } from './write-claude.js';

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
  /** Installed agents replaced with the bundled file (only metadata differed). */
  refreshedAgents?: string[];
  /** Installed agents left alone because their body differs from the bundle. */
  keptAgents?: string[];
  /** Agent registry and skill index counts (see init/project-indexes.ts). */
  indexes?: ProjectIndexCounts;
  /** Helpers kept because the user edited them (see file-guard.ts). */
  kept?: string[];
  /** Things the user must be told even though the upgrade succeeded. */
  warnings?: string[];
}

/** Rebuilds the agent registry and skill index, recording them in `result`. */
function indexProject(
  targetDir: string,
  result: UpgradeResult,
  sourceHelpersDir?: string | null,
): void {
  result.indexes = buildProjectIndexes(targetDir, sourceHelpersDir);
  for (const [file, built] of [
    ['.claude/helpers/skill-registry.json', result.indexes.skills],
    ['.monomind/registry.json', result.indexes.agents],
  ] as const) {
    if (built && !result.updated.includes(file)) result.updated.push(file);
  }
}

/**
 * Merge new settings into existing settings.json
 * Preserves user customizations while adding new features like Agent Teams
 * Uses platform-specific commands for Mac, Linux, and Windows
 */
function mergeSettingsForUpgrade(
  existing: Record<string, unknown>,
  report: string[] = [],
): Record<string, unknown> {
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

  // 2. Merge hooks: add every monomind hook the current generator writes that
  // this install lacks (pre-agent, SubagentStart/Stop capture, auto-memory, ...)
  // and convert monomind-owned millisecond timeouts to seconds. User hooks are
  // never changed or removed (see hook-settings.ts).
  const reference =
    (generateSettings(DEFAULT_INIT_OPTIONS) as { hooks?: HooksByEvent }).hooks ?? {};
  const hookMerge = mergeMonomindHooks((existing.hooks as HooksByEvent) || {}, reference);
  merged.hooks = hookMerge.hooks;
  report.push(...hookMerge.added.map((h) => `hooks.${h}`));
  if (hookMerge.timeoutsFixed > 0)
    report.push(
      `hooks: ${hookMerge.timeoutsFixed} monomind hook timeout(s) converted from milliseconds to seconds`,
    );

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
 * Refresh one installed helper tree from the bundled source: force-sync the
 * HELPER_FILES critical set, create any other missing top-level helper (never
 * overwriting one), and recursively sync utils/ and handlers/. Files the bundle
 * does not ship are never touched, so user files survive.
 */
function syncHelperTree(
  sourceDir: string,
  destHelpersDir: string,
  label: string,
  result: UpgradeResult,
  guard: FileGuard,
): void {
  // Copy top-level critical files atomically. Membership and fallback
  // generators come from the shared HELPER_FILES registry (helpers-generator.ts)
  // rather than a hardcoded list here — see that file's comment for why.
  const criticalHelpers = FORCE_SYNC_HELPERS;
  // Generated fallback for any critical helper missing from the source dir itself
  // (e.g. the published npm template lacking auto-memory-hook.mjs).
  const criticalGenerators: Record<string, () => string> = FORCE_SYNC_GENERATORS;
  for (const helperName of criticalHelpers) {
    const targetPath = path.join(destHelpersDir, helperName);
    const sourcePath = path.join(sourceDir, helperName);
    if (fs.existsSync(sourcePath)) {
      if (fs.existsSync(targetPath)) {
        result.updated.push(`${label}/${helperName}`);
      } else {
        result.created.push(`${label}/${helperName}`);
      }
      // Atomic write (the guard writes via rename) so a partial write can't
      // leave a broken hook; a helper the user edited is kept.
      if (guard.copyFile(sourcePath, targetPath) !== 'kept') {
        try {
          fs.chmodSync(targetPath, helperFileMode(helperName));
        } catch {}
      }
    } else if (!fs.existsSync(targetPath) && criticalGenerators[helperName]) {
      guard.write(targetPath, criticalGenerators[helperName](), helperFileMode(helperName));
      result.created.push(`${label}/${helperName}`);
    }
  }
  // Restore any OTHER top-level helper the bundle ships but the project
  // is missing (issue #225). The force-sync list above is a curated set of
  // files we overwrite on every upgrade; it was also — wrongly — the only
  // way a top-level helper could ever be (re)created here, so a project
  // missing e.g. audit-log-writer.cjs never got it back. That one is
  // require()d at module load by handlers/gates-handler.cjs, which the
  // recursive handlers/ sync below faithfully restores, so the upgrade
  // produced a gates handler that threw MODULE_NOT_FOUND on every
  // PreToolUse hook — and hook-handler.cjs fails closed, deadlocking every
  // Bash and Write call with no in-session way out. Create-if-missing only:
  // never overwrite, so user-edited scaffolds (memory.cjs, session.cjs)
  // keep their edits, which is exactly why they are not force-synced.
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('._')) continue;
    if (criticalHelpers.includes(entry.name) || GENERATED_HELPERS.has(entry.name)) continue;
    const targetPath = path.join(destHelpersDir, entry.name);
    if (fs.existsSync(targetPath)) continue;
    const tmp = `${targetPath}.${process.pid}.tmp`;
    fs.copyFileSync(path.join(sourceDir, entry.name), tmp);
    try {
      fs.chmodSync(tmp, helperFileMode(entry.name));
    } catch {}
    fs.renameSync(tmp, targetPath);
    result.created.push(`${label}/${entry.name}`);
  }
  // Always recursively sync subdirectories (utils/, handlers/) — required by hook-handler.cjs.
  // Uses recursive copy so any future nested subdirs are also covered.
  for (const subdir of ['utils', 'handlers']) {
    const srcSubdir = path.join(sourceDir, subdir);
    const destSubdir = path.join(destHelpersDir, subdir);
    if (fs.existsSync(srcSubdir)) {
      guard.copyDir(srcSubdir, destSubdir);
      result.updated.push(`${label}/${subdir}/`);
    }
  }
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

    // Shared InitOptions for every writer below that needs one (statusline
    // fallback, CLAUDE.md/CAPABILITIES.md refresh) — one options shape, not
    // an ad-hoc one per writer. `force: true` is what makes those writers'
    // own skip-if-exists gates refresh the file's managed block on upgrade
    // instead of no-op'ing.
    const upgradeOptions: InitOptions = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir,
      force: true,
      // `force` refreshes managed blocks, but upgrade is not the user's
      // explicit --force: a block they edited is kept (file-guard.ts).
      preserveEdits: true,
      statusline: {
        ...DEFAULT_INIT_OPTIONS.statusline,
        refreshInterval: 5000,
      },
    };

    // One guard for the whole upgrade: helpers a user edited are kept, and
    // one without a recorded hash (an older install) is backed up first.
    const docsResult: InitResult = {
      success: true,
      platform: detectPlatform(),
      created: { directories: [], files: [] },
      updated: [],
      skipped: [],
      removed: [],
      errors: [],
      summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
    };
    const guard = guardFor(targetDir, upgradeOptions, docsResult);

    // 0. ALWAYS update critical helpers + subdirectories (force overwrite)
    const sourceHelpersForUpgrade = findSourceHelpersDir();
    if (sourceHelpersForUpgrade) {
      syncHelperTree(
        sourceHelpersForUpgrade,
        path.join(targetDir, '.claude', 'helpers'),
        '.claude/helpers',
        result,
        guard,
      );
      // init also copies the helper tree into .gemini/helpers (writeHelpers),
      // and Antigravity's status bar runs .gemini/helpers/statusline.cjs. Give
      // that copy the same refresh, but only where init installed one.
      const geminiHelpersDir = path.join(targetDir, '.gemini', 'helpers');
      if (fs.existsSync(geminiHelpersDir)) {
        syncHelperTree(sourceHelpersForUpgrade, geminiHelpersDir, '.gemini/helpers', result, guard);
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
        // Atomic write (the guard writes via a PID-suffixed rename) so a
        // partial hook-handler.cjs cannot ship if init is interrupted.
        guard.write(targetPath, content, helperFileMode(helperName));
      }
    }

    // 1. Statusline fallback — only generate if source copy above didn't cover it
    const statuslinePath = path.join(targetDir, '.claude', 'helpers', 'statusline.cjs');
    if (
      !sourceHelpersForUpgrade ||
      !fs.existsSync(path.join(sourceHelpersForUpgrade, 'statusline.cjs'))
    ) {
      const statuslineContent = generateStatuslineScript(upgradeOptions);
      if (fs.existsSync(statuslinePath)) {
        result.updated.push('.claude/helpers/statusline.cjs');
      } else {
        result.created.push('.claude/helpers/statusline.cjs');
      }
      guard.write(statuslinePath, statuslineContent);
    }

    // 1.4. Refresh installed agents whose body matches the bundle, so older
    // installs get the when_to_use/tags/category the pick index ranks on.
    // Agents with a locally edited body are kept and reported.
    const sourceAgentsForUpgrade = findSourceDir('agents');
    if (sourceAgentsForUpgrade) {
      const agentRefresh = refreshBundledAgents(
        path.join(targetDir, '.claude', 'agents'),
        sourceAgentsForUpgrade,
      );
      result.refreshedAgents = agentRefresh.refreshed;
      result.keptAgents = agentRefresh.kept;
      result.updated.push(...agentRefresh.refreshed.map((rel) => `.claude/agents/${rel}`));
    }

    // 1.5. Refresh CLAUDE.md and .monomind/CAPABILITIES.md through their
    // managed blocks (i-035). Before this, `init upgrade` never called
    // writeClaudeMd or writeCapabilitiesDoc at all, so any fix to what the
    // generators write never reached a project that had already run `init`
    // once. Those writers take an InitOptions + InitResult shape distinct
    // from UpgradeResult — build a throwaway InitResult, call the same
    // writers `init` itself uses, and fold the outcome back into
    // updated/created based on whether the file existed beforehand.
    const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
    const capabilitiesPath = path.join(targetDir, '.monomind', 'CAPABILITIES.md');
    const claudeMdExisted = fs.existsSync(claudeMdPath);
    const capabilitiesExisted = fs.existsSync(capabilitiesPath);
    // i-035 reviewer MINOR 5: writeClaudeMd/writeCapabilitiesDoc both skip
    // the actual disk write when the merged content is byte-identical to
    // what's already there (their own mtime-stability guard) — read the
    // "before" bytes here so a genuine no-op `init upgrade` doesn't get
    // reported as "updated" when nothing on disk actually changed.
    const claudeMdBefore = claudeMdExisted ? fs.readFileSync(claudeMdPath, 'utf-8') : null;
    const capabilitiesBefore = capabilitiesExisted
      ? fs.readFileSync(capabilitiesPath, 'utf-8')
      : null;
    await writeClaudeMd(targetDir, upgradeOptions, docsResult);
    await writeCapabilitiesDoc(targetDir, upgradeOptions, docsResult);
    if (!claudeMdExisted) {
      result.created.push('CLAUDE.md');
    } else if (fs.readFileSync(claudeMdPath, 'utf-8') !== claudeMdBefore) {
      result.updated.push('CLAUDE.md');
    }
    if (!capabilitiesExisted) {
      result.created.push('.monomind/CAPABILITIES.md');
    } else if (fs.readFileSync(capabilitiesPath, 'utf-8') !== capabilitiesBefore) {
      result.updated.push('.monomind/CAPABILITIES.md');
    }

    // 1.6. Collapse the one-block-per-platform copies an older install left in
    // `.agents/skills` (every platform sharing it wrote its own full copy).
    try {
      result.updated.push(...(await foldLegacySharedSkills(targetDir, guard)));
    } catch (foldError) {
      result.errors.push(
        `Shared skill fold failed: ${foldError instanceof Error ? foldError.message : String(foldError)}`,
      );
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
          const hookReport: string[] = [];
          const mergedSettings = mergeSettingsForUpgrade(existingSettings, hookReport);
          atomicWriteFile(settingsPath, JSON.stringify(mergedSettings, null, 2));
          result.updated.push('.claude/settings.json');
          result.settingsUpdated = [
            'env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
            ...hookReport,
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

    // Both routing indexes are generated, never copied: rebuild them now so
    // the project's own and the user's (~/.claude) agents and skills replace
    // any stale snapshot.
    indexProject(targetDir, result, sourceHelpersForUpgrade);

    finalizeGuard(docsResult);
    result.kept = docsResult.kept;
    result.warnings = docsResult.warnings;
    pruneBackups(targetDir);
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
      const allSkills = Object.values(SKILLS_MAP)
        .flat()
        .flatMap((skill) => {
          if (!skill.endsWith('*')) return [skill];
          const prefix = skill.slice(0, -1);
          return fs
            .readdirSync(sourceSkillsDir)
            .filter(
              (name) =>
                name.startsWith(prefix) &&
                fs.existsSync(path.join(sourceSkillsDir, name, 'SKILL.md')),
            );
        });
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

  // Newly added agents and skills join the indexes built by executeUpgrade.
  if (result.addedSkills?.length || result.addedAgents?.length || result.addedCommands?.length) {
    indexProject(targetDir, result);
  }

  return result;
}
