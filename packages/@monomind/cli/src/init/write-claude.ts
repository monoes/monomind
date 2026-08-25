/**
 * Claude Code file writers: settings.json, .mcp.json, helpers, statusline, CLAUDE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateClaudeMd } from './claudemd-generator.js';
import { INIT_FALLBACK_HELPERS } from './helpers-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateSettingsJson } from './settings-generator.js';
import {
  atomicWriteFile,
  findSourceClaudeDir,
  findSourceHelpersDir,
  MAX_EXEC_FILE_BYTES,
} from './shared.js';
import { generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions, InitResult } from './types.js';

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

  if (
    fs.existsSync(settingsPath) &&
    !options.force &&
    fs.statSync(settingsPath).size <= MAX_EXEC_FILE_BYTES
  ) {
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
          (r: string) => !existingAllow.includes(r),
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
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error(
          '[writeSettings] existing settings.json unparseable, overwriting with generated defaults:',
          e,
        );
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
export async function writeMCPConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
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
 * Write CLAUDE.md with swarm guidance
 */

export async function writeClaudeMd(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath) && !options.force) {
    result.skipped.push('CLAUDE.md');
    return;
  }

  const inferredTemplate =
    !options.components.commands && !options.components.agents ? 'minimal' : undefined;
  atomicWriteFile(claudeMdPath, generateClaudeMd(options, inferredTemplate));
  result.created.files.push('CLAUDE.md');
}
