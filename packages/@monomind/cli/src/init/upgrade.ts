/**
 * Upgrade logic: executeUpgrade, executeUpgradeWithMissing, mergeSettingsForUpgrade.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { foldLegacySharedSkills } from '../platform-adapters/shared-surface.js';
import { refreshBundledAgents } from './agent-refresh.js';
import { isCommandDoc, isDeprecatedAgent } from './asset-maps.js';
import { finalizeGuard, guardFor, pruneBackups } from './file-guard.js';
import { atomicWriteFile, copyDirRecursive } from './fs-helpers.js';
import { FORCE_SYNC_GENERATORS, helperFileMode } from './helpers-generator.js';
import { installedPacks } from './pack-install.js';
import { CORE_PACK, OPTIONAL_PACKS, packEntries } from './packs.js';
import { retireRemovedFiles } from './retired-files.js';
import { generateSettings } from './settings-generator.js';
import { findSourceDir, findSourceHelpersDir, MAX_EXEC_FILE_BYTES } from './shared.js';
import { generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions, InitResult } from './types.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform } from './types.js';
import {
  indexProject,
  mergeSettingsForUpgrade,
  syncHelperTree,
  type UpgradeResult,
} from './upgrade-steps.js';
import { writeCapabilitiesDoc } from './write-capabilities.js';
import { writeClaudeMd } from './write-claude.js';

export type { UpgradeResult };

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

    // Retire single files older releases installed and this one removed
    // (#418); refresh the stale READMEs that named them.
    const sourceCommandsForRetire = findSourceDir('commands');
    retireRemovedFiles(
      targetDir,
      docsResult,
      sourceCommandsForRetire ? path.dirname(sourceCommandsForRetire) : null,
    );
    result.updated.push(...docsResult.removed, ...docsResult.updated);
    result.errors.push(...docsResult.errors);

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
          // #655: a retired Agent Teams flag is the one value upgrade removes; keep the
          // file as it was so the removal can be undone by hand.
          if (hookReport.some((r) => r.startsWith('env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')))
            fs.copyFileSync(settingsPath, `${settingsPath}.bak-agent-teams`);
          atomicWriteFile(settingsPath, JSON.stringify(mergedSettings, null, 2));
          result.updated.push('.claude/settings.json');
          result.settingsUpdated = [
            ...hookReport,
            'hooks.TeammateIdle (removed — not a valid Claude Code hook)',
            'hooks.TaskCompleted (removed — not a valid Claude Code hook)',
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

    // Only the packs this project has: core plus the opt-in packs it
    // installed (GH #411). Nothing is ever deleted here.
    const installed = installedPacks(targetDir);
    const packs = [CORE_PACK, ...OPTIONAL_PACKS.filter((p) => installed.includes(p.name))];

    // Add missing skills
    if (sourceSkillsDir) {
      const allSkills = packEntries(packs, 'skills');
      const debugMode = process.env.DEBUG || process.env.MONOMIND_DEBUG;
      if (debugMode) {
        console.log(`[DEBUG] Checking ${allSkills.length} skills from the installed packs`);
      }
      for (const skillName of allSkills) {
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

      // Mirror added skills to .gemini/skills/ and .agents/skills/ (#100),
      // only where the project already has that platform's tree (#420):
      // upgrade keeps the project's platforms and never adds new ones.
      if (result.addedSkills.length > 0) {
        const mirrorDirs = ['.gemini', '.agents']
          .filter((dir) => fs.existsSync(path.join(targetDir, dir)))
          .map((dir) => path.join(targetDir, dir, 'skills'));
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
      for (const agentCategory of packEntries(packs, 'agents')) {
        const sourcePath = path.join(sourceAgentsDir, agentCategory);
        const targetPath = path.join(agentsDir, agentCategory);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          if (fs.statSync(sourcePath).isDirectory()) {
            copyDirRecursive(sourcePath, targetPath, isDeprecatedAgent);
          } else if (!isDeprecatedAgent(sourcePath)) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
          } else {
            continue;
          }
          result.addedAgents.push(agentCategory);
          result.created.push(`.claude/agents/${agentCategory}`);
        }
      }
    }

    // Add missing commands
    if (sourceCommandsDir) {
      for (const cmdName of packEntries(packs, 'commands')) {
        const sourcePath = path.join(sourceCommandsDir, cmdName);
        const targetPath = path.join(commandsDir, cmdName);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          if (fs.statSync(sourcePath).isDirectory()) {
            copyDirRecursive(sourcePath, targetPath, (p) =>
              isCommandDoc(path.relative(sourceCommandsDir, p)),
            );
          } else {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
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
