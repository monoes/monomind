/**
 * Claude Code file writers: settings.json, .mcp.json, helpers, statusline, CLAUDE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InitOptions, InitResult } from './types.js';
import { generateSettingsJson } from './settings-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateStatuslineScript } from './statusline-generator.js';
import {
  INIT_FALLBACK_HELPERS,
} from './helpers-generator.js';
import { generateClaudeMd } from './claudemd-generator.js';
import {
  atomicWriteFile,
  findSourceHelpersDir,
  findSourceClaudeDir,
  MAX_EXEC_FILE_BYTES,
} from './shared.js';

/**
 * Write settings.json
 */
export async function writeSettings(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const generated = JSON.parse(generateSettingsJson(options));

  if (fs.existsSync(settingsPath) && !options.force && fs.statSync(settingsPath).size <= MAX_EXEC_FILE_BYTES) {
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
    } catch (e) {
      // Existing file is corrupt — overwrite
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeSettings] existing settings.json unparseable, overwriting with generated defaults:', e);
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
 * Write helper scripts
 */
export async function writeHelpers(
  targetDir: string,
  options: InitOptions,
  result: InitResult
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
      'Key tools: memory_pattern-store, memory_pattern-search, hooks_route, swarm_init, agent_spawn.',
      '**Code navigation**: ALWAYS call `mcp__monomind__monograph_query` BEFORE grep/rg/find for code exploration — it returns file path + line number from a pre-built knowledge graph. Call `mcp__monomind__monograph_suggest` with a task description for multi-file tasks. Only fall back to grep if monograph returns 0 results or the DB is not built.',
      'Check system-reminder tags for [INTELLIGENCE] pattern suggestions and [MONOGRAPH] context before starting work.',
      '',
    ].join('\n');

    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      if (fs.existsSync(globalClaudeMd) && fs.statSync(globalClaudeMd).size <= MAX_EXEC_FILE_BYTES) {
        const existing = fs.readFileSync(globalClaudeMd, 'utf-8');
        if (!existing.includes('Monomind Integration')) {
          fs.appendFileSync(globalClaudeMd, monomindBlock);
          result.created.files.push('~/.claude/CLAUDE.md (appended monomind block)');
        } else if (!existing.includes('monograph_query')) {
          // Upgrade existing block to include monograph instructions
          const updated = existing.replace(
            /# Monomind Integration[^\n]*\n(?:(?!^#).+\n)*/m,
            monomindBlock.trimStart() + '\n',
          );
          atomicWriteFile(globalClaudeMd, updated);
          result.created.files.push('~/.claude/CLAUDE.md (upgraded monomind block)');
        }
      } else {
        atomicWriteFile(globalClaudeMd, monomindBlock.trimStart());
        result.created.files.push('~/.claude/CLAUDE.md');
      }
    } catch (e) {
      // Non-critical — global CLAUDE.md is best-effort
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeClaudeMd] failed to write/append ~/.claude/CLAUDE.md:', e);
    }

    // Also inject the token-display hook into ~/.claude/settings.json
    const globalSettingsPath = path.join(globalClaudeDir, 'settings.json');
    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      let globalSettings: Record<string, unknown> = {};
      if (fs.existsSync(globalSettingsPath) && fs.statSync(globalSettingsPath).size <= MAX_EXEC_FILE_BYTES) {
        try {
          globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf-8'));
        } catch (e) {
          // malformed JSON — start fresh
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeClaudeMd] ~/.claude/settings.json unparseable, starting fresh:', e);
        }
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
    } catch (e) {
      // Non-critical — global settings hook is best-effort
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[writeClaudeMd] failed to inject token hook into ~/.claude/settings.json:', e);
    }
  }
}
