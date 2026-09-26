/**
 * Kimi Code artifact writers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  atomicWriteFile,
  extractFmName,
  isLikelyUserFile,
  isSafeConversionTarget,
  walkMdFiles,
} from './fs-helpers.js';
import { previouslyGenerated, recordGenerated, retireGeneratedEntry } from './init-manifest.js';
import {
  convertKimiAgentMd,
  convertKimiCommandToFlowSkill,
  convertKimiPluginCommandMd,
  convertKimiSkillMd,
  generateKimiAgentsMd,
  generateKimiGateScript,
  generateKimiMcpJson,
  generateKimiPluginManifest,
  isCatalogStyleRouterCommand,
  kimiCommandFilename,
  mergeKimiMcpJson,
} from './kimi-generator.js';
import type { InitOptions, InitResult } from './types.js';

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
  result: InitResult,
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
  // is converted. The conversion itself is pure (convertClaudeTreeToKimi) so
  // the repo's tree check can run it in memory; this function only decides
  // which destinations are safe to write.
  const claudeDir = path.join(targetDir, '.claude');
  const tree = convertClaudeTreeToKimi(claudeDir);

  const destAgents = path.join(kimiDir, 'agents');
  if (
    tree.agents.size > 0 &&
    isSafeConversionTarget(destAgents, claudeDir, result, '.kimi-code/agents')
  ) {
    fs.mkdirSync(destAgents, { recursive: true });
    for (const [file, content] of tree.agents) {
      atomicWriteFile(path.join(destAgents, file), content);
    }
  }
  const agentCount = tree.agents.size;

  const kimiSkillsRoot = path.join(kimiDir, 'skills');
  const skillsDestSafe = isSafeConversionTarget(
    kimiSkillsRoot,
    claudeDir,
    result,
    '.kimi-code/skills',
  );
  const writtenSkillDirs = new Set<string>();
  let skillCount = 0;
  if (skillsDestSafe) {
    for (const [dir, content] of tree.skills) {
      const destDir = path.join(kimiSkillsRoot, dir);
      fs.mkdirSync(destDir, { recursive: true });
      atomicWriteFile(path.join(destDir, 'SKILL.md'), content);
      writtenSkillDirs.add(dir);
      skillCount++;
    }
    result.skipped.push(...tree.skipped);
  }

  const pluginDir = path.join(kimiDir, 'plugin');
  // Always create plugin/commands/ — the manifest declares ./commands/ and a
  // missing path surfaces as a plugin diagnostic in kimi (e.g. --skip-claude
  // runs where no commands were converted).
  const destPluginCommands = path.join(pluginDir, 'commands');
  fs.mkdirSync(destPluginCommands, { recursive: true });
  const pluginCommandsDestSafe = isSafeConversionTarget(
    destPluginCommands,
    claudeDir,
    result,
    '.kimi-code/plugin/commands',
  );
  const writtenPluginCommands = new Set<string>();
  let commandCount = 0;
  if (pluginCommandsDestSafe) {
    for (const [file, content] of tree.pluginCommands) {
      atomicWriteFile(path.join(destPluginCommands, file), content);
      writtenPluginCommands.add(file);
      commandCount++;
    }
  }

  // Retire stale .kimi-code/skills/ and .kimi-code/plugin/commands/ entries
  // that a PREVIOUS init generated and this run no longer produces (source
  // command renamed or removed upstream). Without this sweep, output here
  // only ever grows — proven live by
  // .kimi-code/plugin/commands/monomind-monomind-monomind-monoswarm-monoswarm.md,
  // a leftover from before the 0529e2708 prefix-stacking fix that survived
  // every subsequent --force run because nothing ever swept it.
  //
  // o-38: the comment this replaces claimed "user-authored skills are never
  // touched: they were never recorded in the manifest, so they can never
  // match a stale-sweep candidate" — true for a whole directory the user
  // created, FALSE for user files inside a directory that WAS recorded,
  // which is exactly the reproduced defect (a note beside a retired skill).
  // retireGeneratedEntry moves the recorded entry instead of deleting it, so
  // a real user file inside survives byte-identical either way.
  const kimiSkillsDir = path.join(kimiDir, 'skills');
  const priorKimiSkills = previouslyGenerated(targetDir, 'kimiSkills');
  if (fs.existsSync(kimiSkillsDir) && skillsDestSafe) {
    for (const existing of fs.readdirSync(kimiSkillsDir)) {
      if (!writtenSkillDirs.has(existing) && priorKimiSkills.has(existing)) {
        retireGeneratedEntry(
          targetDir,
          `kimiSkills/${existing}`,
          path.join(kimiSkillsDir, existing),
          result,
        );
      }
    }
  }
  const retainedKimiSkills = [...priorKimiSkills].filter(
    (n) => !writtenSkillDirs.has(n) && fs.existsSync(path.join(kimiSkillsDir, n)),
  );
  recordGenerated(targetDir, 'kimiSkills', [...writtenSkillDirs, ...retainedKimiSkills]);

  const priorKimiPluginCommands = previouslyGenerated(targetDir, 'kimiPluginCommands');
  if (fs.existsSync(destPluginCommands) && pluginCommandsDestSafe) {
    for (const existing of fs.readdirSync(destPluginCommands)) {
      if (!writtenPluginCommands.has(existing) && priorKimiPluginCommands.has(existing)) {
        retireGeneratedEntry(
          targetDir,
          `kimiPluginCommands/${existing}`,
          path.join(destPluginCommands, existing),
          result,
        );
      }
    }
  }
  const retainedKimiPluginCommands = [...priorKimiPluginCommands].filter(
    (n) => !writtenPluginCommands.has(n) && fs.existsSync(path.join(destPluginCommands, n)),
  );
  recordGenerated(targetDir, 'kimiPluginCommands', [
    ...writtenPluginCommands,
    ...retainedKimiPluginCommands,
  ]);

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
  if (commandCount)
    result.created.files.push(`.kimi-code/plugin/commands/ (${commandCount} commands)`);

  // Kimi's status-line configuration is user-scoped. Project init must not
  // infer consent from an existing ~/.kimi-code directory; it is configured
  // only through the explicit user-scope platform lifecycle command.
}

/**
 * True for a `.claude/commands/` markdown file that is an invocable command.
 * Not commands: READMEs, `_`-prefixed shared includes other commands read
 * (e.g. `mastermind/_repeat.md`, `mastermind/_taskfile.md`) and anything under
 * a `references/` directory (platform tool-mapping notes). Converting those
 * exposed them as slash commands, and `_repeat.md` slugified to the same
 * `mastermind-repeat.md` as the real `repeat.md` — whichever the directory
 * walk returned last silently won.
 */
export function isConvertibleCommand(rel: string): boolean {
  if (!isLikelyUserFile(rel)) return false;
  const segs = rel.split(/[\\/]/);
  if (segs[segs.length - 1].startsWith('_')) return false;
  if (segs.slice(0, -1).includes('references')) return false;
  return true;
}

/** Kimi artifacts derived from one `.claude/` tree, keyed by destination. */
export interface KimiConvertedTree {
  /** `.kimi-code/agents/<file>` → content */
  agents: Map<string, string>;
  /** `.kimi-code/skills/<dir>/SKILL.md` → content (real skills and command flow skills) */
  skills: Map<string, string>;
  /** `.kimi-code/plugin/commands/<file>` → content */
  pluginCommands: Map<string, string>;
  /** Human-readable notes for sources that were deliberately not converted. */
  skipped: string[];
}

/**
 * Convert `<claudeDir>/{agents,skills,commands}` into kimi shape, in memory.
 * Sources are visited in sorted order so the output — including which source
 * wins a name collision — is the same on every machine.
 */
export function convertClaudeTreeToKimi(claudeDir: string): KimiConvertedTree {
  const tree: KimiConvertedTree = {
    agents: new Map(),
    skills: new Map(),
    pluginCommands: new Map(),
    skipped: [],
  };
  const sortedMd = (dir: string) =>
    fs.existsSync(dir) ? walkMdFiles(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [];

  // Agents → <name>.md (flattened, deduped by name; first in sorted order wins)
  const srcAgents = path.join(claudeDir, 'agents');
  for (const rel of sortedMd(srcAgents)) {
    if (!isLikelyUserFile(rel)) continue;
    const src = fs.readFileSync(path.join(srcAgents, rel), 'utf-8');
    const fallback = path.basename(rel, '.md');
    const converted = convertKimiAgentMd(src, fallback);
    const name = extractFmName(converted) || fallback;
    if (tree.agents.has(`${name}.md`)) continue;
    tree.agents.set(`${name}.md`, converted);
  }

  // Skills → <skill>/SKILL.md (same shape)
  const srcSkills = path.join(claudeDir, 'skills');
  for (const rel of sortedMd(srcSkills)) {
    const segs = rel.split(path.sep);
    if (segs.length !== 2 || segs[1] !== 'SKILL.md') continue;
    const src = fs.readFileSync(path.join(srcSkills, rel), 'utf-8');
    tree.skills.set(segs[0], convertKimiSkillMd(src, segs[0]));
  }
  const realSkills = new Set(tree.skills.keys());

  // Commands → TWO outputs from the same source pass:
  //   (a) <cat>-<name>/SKILL.md as type:flow skills — the only project-level
  //       invocable-command mechanism kimi has (/skill:<name>).
  //   (b) plugin/commands/<cat>-<name>.md for the Tier 3 plugin
  //       (/monomind:<name> slash commands once installed).
  const srcCommands = path.join(claudeDir, 'commands');
  for (const rel of sortedMd(srcCommands)) {
    if (!isConvertibleCommand(rel)) continue;
    const segs = rel.split(path.sep);
    const category = segs.length > 1 ? segs[0] : 'monomind';
    const fileBase = path.basename(rel, '.md');
    const src = fs.readFileSync(path.join(srcCommands, rel), 'utf-8');

    const pluginFile = kimiCommandFilename(category, fileBase);
    if (tree.pluginCommands.has(pluginFile)) {
      tree.skipped.push(
        `.claude/commands/${segs.join('/')} (collides with an earlier command on .kimi-code/plugin/commands/${pluginFile} — not converted)`,
      );
      continue;
    }
    tree.pluginCommands.set(pluginFile, convertKimiPluginCommandMd(src, category, fileBase));

    // Flow skill — skipped when a real skill already owns this directory name
    // (real skills win; the plugin command still provides /monomind:<name>),
    // and for a command in the catalog-style router shape (e.g.
    // .claude/commands/mastermind.md) — that shape is reserved for the
    // canonical mastermind/SKILL.md router and must never be duplicated into
    // skills/ as a second, contradicting router.
    const flowSkill = convertKimiCommandToFlowSkill(src, category, fileBase);
    const flowName = extractFmName(flowSkill) || `${category}-${fileBase}`;
    if (isCatalogStyleRouterCommand(src)) {
      tree.skipped.push(
        `.kimi-code/skills/${flowName}/ (catalog-style router command — plugin command only, never a flow skill)`,
      );
    } else if (realSkills.has(flowName)) {
      tree.skipped.push(
        `.kimi-code/skills/${flowName}/ (command flow-skill conflicts with a real skill — plugin command kept)`,
      );
    } else if (tree.skills.has(flowName)) {
      tree.skipped.push(
        `.claude/commands/${segs.join('/')} (collides with an earlier command on .kimi-code/skills/${flowName}/ — flow skill not converted, plugin command kept)`,
      );
    } else {
      tree.skills.set(flowName, flowSkill);
    }
  }
  return tree;
}
