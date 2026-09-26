/**
 * Claude Code file writers: .mcp.json, helpers, statusline, CLAUDE.md
 * (settings.json is written by write-settings.ts, re-exported here).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateClaudeMd } from './claudemd-generator.js';
import { guardFor } from './file-guard.js';
import { atomicWriteFile } from './fs-helpers.js';
import {
  helperFileMode,
  INIT_FALLBACK_HELPERS,
  OBSOLETE_HELPER_NAMES,
} from './helpers-generator.js';
import { generateMCPJson, mergeMCPJson } from './mcp-generator.js';
import { findSourceClaudeDir, findSourceHelpersDir, GENERATED_HELPERS } from './shared.js';
import { generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions, InitResult } from './types.js';

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
  const merged = mergeMCPJson(fs.readFileSync(mcpPath, 'utf-8'), content);
  if (merged === null) {
    result.errors.push('.mcp.json is not a JSON object — left untouched; fix it and re-run init');
    return;
  }
  atomicWriteFile(mcpPath, merged);
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
            fs.chmodSync(destPath, helperFileMode(entry.name));
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
      if (guard.write(filePath, content, helperFileMode(name)) === 'kept') continue;

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

// Split out of this module; re-exported so existing importers keep working.
export { writeSettings } from './write-settings.js';
