/**
 * Claude Code file writers: settings.json, .mcp.json, helpers, statusline, CLAUDE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateClaudeMd } from './claudemd-generator.js';
import { guardFor } from './file-guard.js';
import { INIT_FALLBACK_HELPERS, OBSOLETE_HELPER_NAMES } from './helpers-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateSettingsJson } from './settings-generator.js';
import {
  atomicWriteFile,
  findSourceClaudeDir,
  findSourceHelpersDir,
  GENERATED_HELPERS,
  MAX_EXEC_FILE_BYTES,
} from './shared.js';
import { generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions, InitResult } from './types.js';

/** A single hook command entry inside a hook group's `hooks` array. */
interface HookEntry {
  command: string;
  [key: string]: unknown;
}

/** A hook group as it appears in settings.json's `hooks.<EventType>` arrays. */
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

/**
 * Write settings.json
 */
export async function writeSettings(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const generated = JSON.parse(generateSettingsJson(options));

  if (fs.existsSync(settingsPath) && fs.statSync(settingsPath).size <= MAX_EXEC_FILE_BYTES) {
    // Merge hooks/env/permissions into existing settings instead of skipping
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      let merged = false;

      // Merge hooks (the critical missing piece — #1484).
      // `--force` must still refresh monomind's own hook entries (that's the
      // point of --force), but blindly overwriting with `generated` below
      // silently deleted any hook registration the generator doesn't itself
      // produce — hand-added custom hooks (this repo's own settings.json
      // dogfoods several: event-logger.cjs, loop-tracker.cjs,
      // mastermind-activate.cjs, control-stop.cjs) vanished from
      // settings.json on every `init --force` with no warning. Non-force
      // behavior (backfill only when hooks are completely absent) is
      // unchanged.
      if (options.force && generated.hooks) {
        // mergeHooksPreservingUnknown matches by exact command string (see its
        // own docstring): a hook this product renamed looks "unknown" to it —
        // not present in the newly generated commands — and gets preserved
        // rather than replaced, duplicating the hook under its old, now-dead
        // command forever. Strip known-obsolete commands first so --force
        // actually retires them instead of running them alongside the new one.
        existing.hooks = mergeHooksPreservingUnknown(
          stripObsoleteHookCommands(existing.hooks),
          generated.hooks,
        );
        merged = true;
      } else if (generated.hooks && !existing.hooks) {
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
          (r: string) => !existingAllow.includes(r),
        );
        if (newRules.length > 0) {
          existing.permissions = existing.permissions || {};
          existing.permissions.allow = [...existingAllow, ...newRules];
          merged = true;
        }
      }

      if (merged) {
        atomicWriteFile(settingsPath, `${JSON.stringify(existing, null, 2)}\n`);
        result.created.files.push('.claude/settings.json (merged hooks)');
      } else {
        result.skipped.push('.claude/settings.json');
      }
    } catch (e) {
      // Existing file is corrupt — overwrite
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error(
          '[writeSettings] existing settings.json unparseable, overwriting with generated defaults:',
          e,
        );
      atomicWriteFile(settingsPath, `${JSON.stringify(generated, null, 2)}\n`);
      result.created.files.push('.claude/settings.json');
    }
    return;
  }

  atomicWriteFile(settingsPath, `${JSON.stringify(generated, null, 2)}\n`);
  result.created.files.push('.claude/settings.json');
}

/**
 * Drop hook entries whose command references a helper this product has
 * renamed (OBSOLETE_HELPER_NAMES) — run only under --force, right before
 * mergeHooksPreservingUnknown, so those entries don't survive the merge as
 * "unknown" duplicates of the hook's new, renamed form. Groups left with no
 * hooks are dropped entirely rather than kept as an empty shell.
 */
function stripObsoleteHookCommands(
  hooks: Record<string, HookGroup[]> | undefined,
): Record<string, HookGroup[]> | undefined {
  if (!hooks) return hooks;
  const result: Record<string, HookGroup[]> = {};
  for (const [eventType, groups] of Object.entries(hooks)) {
    const cleaned = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter(
          (h) => !OBSOLETE_HELPER_NAMES.some((name) => h.command.includes(name)),
        ),
      }))
      .filter((group) => (group.hooks?.length ?? 0) > 0);
    if (cleaned.length > 0) result[eventType] = cleaned;
  }
  return result;
}

/**
 * Merge freshly generated hooks into an existing hooks object without losing
 * hook registrations the generator doesn't itself produce, and without
 * reshuffling hook blocks the existing file already had.
 *
 * For each event type present on either side: a type absent from one side is
 * taken verbatim from the other. When both sides define the type, block
 * ("hook group") order is resolved per mergeEventGroupsPreservingOrder.
 *
 * Two tradeoffs of this approach, by design:
 * - Order is preserved at the group ("block") level, not for individual
 *   hook entries inside a block the generator owns: a block that still has
 *   a template counterpart always gets that counterpart's content verbatim
 *   (needed so e.g. a stale timeout gets refreshed to the current default),
 *   which may reorder entries *within* that one block relative to before.
 * - Matching is by exact command string, same as before this function
 *   existed. If a future change to the generator's command template changes
 *   what it emits for an existing hook, the old emitted form will look
 *   "unknown" and be preserved alongside the new one (duplicate execution)
 *   rather than replaced. That's the safer failure mode for the original
 *   data-loss bug (#1484) this function was written to fix — visible
 *   duplication beats silent loss — but worth knowing about.
 */
function mergeHooksPreservingUnknown(
  existingHooks: Record<string, HookGroup[]> | undefined,
  generatedHooks: Record<string, HookGroup[]>,
): Record<string, HookGroup[]> {
  const existing = existingHooks || {};
  const merged: Record<string, HookGroup[]> = {};

  for (const eventType of new Set([...Object.keys(existing), ...Object.keys(generatedHooks)])) {
    const generatedGroups = generatedHooks[eventType];
    const existingGroups = existing[eventType];

    if (!existingGroups) {
      merged[eventType] = generatedGroups;
      continue;
    }
    if (!generatedGroups) {
      merged[eventType] = existingGroups;
      continue;
    }

    merged[eventType] = mergeEventGroupsPreservingOrder(existingGroups, generatedGroups);
  }

  return merged;
}

/**
 * Merge one event type's existing and generated hook-group arrays.
 *
 * Groups are matched to a same-event counterpart by matcher, bucketing an
 * absent `matcher` together with an explicit `"matcher": ""` — the same
 * convention this function used before this change existed. (Claude Code's
 * hooks reference documents matcher *support*, and what it matches against,
 * per event type — e.g. SessionStart's matcher is the session-start reason,
 * not a tool name — but only UserPromptSubmit and Stop are documented as
 * having no matcher support at all; whether an empty-string matcher and an
 * absent one behave identically at runtime on the events that *do* support
 * one isn't itself documented, just inferred from ordinary regex semantics.
 * It doesn't matter for correctness here either way: this bucketing is only
 * this function's own notion of "which block is this", never applied to
 * change what's written — each emitted group's `matcher` field is always
 * copied verbatim from whichever side, generated or preserved-existing, it
 * came from.) Walking the *existing* array in its original order:
 *   - An existing group whose matcher still has an unclaimed generated
 *     counterpart is replaced in place, at its original position, with that
 *     generated group's content (refreshing command/timeout to current
 *     defaults — matches this function's behavior before this change).
 *   - Any of that existing group's hooks whose command isn't produced by
 *     *any* generated group in this event type (e.g. a hand-added extra
 *     hook sharing a matcher with a generator-owned block) would otherwise
 *     be silently dropped by the replacement above — those are preserved as
 *     an additional group immediately after it.
 *   - An existing group whose matcher has no generated counterpart at all
 *     (removed by the template, or always custom) is kept at its original
 *     position, minus any hooks that a generated group *does* produce under
 *     a different matcher (already represented there; keeping them here too
 *     would duplicate them).
 * Generated groups whose matcher never appears in the existing array at all
 * are genuinely new template blocks — those are appended at the end, in the
 * template's own order.
 */
function mergeEventGroupsPreservingOrder(
  existingGroups: HookGroup[],
  generatedGroups: HookGroup[],
): HookGroup[] {
  const matcherKey = (group: HookGroup): string => group.matcher ?? '';

  const knownCommands = new Set(
    generatedGroups.flatMap((group) => (group.hooks ?? []).map((h) => h.command)),
  );

  const generatedByMatcher = new Map<string, HookGroup[]>();
  for (const group of generatedGroups) {
    const key = matcherKey(group);
    const bucket = generatedByMatcher.get(key);
    if (bucket) bucket.push(group);
    else generatedByMatcher.set(key, [group]);
  }

  const used = new Set<HookGroup>();
  const result: HookGroup[] = [];

  for (const existingGroup of existingGroups) {
    const key = matcherKey(existingGroup);
    const candidate = (generatedByMatcher.get(key) ?? []).find((group) => !used.has(group));
    const unknownHooks = (existingGroup.hooks ?? []).filter((h) => !knownCommands.has(h.command));

    if (candidate) {
      used.add(candidate);
      result.push(candidate);
      if (unknownHooks.length > 0) {
        result.push(key ? { matcher: key, hooks: unknownHooks } : { hooks: unknownHooks });
      }
    } else if (unknownHooks.length > 0) {
      result.push(key ? { matcher: key, hooks: unknownHooks } : { hooks: unknownHooks });
    }
    // else: every hook in this existing group is produced by a generated
    // group under a different matcher — already placed there (or will be
    // appended below); nothing to place at this position.
  }

  for (const group of generatedGroups) {
    if (!used.has(group)) result.push(group);
  }

  return result;
}

/**
 * Write .mcp.json
 */
export async function writeMCPConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const mcpPath = path.join(targetDir, '.mcp.json');

  // i-066 follow-up finding 9: the already-leaked-token check used to live
  // here (round 3), but this function only runs when
  // options.components.mcp is set, which is FALSE on several documented
  // init paths (`--target codex`, `--target opencode`/`kimicode` without
  // claude, skipClaude) — silently dropping the check for a whole class of
  // runs. Hoisted to executor.ts, once, ahead of every component block, so
  // it runs regardless of which components are selected. See executor.ts
  // for the ordering rationale (still ahead of this and every other
  // .mcp.json write, satisfying finding U5).

  if (fs.existsSync(mcpPath) && !options.force) {
    result.skipped.push('.mcp.json');
    return;
  }

  const content = generateMCPJson(options);
  if (!fs.existsSync(mcpPath)) {
    atomicWriteFile(mcpPath, content);
    result.created.files.push('.mcp.json');
    return;
  }

  // --force refreshes monomind's own server entry only. Replacing the file
  // wholesale deleted every other MCP server the project had registered.
  let existing: { mcpServers?: Record<string, Record<string, unknown>> };
  try {
    existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error();
  } catch {
    result.errors.push('.mcp.json is not a JSON object — left untouched; fix it and re-run init');
    return;
  }
  const generated = JSON.parse(content).mcpServers as Record<string, Record<string, unknown>>;
  const servers = { ...(existing.mcpServers ?? {}) };
  for (const [name, entry] of Object.entries(generated)) {
    // Servers the generator emits are monomind's own (monoes' tokenless entry
    // is how a leaked token is migrated away), so they are replaced.
    if (name !== 'monomind') {
      servers[name] = entry;
      continue;
    }
    // Refresh command/args, keep every field and env value the user set.
    const current = servers.monomind ?? {};
    servers.monomind = {
      ...current,
      ...entry,
      env: { ...(entry.env as object), ...(current.env as object) },
    };
  }
  atomicWriteFile(mcpPath, `${JSON.stringify({ ...existing, mcpServers: servers }, null, 2)}\n`);
  result.created.files.push('.mcp.json (merged monomind server)');
}

/**
 * Write helper scripts
 */
export async function writeHelpers(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source helpers directory (works for npm package and local dev)
  const sourceHelpersDir = findSourceHelpersDir(options.sourceBaseDir);
  // --force refreshes existing helpers, but never one the user edited.
  const guard = guardFor(targetDir, options, result);

  // Try to copy existing helpers from source first (recursive — includes utils/ and handlers/)
  if (sourceHelpersDir && fs.existsSync(sourceHelpersDir)) {
    const copyRecursive = (srcDir: string, destDir: string, relBase: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        // Skip exFAT/macOS AppleDouble junk files (e.g. "._foo.cjs").
        if (entry.name.startsWith('._') || GENERATED_HELPERS.has(entry.name)) continue;

        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath, relPath);
        } else {
          if (!fs.existsSync(destPath) || options.force) {
            if (guard.copyFile(srcPath, destPath) === 'kept') continue;
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
    // Only Antigravity reads the .gemini/helpers copy (its status bar runs
    // .gemini/helpers/statusline.sh -> statusline.cjs). Kimi's statusline
    // reads .claude/helpers first, so it needs no Gemini copy.
    if (options.components.antigravity) {
      copyRecursive(sourceHelpersDir, path.join(targetDir, '.gemini', 'helpers'), '');
    }
    // skill-registry.json is built with the agent registry once init has
    // written every file (executor.ts, buildProjectIndexes).
  }

  // --force means writeSettings (called elsewhere in this same init run) is
  // about to refresh settings.json's hook commands via its preserving merge,
  // which strips references to any OBSOLETE_HELPER_NAMES entry (see
  // stripObsoleteHookCommands below) — so it's safe here to also remove any
  // helper this product shipped in the past under a name it no longer uses,
  // otherwise a renamed helper (e.g. graphify-freshen.cjs ->
  // monograph-freshen.cjs) would sit forever as a dead file nothing
  // references. A plain (non-force) init never deletes anything, matching
  // every other write below.
  if (options.force) {
    for (const [label, dir] of [
      ['.claude/helpers', helpersDir],
      ['.gemini/helpers', path.join(targetDir, '.gemini', 'helpers')],
    ] as const) {
      for (const name of OBSOLETE_HELPER_NAMES) {
        const obsoletePath = path.join(dir, name);
        if (fs.existsSync(obsoletePath)) {
          fs.rmSync(obsoletePath);
          result.created.files.push(`[removed] ${label}/${name} (renamed upstream)`);
        }
      }
    }
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
      if (guard.write(filePath, content) === 'kept') continue;

      // Make shell scripts executable
      if (!name.endsWith('.js')) {
        fs.chmodSync(filePath, '755');
      }

      result.created.files.push(`.claude/helpers/${name}`);
    } else {
      result.skipped.push(`.claude/helpers/${name}`);
    }
  }
  guard.flush();
}

/**
 * Write statusline configuration
 */
export async function writeStatusline(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const claudeDir = path.join(targetDir, '.claude');
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source .claude directory (works for npm package and local dev)
  const sourceClaudeDir = findSourceClaudeDir(options.sourceBaseDir);
  const guard = guardFor(targetDir, options, result);

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
          if (guard.copyFile(sourcePath, destPath) === 'kept') continue;
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
  // This must overwrite any copy from writeHelpers() which copies the legacy
  // file — unless the user edited it (the guard keeps it, see file-guard.ts).
  const statuslineScript = generateStatuslineScript(options);
  const statuslinePath = path.join(helpersDir, 'statusline.cjs');

  if (guard.write(statuslinePath, statuslineScript) !== 'kept') {
    result.created.files.push('.claude/helpers/statusline.cjs');
  }
  guard.flush();
}

/**
 * Write CLAUDE.md with swarm guidance
 */

export async function writeClaudeMd(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  const exists = fs.existsSync(claudeMdPath);

  if (exists && !options.force) {
    result.skipped.push('CLAUDE.md');
    return;
  }

  const inferredTemplate =
    !options.components.commands && !options.components.agents ? 'minimal' : undefined;
  const generated = generateClaudeMd(options, inferredTemplate);

  // Confine monomind's own generated body to a delimited block rather than
  // overwriting the whole file — a full overwrite silently destroyed
  // hand-authored project content (Go/Rust/Python-specific instructions,
  // etc.) outside anything monomind itself wrote. See GH #241. This also
  // applies on the very first write so a later `--force` always refreshes
  // just this block instead of duplicating the body.
  const existingContent = exists ? fs.readFileSync(claudeMdPath, 'utf-8') : '';
  const merged = guardFor(targetDir, options, result).mergeBlock(
    claudeMdPath,
    existingContent,
    'claude-md',
    generated,
  );
  if (merged === null) {
    result.skipped.push('CLAUDE.md (edited monomind block kept)');
    return;
  }
  atomicWriteFile(claudeMdPath, merged);
  result.created.files.push('CLAUDE.md');
}
