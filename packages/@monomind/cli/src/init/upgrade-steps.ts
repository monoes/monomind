/**
 * Building blocks of `init upgrade`: the UpgradeResult shape, project
 * re-indexing, settings.json merge and helper-tree sync.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { backup } from '../platform-adapters/mutation.js';
import type { FileGuard } from './file-guard.js';
import { atomicWriteFile } from './fs-helpers.js';
import { FORCE_SYNC_GENERATORS, FORCE_SYNC_HELPERS, helperFileMode } from './helpers-generator.js';
import { type HooksByEvent, mergeMonomindHooks } from './hook-settings.js';
import { buildProjectIndexes, type ProjectIndexCounts } from './project-indexes.js';
import { generateSettings, MONOMIND_ALLOW_RULES } from './settings-generator.js';
import { GENERATED_HELPERS, MAX_EXEC_FILE_BYTES } from './shared.js';
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
export function indexProject(
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

const TEAMS_FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';

/** True for the `monomind.agentTeams` block earlier inits wrote next to the flag
 *  (#655). Its `coordination.sharedMemoryNamespace: "agent-teams"` is Monomind's own
 *  key; someone who turned Claude Code's teams on by hand does not have it. */
export function isMonomindAgentTeamsBlock(block: unknown): boolean {
  const ns = (block as { coordination?: { sharedMemoryNamespace?: unknown } } | undefined)
    ?.coordination?.sharedMemoryNamespace;
  return ns === 'agent-teams';
}

/**
 * Merge new settings into existing settings.json
 * Preserves user customizations while adding new features like Agent Teams
 * Uses platform-specific commands for Mac, Linux, and Windows
 */
export function mergeSettingsForUpgrade(
  existing: Record<string, unknown>,
  report: string[] = [],
): Record<string, unknown> {
  const merged = { ...existing };

  // Hook commands now use portable `node` (from PATH) instead of
  // platform-specific wrappers — see settings-generator.ts.

  // 1. Merge env vars (preserve existing, add new)
  const existingEnv = { ...((existing.env as Record<string, string>) || {}) };
  // #655: the flag is retired only where Monomind's own block proves an earlier init
  // wrote it; a flag set without that block is the user's and stays.
  const ownedTeams =
    existingEnv[TEAMS_FLAG] === '1' &&
    isMonomindAgentTeamsBlock(
      (existing.monomind as { agentTeams?: unknown } | undefined)?.agentTeams,
    );
  if (ownedTeams) {
    delete existingEnv[TEAMS_FLAG];
    report.push(
      `env.${TEAMS_FLAG} (removed: an earlier init wrote it; re-enable with \`monomind init --agent-teams\`)`,
      'monomind.agentTeams (removed: nothing reads it)',
    );
  }
  merged.env = {
    ...existingEnv,
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

  // 4. Merge monomind settings (preserve existing). The Agent Teams flag and
  // `monomind.agentTeams` are no longer added on upgrade (#655): an existing
  // value stays as the user has it, `doctor` reports it.
  const { agentTeams: ownedBlock, ...existingMonomind } =
    (existing.monomind as Record<string, unknown>) || {};
  merged.monomind = {
    ...existingMonomind,
    ...(ownedTeams || ownedBlock === undefined ? {} : { agentTeams: ownedBlock }),
    version: existingMonomind.version || '3.0.0',
    enabled: existingMonomind.enabled !== false,
  };

  return merged;
}

/**
 * Add the monomind allow rules (MONOMIND_ALLOW_RULES) that `settings` lacks to
 * the end of `permissions.allow`. The user's rules keep their order and every
 * other permissions key (deny, ask, ...) is left as it is. Returns the rules
 * added (none on a second run), or `null` when `permissions` or
 * `permissions.allow` has a shape this cannot extend without rewriting it.
 */
export function addMonomindAllowRules(settings: Record<string, unknown>): string[] | null {
  const permissions = settings.permissions ?? {};
  if (typeof permissions !== 'object' || Array.isArray(permissions)) return null;
  const perms = permissions as Record<string, unknown>;
  const allow = perms.allow ?? [];
  if (!Array.isArray(allow)) return null;
  const added = MONOMIND_ALLOW_RULES.filter((rule) => !allow.includes(rule));
  if (added.length > 0) settings.permissions = { ...perms, allow: [...allow, ...added] };
  return added;
}

/**
 * `init upgrade` step: append the monomind allow rules an existing
 * `.claude/settings.json` lacks, backing the file up into the run's backup
 * directory first. Writes nothing when no rule is missing, and creates no file.
 */
export function addAllowRulesToSettings(
  targetDir: string,
  result: UpgradeResult,
  guard: FileGuard,
): void {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath) || fs.statSync(settingsPath).size > MAX_EXEC_FILE_BYTES) return;
  let settings: unknown;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    // reported below
  }
  const added =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? addMonomindAllowRules(settings as Record<string, unknown>)
      : null;
  if (added === null) {
    guard.warnings.push(
      '.claude/settings.json: not valid JSON or `permissions.allow` is not a list; monomind allow rules not added',
    );
    return;
  }
  if (added.length === 0) return;
  backup(settingsPath, targetDir, false, guard.backupDir);
  atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
  if (!result.updated.includes('.claude/settings.json'))
    result.updated.push('.claude/settings.json');
  result.settingsUpdated = [
    ...(result.settingsUpdated ?? []),
    ...added.map((rule) => `permissions.allow: ${rule}`),
  ];
}

/**
 * Refresh one installed helper tree from the bundled source: force-sync the
 * HELPER_FILES critical set, create any other missing top-level helper (never
 * overwriting one), and recursively sync utils/ and handlers/. Files the bundle
 * does not ship are never touched, so user files survive.
 */
export function syncHelperTree(
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
  // (e.g. an incomplete published npm template).
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
