/**
 * Opencode artifact writers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { guardFor } from './file-guard.js';
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
  previouslyGenerated,
  recordGenerated,
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
  if (!fs.existsSync(opencodeJsonPath)) {
    atomicWriteFile(opencodeJsonPath, generateOpencodeJson(options));
    result.created.files.push('opencode.json');
  } else if (options.force) {
    // --force merges instead of replacing: every user key and value stays,
    // missing defaults are added, and only monomind's server command is
    // refreshed (e.g. for --pin).
    try {
      const existing = JSON.parse(fs.readFileSync(opencodeJsonPath, 'utf-8'));
      const generated = JSON.parse(generateOpencodeJson(options));
      const merged = mergeJsonDefaults(existing, generated) as Record<string, any>;
      const command = generated.mcp?.monomind?.command;
      if (command && merged.mcp?.monomind) merged.mcp.monomind.command = command;
      atomicWriteFile(opencodeJsonPath, `${JSON.stringify(merged, null, 2)}\n`);
      result.created.files.push('opencode.json (merged)');
    } catch {
      result.errors.push('opencode.json is not valid JSON — left untouched');
    }
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
  const agentsMd =
    !agentsMdExists || options.force
      ? guardFor(targetDir, options, result).mergeBlock(
          agentsMdPath,
          agentsMdExists ? fs.readFileSync(agentsMdPath, 'utf-8') : '',
          'agents-md',
          generateAgentsMd(),
        )
      : null;
  if (agentsMd !== null) {
    atomicWriteFile(agentsMdPath, agentsMd);
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
  // reaches components.opencode=true — verified live). It is regenerated
  // fresh from .claude/skills's CURRENT (already-retired) state on every
  // run, so "not written this run" establishes staleness — but ONLY for
  // entries this mirror generated. It says nothing about a hand-written
  // .opencode/skills/<name>/SKILL.md that never came from .claude at all,
  // and since converted output is always exactly one SKILL.md, such a file
  // is byte-shaped identically to a genuinely-retired entry. Sweeping on
  // staleness alone therefore deleted user-authored skills outright — the
  // same defect class this item exists to fix, one mirror over. So the
  // sweep is gated on provenance like the other three (.claude at
  // copy-assets.ts, .kimi-code at write-kimicode.ts), and an absent
  // manifest section means delete nothing, per readInitManifest's contract.
  const priorOpencodeSkills = previouslyGenerated(targetDir, 'opencodeSkills');
  if (fs.existsSync(destSkillsRoot)) {
    for (const existing of fs.readdirSync(destSkillsRoot)) {
      if (writtenOpencodeSkills.has(existing)) continue;
      if (!priorOpencodeSkills.has(existing)) continue;
      const stalePath = path.join(destSkillsRoot, existing);
      const extraFiles = [...listFilesRecursive(stalePath)].filter((f) => f !== 'SKILL.md');
      if (extraFiles.length > 0) {
        retireGeneratedEntry(targetDir, `opencode-skills/${existing}`, stalePath, result);
      } else {
        fs.rmSync(stalePath, { recursive: true, force: true });
      }
    }
  }

  // Retained entries stay recorded: a prior entry left untouched this run
  // (not regenerated, but still on disk) must keep its provenance, or the
  // next run would read it as user-authored and never clean it up.
  if (skillCount > 0 || priorOpencodeSkills.size > 0) {
    const retainedOpencodeSkills = [...priorOpencodeSkills].filter(
      (n) => !writtenOpencodeSkills.has(n) && fs.existsSync(path.join(destSkillsRoot, n)),
    );
    recordGenerated(targetDir, 'opencodeSkills', [
      ...writtenOpencodeSkills,
      ...retainedOpencodeSkills,
    ]);
  }

  if (agentCount) result.created.files.push(`.opencode/agent/ (${agentCount} agents)`);
  if (commandCount) result.created.files.push(`.opencode/command/ (${commandCount} commands)`);
  if (skillCount) result.created.files.push(`.opencode/skills/ (${skillCount} skills)`);
}

/** `existing` with every key it lacks filled in from `defaults`: objects are
 *  merged recursively, arrays gain the default items they are missing, and
 *  an existing value always wins over a default. */
function mergeJsonDefaults(existing: unknown, defaults: unknown): unknown {
  if (Array.isArray(existing) && Array.isArray(defaults)) {
    const seen = new Set(existing.map((item) => JSON.stringify(item)));
    return [...existing, ...defaults.filter((item) => !seen.has(JSON.stringify(item)))];
  }
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(existing) || !isObject(defaults))
    return existing === undefined ? defaults : existing;
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    merged[key] = key in existing ? mergeJsonDefaults(existing[key], value) : value;
  }
  return merged;
}
