/**
 * Opencode artifact writers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  convertAgentMd,
  convertCommandMd,
  convertSkillMd,
  generateAgentsMd,
  generateHooksPlugin,
  generateOpencodeJson,
  generateStatusCommand,
  opencodeCommandFilename,
} from './opencode-generator.js';
import {
  atomicWriteFile,
  extractFmName,
  isLikelyUserFile,
  isSafeConversionTarget,
  listFilesRecursive,
  mergeGeneratedBlock,
  retireGeneratedEntry,
  walkMdFiles,
} from './shared.js';
import type { InitOptions, InitResult } from './types.js';

/**
 * Write opencode artifacts. ADDITIVE — only invoked when
 * `components.opencode` is set. Never touches .claude/ or .gemini/.
 *
 * Tier 1: opencode.json (MCP server + permissions + instructions).
 * Tier 2 (added next): AGENTS.md + .opencode/{agent,command,skills}/ converted
 * from the Claude tree.
 */
export async function writeOpencodeFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  // opencode.json — write only if absent (or --force). Never clobber a user's
  // hand-written config; mirror writeGeminiFiles' skip-if-exists policy.
  const opencodeJsonPath = path.join(targetDir, 'opencode.json');
  if (!fs.existsSync(opencodeJsonPath) || options.force) {
    atomicWriteFile(opencodeJsonPath, generateOpencodeJson(options));
    result.created.files.push('opencode.json');
  } else {
    result.skipped.push('opencode.json');
  }

  // AGENTS.md — opencode's instructions file (CLAUDE.md equivalent). A raw
  // `--force` overwrite silently destroyed hand-authored project guidance:
  // AGENTS.md is a file projects own and write themselves, and none of the
  // backups init takes held the pre-init text. See GH #278. Route it through
  // the same managed-block primitive writeClaudeMd uses, so a refresh only
  // ever touches monomind's own block — applied on the first write too, so
  // later runs replace in place instead of appending, and a body left
  // unwrapped by an older version is migrated rather than duplicated.
  const agentsMdPath = path.join(targetDir, 'AGENTS.md');
  const agentsMdExists = fs.existsSync(agentsMdPath);
  if (!agentsMdExists || options.force) {
    const existing = agentsMdExists ? fs.readFileSync(agentsMdPath, 'utf-8') : '';
    atomicWriteFile(agentsMdPath, mergeGeneratedBlock(existing, 'agents-md', generateAgentsMd()));
    result.created.files.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md');
  }

  // Hook-shim plugin (Tier 3) — bridges monomind's gate handlers into
  // opencode's tool.execute.before. .opencode/plugins/ (plural) per opencode docs.
  const pluginDir = path.join(targetDir, '.opencode', 'plugins');
  const pluginPath = path.join(pluginDir, 'monomind-hooks.ts');
  if (!fs.existsSync(pluginPath) || options.force) {
    fs.mkdirSync(pluginDir, { recursive: true });
    atomicWriteFile(pluginPath, generateHooksPlugin());
    result.created.files.push('.opencode/plugins/monomind-hooks.ts');
  } else {
    result.skipped.push('.opencode/plugins/monomind-hooks.ts');
  }

  // /monomind-status command — the opencode equivalent of the Claude Code
  // statusline (opencode has no custom statusbar UI). Runs statusline.cjs
  // unchanged and reports a formatted summary.
  const statusCmdPath = path.join(targetDir, '.opencode', 'command', 'monomind-status.md');
  if (!fs.existsSync(statusCmdPath) || options.force) {
    fs.mkdirSync(path.dirname(statusCmdPath), { recursive: true });
    atomicWriteFile(statusCmdPath, generateStatusCommand());
    result.created.files.push('.opencode/command/monomind-status.md');
  } else {
    result.skipped.push('.opencode/command/monomind-status.md');
  }

  // Convert the .claude/{agents,commands,skills} tree that copyAgents/Skills/
  // Commands just wrote into opencode shape. Reading from the target .claude/
  // dir (not the package source) means only the user's selected subset is
  // converted, and we never re-implement the MAP filtering logic.
  const claudeDir = path.join(targetDir, '.claude');
  let agentCount = 0,
    commandCount = 0,
    skillCount = 0;
  const seenAgents = new Set<string>();

  // Agents → .opencode/agent/<name>.md (flattened, deduped by name)
  const srcAgents = path.join(claudeDir, 'agents');
  if (fs.existsSync(srcAgents)) {
    const destAgents = path.join(targetDir, '.opencode', 'agent');
    if (isSafeConversionTarget(destAgents, claudeDir, result, '.opencode/agent')) {
      for (const rel of walkMdFiles(srcAgents)) {
        const abs = path.join(srcAgents, rel);
        if (!isLikelyUserFile(rel)) continue; // skip READMEs etc.
        const src = fs.readFileSync(abs, 'utf-8');
        const fallback = path.basename(rel, '.md');
        const converted = convertAgentMd(src, fallback);
        const name = extractFmName(converted) || fallback;
        if (seenAgents.has(name)) continue;
        seenAgents.add(name);
        fs.mkdirSync(destAgents, { recursive: true });
        atomicWriteFile(path.join(destAgents, `${name}.md`), converted);
        agentCount++;
      }
    }
  }

  // Commands → .opencode/command/<category>-<name>.md (namespace preserved)
  const srcCommands = path.join(claudeDir, 'commands');
  if (fs.existsSync(srcCommands)) {
    const destCommands = path.join(targetDir, '.opencode', 'command');
    if (isSafeConversionTarget(destCommands, claudeDir, result, '.opencode/command')) {
      for (const rel of walkMdFiles(srcCommands)) {
        const abs = path.join(srcCommands, rel);
        if (!isLikelyUserFile(rel)) continue;
        const segs = rel.split(path.sep);
        const category = segs.length > 1 ? segs[0] : 'monomind';
        const fileBase = path.basename(rel, '.md');
        const src = fs.readFileSync(abs, 'utf-8');
        const converted = convertCommandMd(src, category, fileBase);
        fs.mkdirSync(destCommands, { recursive: true });
        atomicWriteFile(
          path.join(destCommands, opencodeCommandFilename(category, fileBase)),
          converted,
        );
        commandCount++;
      }
    }
  }

  // Skills → .opencode/skills/<name>/SKILL.md (same shape)
  const srcSkills = path.join(claudeDir, 'skills');
  const destSkillsRoot = path.join(targetDir, '.opencode', 'skills');
  const writtenOpencodeSkills = new Set<string>();
  if (fs.existsSync(srcSkills)) {
    if (isSafeConversionTarget(destSkillsRoot, claudeDir, result, '.opencode/skills')) {
      for (const rel of walkMdFiles(srcSkills)) {
        // rel looks like "<skillName>/SKILL.md"
        const segs = rel.split(path.sep);
        if (segs.length < 2 || segs[segs.length - 1] !== 'SKILL.md') continue;
        const skillName = segs[0];
        const abs = path.join(srcSkills, rel);
        const src = fs.readFileSync(abs, 'utf-8');
        const converted = convertSkillMd(src, skillName);
        const destDir = path.join(destSkillsRoot, skillName);
        fs.mkdirSync(destDir, { recursive: true });
        atomicWriteFile(path.join(destDir, 'SKILL.md'), converted);
        writtenOpencodeSkills.add(skillName);
        skillCount++;
      }
    }
  }

  // o-38 revision: .opencode/skills is a DEFAULT mirror (a plain `init`
  // reaches components.opencode=true — verified live), but unlike
  // .gemini/.agents it has no manifest section of its own, and unlike
  // .kimi-code it is regenerated fresh from .claude/skills's CURRENT
  // (already-retired) state on every run — so "not in writtenOpencodeSkills
  // this run" is already the correct staleness signal, no manifest needed.
  // Converted output is always exactly one SKILL.md per skill, so an entry
  // holding anything else was added directly inside the mirror and is
  // retired rather than deleted, same rule as the .gemini/.agents sweep.
  if (fs.existsSync(destSkillsRoot)) {
    for (const existing of fs.readdirSync(destSkillsRoot)) {
      if (writtenOpencodeSkills.has(existing)) continue;
      const stalePath = path.join(destSkillsRoot, existing);
      const extraFiles = [...listFilesRecursive(stalePath)].filter((f) => f !== 'SKILL.md');
      if (extraFiles.length > 0) {
        retireGeneratedEntry(targetDir, `opencode-skills/${existing}`, stalePath, result);
      } else {
        fs.rmSync(stalePath, { recursive: true, force: true });
      }
    }
  }

  if (agentCount) result.created.files.push(`.opencode/agent/ (${agentCount} agents)`);
  if (commandCount) result.created.files.push(`.opencode/command/ (${commandCount} commands)`);
  if (skillCount) result.created.files.push(`.opencode/skills/ (${skillCount} skills)`);
}
