/**
 * Antigravity (agy) / Gemini integration file writers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { guardFor } from './file-guard.js';
import { atomicWriteFile } from './fs-helpers.js';
import {
  generateGeminiMd,
  generateGeminiRulesMd,
  generateStatuslineSh,
} from './geminimd-generator.js';
import { findSourceHelpersDir, GENERATED_HELPERS, MAX_EXEC_FILE_BYTES } from './shared.js';
import type { InitOptions, InitResult } from './types.js';

/**
 * Write Antigravity (agy) integration files:
 *   GEMINI.md                       — agent instructions read by agy
 *   .gemini/rules/monomind.md       — workflow rules file
 *   .gemini/helpers/statusline.sh   — shell wrapper for the agy status bar
 *   .gemini/helpers/*               — helper tree it runs, if writeHelpers did not copy it
 *   .gemini/settings.json           — wires the statusline command into agy
 */
export async function writeGeminiFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  // GEMINI.md — monomind's body lives in a managed block, like CLAUDE.md, so
  // --force refreshes that block and keeps the project's own text around it.
  const geminiMdPath = path.join(targetDir, 'GEMINI.md');
  const geminiMdExists = fs.existsSync(geminiMdPath);
  const geminiMd =
    !geminiMdExists || options.force
      ? guardFor(targetDir, options, result).mergeBlock(
          geminiMdPath,
          geminiMdExists ? fs.readFileSync(geminiMdPath, 'utf-8') : '',
          'gemini-md',
          generateGeminiMd(options),
        )
      : null;
  if (geminiMd !== null) {
    atomicWriteFile(geminiMdPath, geminiMd);
    result.created.files.push('GEMINI.md');
  } else {
    result.skipped.push('GEMINI.md');
  }

  // .gemini/rules/monomind.md
  const geminiRulesDir = path.join(targetDir, '.gemini', 'rules');
  fs.mkdirSync(geminiRulesDir, { recursive: true });
  const rulesPath = path.join(geminiRulesDir, 'monomind.md');
  if (!fs.existsSync(rulesPath) || options.force) {
    atomicWriteFile(rulesPath, generateGeminiRulesMd(options));
    result.created.files.push('.gemini/rules/monomind.md');
  } else {
    result.skipped.push('.gemini/rules/monomind.md');
  }

  // .gemini/helpers/statusline.sh
  const geminiHelpersDir = path.join(targetDir, '.gemini', 'helpers');
  fs.mkdirSync(geminiHelpersDir, { recursive: true });

  // statusline.sh runs .gemini/helpers/statusline.cjs (which requires
  // ./utils/). writeHelpers mirrors the helper tree here when the helpers
  // component is on; when it is off (e.g. `--target antigravity` alone), copy
  // the same tree here so the status bar works — into .gemini/helpers only,
  // so no Claude helpers or hooks are installed.
  const sourceHelpersDir = findSourceHelpersDir(options.sourceBaseDir);
  if (!options.components.helpers && sourceHelpersDir) {
    fs.cpSync(sourceHelpersDir, geminiHelpersDir, {
      recursive: true,
      force: options.force === true,
      filter: (src) => {
        const name = path.basename(src);
        return !name.startsWith('._') && !GENERATED_HELPERS.has(name);
      },
    });
    result.created.files.push('.gemini/helpers/ (helper tree for the status bar)');
  }
  const statuslineShPath = path.join(geminiHelpersDir, 'statusline.sh');
  if (!fs.existsSync(statuslineShPath) || options.force) {
    atomicWriteFile(statuslineShPath, generateStatuslineSh());
    try {
      fs.chmodSync(statuslineShPath, 0o755);
    } catch {
      /* ignore on Windows */
    }
    result.created.files.push('.gemini/helpers/statusline.sh');
  } else {
    result.skipped.push('.gemini/helpers/statusline.sh');
  }

  // .gemini/settings.json — only write if not already present (user may have
  // their own agy settings; never clobber on force either — we only add to it)
  const geminiSettingsPath = path.join(targetDir, '.gemini', 'settings.json');
  try {
    let existing: Record<string, unknown> = {};
    if (
      fs.existsSync(geminiSettingsPath) &&
      fs.statSync(geminiSettingsPath).size <= MAX_EXEC_FILE_BYTES
    ) {
      existing = JSON.parse(fs.readFileSync(geminiSettingsPath, 'utf-8'));
    }
    if (!existing.statusLine) {
      existing.statusLine = { type: 'command', command: '.gemini/helpers/statusline.sh' };
      atomicWriteFile(geminiSettingsPath, JSON.stringify(existing, null, 2));
      result.created.files.push('.gemini/settings.json (statusLine wired)');
    } else {
      result.skipped.push('.gemini/settings.json (statusLine already configured)');
    }
  } catch (e) {
    result.errors.push(
      `writeGeminiFiles: failed to write .gemini/settings.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Project init is project-scoped. User-level Antigravity settings belong to
  // the explicit `platforms install --scope user --yes` lifecycle, where the
  // requested scope and consent are both recorded. In particular, do not
  // mutate an existing ~/.gemini/antigravity-cli installation merely because
  // this project selected Antigravity.
}
