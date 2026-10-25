/**
 * Init Executor
 * Main execution logic for V1 initialization
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// i-066 follow-up finding 9: shared with routes-monoes.mjs and
// write-claude.ts — see monoes-mcp-entry.mjs's own doc comment for why this
// lives in a .mjs sibling rather than here.
import {
  detectDashboardTokenLeak,
  detectMonoesTokenLeak,
  formatDashboardTokenLeakWarning,
  formatMonoesLeakWarning,
} from '../mcp/monoes-mcp-entry.mjs';
import { installPlatform } from '../platform-adapters/operations.js';
// Split modules
import { DIRECTORIES } from './asset-maps.js';
import { copyAgents, copyCommands, copySkills } from './copy-assets.js';
import { finalizeGuard, guardFor, pruneBackups } from './file-guard.js';
import { recordPacks } from './init-manifest.js';
import { initProjectMemory, seedProjectMemory } from './init-memory.js';
import { initKnowledgeGraph, runDoctorFix } from './init-post-steps.js';
import { installedPacks, packsOnDisk } from './pack-install.js';
import { PACK_NAMES } from './packs.js';
import { wantsAgentsDirs, wantsGeminiDirs } from './platform-dirs.js';
import { buildProjectIndexes } from './project-indexes.js';
import {
  _registerMonomindProject,
  findMonomindProjects,
  shouldRegisterMonomindProject,
} from './project-registry.js';
import { retireRemovedFiles } from './retired-files.js';
import { findSourceDir, findSourceHelpersDir } from './shared.js';
import {
  detectProjectProfile,
  generateMemorySeeds,
  writeSharedInstructions,
} from './shared-instructions-generator.js';

function claudeOnlyMemorySeeds(targetDir: string): ReturnType<typeof generateMemorySeeds> {
  try {
    return generateMemorySeeds(detectProjectProfile(targetDir));
  } catch {
    return []; // best-effort, like writeSharedInstructions
  }
}

import type { InitOptions, InitResult } from './types.js';
import { detectPlatform } from './types.js';
import { writeAgentsOnly } from './write-agents.js';
import { writeAiderConf } from './write-aider.js';
import { writeGeminiFiles } from './write-antigravity.js';
import { writeClaudeMd, writeHelpers, writeMCPConfig, writeStatusline } from './write-claude.js';
import { writeClineFiles } from './write-cline.js';
import { writeCodexFiles } from './write-codex.js';
import { writeCopilotMeshHooks } from './write-copilot.js';
import { writeKimiFiles } from './write-kimicode.js';
import { writeMeshCoderHooks } from './write-mesh-coder-hooks.js';
import { writeOpencodeFiles } from './write-opencode.js';
import { writePiMeshExtension } from './write-pi.js';
import { writeInitialMetrics, writeRuntimeConfig } from './write-runtime-config.js';
import { writeSettings } from './write-settings.js';

export type { UpgradeResult } from './upgrade.js';
// Re-export upgrade functions so index.ts barrel still works via './executor.js'
export { executeUpgrade, executeUpgradeWithMissing } from './upgrade.js';
export { findMonomindProjects, shouldRegisterMonomindProject };

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
    removed: [],
    errors: [],
    summary: {
      skillsCount: 0,
      commandsCount: 0,
      agentsCount: 0,
      hooksEnabled: 0,
    },
  };

  const targetDir = options.targetDir;

  // `--target agents`: AGENTS.md only — no directories, state, memory, graph
  // or doctor pass (write-agents.ts).
  if (options.components.agentsOnly) {
    try {
      writeAgentsOnly(targetDir, options, result);
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    return result;
  }

  try {
    // Create directory structure
    await createDirectories(targetDir, options, result);
    // Every writer below keeps shipped files the user edited (file-guard.ts).
    const guard = guardFor(targetDir, options, result);

    // Scan directory and save fingerprint (non-fatal if failed)
    let capMgr: any = null;
    try {
      const {
        scanDirectory,
        saveFingerprint,
        CapabilityManager,
        codeCapability,
        documentsCapability,
        mediaCapability,
        timelineCapability,
        graphCapability,
        dataCapability,
      } = await import('../capabilities/index.js');
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
        const { ingestDirectory, ingestDocument } = await import(
          '../knowledge/document-pipeline.js'
        );
        const fs = await import('node:fs');
        let indexedAnything = false;

        if (activeNames.includes('documents')) {
          console.log('\nIndexing documents for Second Brain...');
          const docResult = await ingestDirectory(targetDir, 'shared', { rootDir: targetDir });
          if (docResult.filesProcessed > 0) {
            console.log(
              `  ✓ ${docResult.totalChunks} chunks from ${docResult.filesProcessed} documents`,
            );
            indexedAnything = true;
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
            indexedAnything = true;
          } else {
            console.log('  ✓ Knowledge base initialized (no project docs found)');
          }
        }
        // Idempotency: a re-run over unchanged docs indexes nothing new
        // (ingestDirectory/ingestDocument skip already-ingested content by
        // hash), so only report "created" when something was actually added.
        if (indexedAnything) result.created.files.push('.monomind/knowledge/');
      } catch (docErr) {
        result.skipped.push(
          `knowledge indexing: ${docErr instanceof Error ? docErr.message : String(docErr)}`,
        );
      }
    } catch (scanError) {
      // Scanner/fingerprint/activation failed — non-fatal, continue without capabilities
      result.skipped.push(
        `directory scan: ${scanError instanceof Error ? scanError.message : String(scanError)}`,
      );
    }

    // i-066 follow-up finding 9 [MAJOR]: "has this project already leaked
    // the monoes.me token?" is a property of the init RUN, not of any one
    // component writer — checked once, here, unconditionally, before every
    // component block below (several of which can write or skip-and-leave
    // .mcp.json depending on which component flags are set). This also
    // satisfies finding U5's ordering requirement: it still runs ahead of
    // every possible .mcp.json write in this function, and living in
    // exactly one place makes it structurally incapable of double-printing
    // (the reason the equivalent check was removed from write-claude.ts and
    // write-runtime-config.ts rather than kept in both places).
    const leakWarning = formatMonoesLeakWarning(await detectMonoesTokenLeak(targetDir));
    if (leakWarning) console.error(leakWarning);

    // i-052 commit 3: same ordering guarantee, same reason — a project
    // re-inited after the dashboard already wrote (and possibly
    // committed) `.monomind/dashboard-token` must see this warning
    // regardless of which components are selected.
    const dashboardTokenWarning = formatDashboardTokenLeakWarning(
      await detectDashboardTokenLeak(targetDir),
    );
    if (dashboardTokenWarning) console.error(dashboardTokenWarning);

    // Generate and write settings.json
    if (options.components.settings) {
      await writeSettings(targetDir, options, result);
    }

    // Generate and write .mcp.json
    if (options.components.mcp) {
      await writeMCPConfig(targetDir, options, result);
    }

    // Retire single files older releases installed and this one removed
    // (#418), before the copies and the kimi/opencode conversions below.
    const sourceCommands = findSourceDir('commands', options.sourceBaseDir);
    retireRemovedFiles(targetDir, result, sourceCommands ? path.dirname(sourceCommands) : null);

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

    // Remember which opt-in packs the project has, for `packs list` and
    // `init upgrade --add-missing` (GH #411): only packs this run really put
    // on disk (`--packs specialists` with agents off copies nothing). Never
    // shrinks here.
    const { components } = options;
    if (components.skills || components.commands || components.agents) {
      const all = options.skills.all || options.commands.all || options.agents.all;
      const asked = all ? PACK_NAMES : (options.packs ?? []);
      const copied = packsOnDisk(targetDir, asked, components);
      recordPacks(targetDir, [...installedPacks(targetDir), ...copied]);
    }

    // Generate helpers
    if (options.components.helpers) {
      await writeHelpers(targetDir, options, result);
      // Copilot CLI / Hermes bridge to the helpers just written.
      writeCopilotMeshHooks(targetDir, options, result);
      // Pi has no MCP: its mesh extension talks to the hub socket itself.
      writePiMeshExtension(targetDir, options, result);
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

    // Generate Antigravity (agy) files when selected.
    if (options.components.antigravity) {
      await writeGeminiFiles(targetDir, options, result);
    }

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

    // Codex native hooks reuse the shared gate runtime. A hooks-free Codex
    // project must not create Claude helper artifacts just because Codex was
    // selected; hooks are an explicit opt-in.
    if (
      options.components.codex &&
      options.enablePlatformHooks === true &&
      !options.components.helpers
    ) {
      await writeHelpers(targetDir, options, result);
    }

    // Generate Codex project artifacts (selected via the Codex target).
    if (options.components.codex) {
      await writeCodexFiles(targetDir, options, result);
    }

    // The legacy target writers above remain compatibility projections. The
    // adapter registry is additionally invoked for each explicit platform so
    // all new surfaces share the same evidence-gated lifecycle contract.
    for (const platform of options.selectedPlatforms ?? []) {
      const applied = await installPlatform({
        platform,
        path: targetDir,
        scope: 'project',
        yes: true,
        enableHooks: options.enablePlatformHooks,
        protectedPaths: guard.keptPaths(),
        backupDir: guard.backupDir,
        fileGuard: guard,
      });
      result.updated.push(...applied.changed.map((file) => `platform ${platform}: ${file}`));
      result.skipped.push(...applied.skipped.map((file) => `platform ${platform}: ${file}`));
      result.skipped.push(...applied.diagnostics.map((line) => `platform ${platform}: ${line}`));
    }

    // aider loads CONVENTIONS.md (written by the aider adapter above) only
    // through a `read:` entry; cline gets a rule file (rev 20).
    if (options.selectedPlatforms?.includes('aider')) {
      await writeAiderConf(targetDir, options, result);
    }
    if (options.components.cline) {
      await writeClineFiles(targetDir, options, result);
    }
    await writeMeshCoderHooks(targetDir, options, result);

    // Generate .agents/shared_instructions.md; its memory seeds are stored
    // once the database exists (below). #372: a Claude-only init writes no
    // .agents/ file but keeps the seeds.
    const memorySeeds = wantsAgentsDirs(options)
      ? writeSharedInstructions(targetDir, options.force, result)
      : claudeOnlyMemorySeeds(targetDir);

    // Every agent and skill is on disk now: index them (project + user-level)
    // so the prompt hook and `monomind pick` route to them from the start.
    // Both indexes are unconditionally rebuilt every run — read their bytes
    // first so a re-run over an unchanged project reports nothing "created"
    // (idempotency: --if-missing's "second run creates nothing" contract).
    const registryFile = path.join(targetDir, '.monomind', 'registry.json');
    const skillRegistryFile = path.join(targetDir, '.claude', 'helpers', 'skill-registry.json');
    const readIfExists = (file: string): Buffer | null =>
      fs.existsSync(file) ? fs.readFileSync(file) : null;
    const beforeRegistry = readIfExists(registryFile);
    const beforeSkillRegistry = readIfExists(skillRegistryFile);
    result.indexes = buildProjectIndexes(targetDir, findSourceHelpersDir(options.sourceBaseDir));
    if (result.indexes.skills) {
      const after = readIfExists(skillRegistryFile);
      if (!beforeSkillRegistry || !after?.equals(beforeSkillRegistry)) {
        result.created.files.push('.claude/helpers/skill-registry.json');
      }
    }
    if (result.indexes.agents) {
      const after = readIfExists(registryFile);
      if (!beforeRegistry || !after?.equals(beforeRegistry)) {
        result.created.files.push('.monomind/registry.json');
      }
    }

    // Count enabled hooks
    result.summary.hooksEnabled = countEnabledHooks(options);

    // Build the Monograph code graph in background (non-blocking) — code-project only
    if (options.components.monograph && (capMgr === null || capMgr.isActive('code'))) {
      await initKnowledgeGraph(targetDir, result);
    } else if (options.components.monograph) {
      result.skipped.push('Monograph code graph: not a code project (skipping indexing)');
    }

    // Memory is on by default — set up before the doctor pass so it sees it.
    if (options.components.runtime && options.initMemory !== false) {
      result.memory = await initProjectMemory(targetDir, {
        syncToClaude: options.components.settings,
      });
      if (memorySeeds.length > 0) {
        const seeded = await seedProjectMemory(targetDir, memorySeeds);
        if (seeded > 0) result.created.files.push(`memory: ${seeded} project patterns seeded`);
      }
    }

    // Run doctor auto-fix (non-blocking, best-effort) — unless the caller
    // runs it itself once all of its own writes are done (#425).
    if (!options.deferDoctor)
      await runDoctorFix(
        targetDir,
        result,
        options.installClaudeCode !== false,
        options.selectedPlatforms?.includes('claude') ?? true,
      );

    // Hash what this run left on disk (after adapters and doctor rewrote some
    // of it), so the next run can tell a user edit from an untouched file.
    finalizeGuard(result);
    pruneBackups(targetDir);

    // Register this project in ~/.monomind-projects.json so upgrade --all finds it
    _registerMonomindProject(targetDir);
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Create directory structure
 */
async function createDirectories(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const dirs = [
    // #372: .gemini/ and .agents/ only for the platforms that read them.
    ...DIRECTORIES.claude.filter(
      (d) =>
        (wantsGeminiDirs(options) || !d.startsWith('.gemini')) &&
        (wantsAgentsDirs(options) || !d.startsWith('.agents')),
    ),
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
  if (hooks.preCompact) count++;

  return count;
}

export default executeInit;
