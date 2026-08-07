/**
 * Kimi Code artifact writers.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InitOptions, InitResult } from './types.js';
import { generateKimiMcpJson, mergeKimiMcpJson, generateKimiAgentsMd, generateKimiGateScript, generateKimiPluginManifest, generateKimiStatuslineSh, mergeKimiTuiTomlStatusline, convertKimiAgentMd, convertKimiSkillMd, convertKimiCommandToFlowSkill, convertKimiPluginCommandMd, kimiCommandFilename } from './kimi-generator.js';
import {
  atomicWriteFile,
  walkMdFiles,
  isLikelyUserFile,
  extractFmName,
} from './shared.js';

/**
 * Write Kimi Code artifacts. ADDITIVE — only invoked when
 * `components.kimicode` is set. Never touches .claude/, .gemini/, .opencode/.
 *
 * Tier 1: .kimi-code/mcp.json (merged, never clobbered), AGENTS.md (skip-if-exists),
 *         .kimi-code/{agents,skills}/ converted from the Claude tree.
 * Tier 2: .kimi-code/plugin/hooks/monomind-gate.mjs — stdin/exit-code bridge into
 *         the existing .claude/helpers gate handlers (kimi has no project-level
 *         hooks, so enforcement only activates via the Tier 3 plugin).
 * Tier 3: .kimi-code/plugin/kimi.plugin.json + commands/ — installable via
 *         `/plugins install ./.kimi-code/plugin` for /monomind:* slash commands
 *         and auto-wired hooks.
 */
export async function writeKimiFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const kimiDir = path.join(targetDir, '.kimi-code');

  // .kimi-code/mcp.json — MERGE the monomind server into an existing file;
  // never clobber the user's other servers. Even --force merges (it refreshes
  // the monomind entry only) — a full overwrite would destroy unrelated
  // servers the user configured. Unparseable existing file → skip.
  const mcpJsonPath = path.join(kimiDir, 'mcp.json');
  if (!fs.existsSync(mcpJsonPath)) {
    fs.mkdirSync(kimiDir, { recursive: true });
    atomicWriteFile(mcpJsonPath, generateKimiMcpJson(options));
    result.created.files.push('.kimi-code/mcp.json');
  } else {
    const current = fs.readFileSync(mcpJsonPath, 'utf-8');
    const merged = mergeKimiMcpJson(current, options);
    if (merged === null) {
      result.skipped.push('.kimi-code/mcp.json (unparseable — not touched)');
    } else if (merged !== current) {
      atomicWriteFile(mcpJsonPath, merged);
      result.updated.push('.kimi-code/mcp.json (merged monomind server)');
    } else {
      result.skipped.push('.kimi-code/mcp.json');
    }
  }

  // AGENTS.md — kimi's workspace instructions file. Skip-if-exists, ALWAYS:
  // the opencode target or a hand-written file may already provide one, and
  // under --force the two generators would otherwise flip the file depending
  // on write order. Users who want regeneration delete the file first —
  // same never-clobber spirit as the mcp.json merge above.
  const agentsMdPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath)) {
    atomicWriteFile(agentsMdPath, generateKimiAgentsMd());
    result.created.files.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md');
  }

  // Convert the .claude/{agents,commands,skills} tree that copyAgents/Skills/
  // Commands just wrote into kimi shape — same approach as writeOpencodeFiles:
  // reading from the target .claude/ dir means only the user's selected subset
  // is converted.
  const claudeDir = path.join(targetDir, '.claude');
  let agentCount = 0, commandCount = 0, skillCount = 0;
  const seenAgents = new Set<string>();

  // Agents → .kimi-code/agents/<name>.md (flattened, deduped by name)
  const srcAgents = path.join(claudeDir, 'agents');
  if (fs.existsSync(srcAgents)) {
    const destAgents = path.join(kimiDir, 'agents');
    for (const rel of walkMdFiles(srcAgents)) {
      const abs = path.join(srcAgents, rel);
      if (!isLikelyUserFile(rel)) continue;
      const src = fs.readFileSync(abs, 'utf-8');
      const fallback = path.basename(rel, '.md');
      const converted = convertKimiAgentMd(src, fallback);
      const name = extractFmName(converted) || fallback;
      if (seenAgents.has(name)) continue;
      seenAgents.add(name);
      fs.mkdirSync(destAgents, { recursive: true });
      atomicWriteFile(path.join(destAgents, `${name}.md`), converted);
      agentCount++;
    }
  }

  // Skills → .kimi-code/skills/<name>/SKILL.md (same shape).
  // Track the directory names written here so command flow-skills below never
  // overwrite a REAL skill that happens to share the <category>-<name> slug
  // (e.g. a skill dir "mastermind-debug" vs a command "mastermind/debug.md").
  const writtenSkillDirs = new Set<string>();
  const srcSkills = path.join(claudeDir, 'skills');
  if (fs.existsSync(srcSkills)) {
    for (const rel of walkMdFiles(srcSkills)) {
      const segs = rel.split(path.sep);
      if (segs.length < 2 || segs[segs.length - 1] !== 'SKILL.md') continue;
      const skillName = segs[0];
      const abs = path.join(srcSkills, rel);
      const src = fs.readFileSync(abs, 'utf-8');
      const converted = convertKimiSkillMd(src, skillName);
      const destDir = path.join(kimiDir, 'skills', skillName);
      fs.mkdirSync(destDir, { recursive: true });
      atomicWriteFile(path.join(destDir, 'SKILL.md'), converted);
      writtenSkillDirs.add(skillName);
      skillCount++;
    }
  }

  // Commands → TWO outputs from the same source pass:
  //   (a) .kimi-code/skills/<cat>-<name>/SKILL.md as type:flow skills — the only
  //       project-level invocable-command mechanism kimi has (/skill:<name>).
  //   (b) .kimi-code/plugin/commands/<cat>-<name>.md for the Tier 3 plugin
  //       (/monomind:<name> slash commands once installed).
  const srcCommands = path.join(claudeDir, 'commands');
  const pluginDir = path.join(kimiDir, 'plugin');
  // Always create plugin/commands/ — the manifest declares ./commands/ and a
  // missing path surfaces as a plugin diagnostic in kimi (e.g. --skip-claude
  // runs where no commands were converted).
  const destPluginCommands = path.join(pluginDir, 'commands');
  fs.mkdirSync(destPluginCommands, { recursive: true });
  if (fs.existsSync(srcCommands)) {
    for (const rel of walkMdFiles(srcCommands)) {
      const abs = path.join(srcCommands, rel);
      if (!isLikelyUserFile(rel)) continue;
      const segs = rel.split(path.sep);
      const category = segs.length > 1 ? segs[0] : 'monomind';
      const fileBase = path.basename(rel, '.md');
      const src = fs.readFileSync(abs, 'utf-8');

      // (a) flow skill — skipped when a real skill already owns this directory
      // name (real skills win; the plugin command below still provides the
      // command under /monomind:<name>).
      const flowSkill = convertKimiCommandToFlowSkill(src, category, fileBase);
      const flowName = extractFmName(flowSkill) || `${category}-${fileBase}`;
      if (writtenSkillDirs.has(flowName)) {
        result.skipped.push(`.kimi-code/skills/${flowName}/ (command flow-skill conflicts with a real skill — plugin command kept)`);
      } else {
        const flowDir = path.join(kimiDir, 'skills', flowName);
        fs.mkdirSync(flowDir, { recursive: true });
        atomicWriteFile(path.join(flowDir, 'SKILL.md'), flowSkill);
        writtenSkillDirs.add(flowName);
        skillCount++;
      }

      // (b) plugin command
      const pluginCmd = convertKimiPluginCommandMd(src, category, fileBase);
      fs.mkdirSync(destPluginCommands, { recursive: true });
      atomicWriteFile(path.join(destPluginCommands, kimiCommandFilename(category, fileBase)), pluginCmd);
      commandCount++;
    }
  }

  // Tier 2: hook gate bridge script.
  const hooksDir = path.join(pluginDir, 'hooks');
  const gatePath = path.join(hooksDir, 'monomind-gate.mjs');
  if (!fs.existsSync(gatePath) || options.force) {
    fs.mkdirSync(hooksDir, { recursive: true });
    atomicWriteFile(gatePath, generateKimiGateScript());
    result.created.files.push('.kimi-code/plugin/hooks/monomind-gate.mjs');
  } else {
    result.skipped.push('.kimi-code/plugin/hooks/monomind-gate.mjs');
  }

  // Tier 3: plugin manifest.
  const manifestPath = path.join(pluginDir, 'kimi.plugin.json');
  if (!fs.existsSync(manifestPath) || options.force) {
    fs.mkdirSync(pluginDir, { recursive: true });
    atomicWriteFile(manifestPath, generateKimiPluginManifest(options));
    result.created.files.push('.kimi-code/plugin/kimi.plugin.json');
  } else {
    result.skipped.push('.kimi-code/plugin/kimi.plugin.json');
  }

  if (agentCount) result.created.files.push(`.kimi-code/agents/ (${agentCount} agents)`);
  if (skillCount) result.created.files.push(`.kimi-code/skills/ (${skillCount} skills)`);
  if (commandCount) result.created.files.push(`.kimi-code/plugin/commands/ (${commandCount} commands)`);

  // Statusline — the footer under kimi's chatbox. Lives in the USER's
  // ~/.kimi-code/ (kimi has no project-level statusline config), gated on
  // that directory already existing (i.e. the user actually runs kimi —
  // init must not create global state for non-kimi users). The tui.toml
  // merge never clobbers an existing [status_line].command.
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir) {
    const kimiHome = path.join(homeDir, '.kimi-code');
    if (fs.existsSync(kimiHome)) {
      try {
        const statuslineShPath = path.join(kimiHome, 'statusline.sh');
        if (!fs.existsSync(statuslineShPath) || options.force) {
          atomicWriteFile(statuslineShPath, generateKimiStatuslineSh());
          try { fs.chmodSync(statuslineShPath, 0o755); } catch { /* ignore on Windows */ }
          result.created.files.push('~/.kimi-code/statusline.sh');
        } else {
          result.skipped.push('~/.kimi-code/statusline.sh');
        }

        const tuiTomlPath = path.join(kimiHome, 'tui.toml');
        const relCommand = '~/.kimi-code/statusline.sh';
        const existingToml = fs.existsSync(tuiTomlPath) ? fs.readFileSync(tuiTomlPath, 'utf-8') : '';
        const mergedToml = mergeKimiTuiTomlStatusline(existingToml, relCommand);
        if (mergedToml !== existingToml) {
          atomicWriteFile(tuiTomlPath, mergedToml);
          result.created.files.push('~/.kimi-code/tui.toml ([status_line].command wired)');
        } else {
          result.skipped.push('~/.kimi-code/tui.toml (status_line.command already set)');
        }
      } catch (e) {
        // Best-effort, like the agy global settings — a statusline failure
        // must never fail init.
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
          console.error('[writeKimiFiles] failed to wire kimi statusline:', e);
        }
      }
    }
  }
}
