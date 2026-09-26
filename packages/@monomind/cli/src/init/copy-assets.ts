/**
 * Asset copy functions: skills, commands, agents.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AGENTS_MAP,
  allShippedAgents,
  allShippedCommands,
  allShippedSkills,
  COMMANDS_MAP,
  SKILLS_MAP,
} from './asset-maps.js';
import { guardFor } from './file-guard.js';
import { countFiles, listFilesRecursive } from './fs-helpers.js';
import { previouslyGenerated, recordGenerated, retireGeneratedEntry } from './init-manifest.js';
import { findSourceDir } from './shared.js';
import type { InitOptions, InitResult } from './types.js';

/**
 * Copy skills from source
 */
export async function copySkills(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const skillsConfig = options.skills;
  const targetSkillsDir = path.join(targetDir, '.claude', 'skills');

  // Determine which skills to copy
  const skillsToCopy: string[] = [];

  if (skillsConfig.all) {
    // Copy all available skills
    Object.values(SKILLS_MAP).forEach((skills) => skillsToCopy.push(...skills));
  } else {
    if (skillsConfig.core) skillsToCopy.push(...SKILLS_MAP.core);
    if (skillsConfig.memory) skillsToCopy.push(...SKILLS_MAP.memory);
    if (skillsConfig.github) skillsToCopy.push(...SKILLS_MAP.github);
    if (skillsConfig.browser) skillsToCopy.push(...SKILLS_MAP.browser);
    if (skillsConfig.advanced) skillsToCopy.push(...SKILLS_MAP.advanced);
  }

  // Find source skills directory
  const sourceSkillsDir = findSourceDir('skills', options.sourceBaseDir);
  if (!sourceSkillsDir) {
    result.errors.push('Could not find source skills directory');
    return;
  }

  // Expand glob-style entries ('mastermind-*') against the source tree.
  // Only directories that actually contain a SKILL.md count — this also
  // filters exFAT AppleDouble junk (._mastermind-…).
  for (const entry of skillsToCopy.filter((e) => e.endsWith('*'))) {
    const prefix = entry.slice(0, -1);
    skillsToCopy.splice(skillsToCopy.indexOf(entry), 1);
    skillsToCopy.push(
      ...fs
        .readdirSync(sourceSkillsDir)
        .filter(
          (n) => n.startsWith(prefix) && fs.existsSync(path.join(sourceSkillsDir, n, 'SKILL.md')),
        ),
    );
  }

  // Retire skill directories that this version no longer ships ANYWHERE —
  // not "the user didn't select this run". o-38: the sweep used to compare
  // against `knownSkills` (this run's selection, filtered by
  // options.skills.{core,memory,github,browser,advanced,all}), so a
  // documented flag like `--minimal` deleted every previously-installed
  // skill outside the minimal set — no version skew needed. The correct
  // comparison is the full shipped catalogue: a skill still shipped but
  // merely not selected this run is left completely alone (no retire, no
  // delete, no mirror change); only a name absent from every SKILLS_MAP
  // section — genuinely dropped upstream — is stale. Entries init never
  // wrote at all (user-authored skills, skills installed by other tools)
  // are left untouched either way — see readInitManifest.
  const knownSkills = new Set([...new Set(skillsToCopy)]);
  const shippedSkills = allShippedSkills(sourceSkillsDir);
  const priorSkills = previouslyGenerated(targetDir, 'skills');
  if (fs.existsSync(targetSkillsDir)) {
    for (const existing of fs.readdirSync(targetSkillsDir)) {
      if (shippedSkills.has(existing) || !priorSkills.has(existing)) continue;
      const stalePath = path.join(targetSkillsDir, existing);
      // Capture the .claude copy's own file list before retiring it, so the
      // mirror sweep below can tell regenerated content from a file added
      // directly inside a mirror.
      const claudeFiles = listFilesRecursive(stalePath);
      retireGeneratedEntry(targetDir, `skills/${existing}`, stalePath, result);

      // o-38 §2·0b: mirrors are regenerated from source every run and hold
      // no user content by construction, so a genuinely retired skill is
      // DELETED from them outright, not retired — otherwise it stays
      // advertised on two other platforms after disappearing from
      // .claude/skills. If a mirror is found to hold a file the .claude
      // copy did not, retire it too rather than deleting (same rule).
      for (const [mirrorLabel, mirrorSkillsDir] of [
        ['gemini-skills', path.join(targetDir, '.gemini', 'skills')],
        ['agents-skills', path.join(targetDir, '.agents', 'skills')],
      ] as const) {
        const mirrorPath = path.join(mirrorSkillsDir, existing);
        if (!fs.existsSync(mirrorPath)) continue;
        const mirrorHasExtra = [...listFilesRecursive(mirrorPath)].some((f) => !claudeFiles.has(f));
        if (mirrorHasExtra) {
          retireGeneratedEntry(targetDir, `${mirrorLabel}/${existing}`, mirrorPath, result);
        } else {
          fs.rmSync(mirrorPath, { recursive: true, force: true });
        }
      }
    }
  }

  // Copy every selected skill so new version content lands — through the
  // guard, which keeps any shipped file the user edited (file-guard.ts).
  const guard = guardFor(targetDir, options, result);
  const writtenSkills: string[] = [];
  for (const skillName of knownSkills) {
    const sourcePath = path.join(sourceSkillsDir, skillName);
    const targetPath = path.join(targetSkillsDir, skillName);

    if (fs.existsSync(sourcePath)) {
      // Deliberately NOT rmSync'd first. copyDirRecursive overwrites every
      // file it ships, so wiping the directory adds nothing except destroying
      // anything the user put inside it — notes beside a shipped skill, an
      // extra command in a shipped folder. `init --force` did exactly that.
      // The cost of not wiping is that a file removed from a newer version
      // lingers; the cost of wiping is silent data loss, which is worse.
      guard.copyDir(sourcePath, targetPath);
      writtenSkills.push(skillName);
      result.created.files.push(`.claude/skills/${skillName}`);
      result.summary.skillsCount++;
    } else {
      // A skill referenced in SKILLS_MAP has no matching source directory —
      // surface this instead of silently copying nothing, so drift between
      // SKILLS_MAP and the actual .claude/skills/ tree gets caught.
      result.errors.push(
        `Skill '${skillName}' listed in SKILLS_MAP has no source directory at ${sourcePath} — skipped`,
      );
    }
  }

  // Record provenance so the next run can distinguish "we wrote this" from
  // "the user wrote this". Keep entries this run did not re-write but that a
  // previous run generated and that still exist, so provenance is not lost
  // when a section is partially skipped.
  const retainedSkills = [...priorSkills].filter(
    (n) => !writtenSkills.includes(n) && fs.existsSync(path.join(targetSkillsDir, n)),
  );
  recordGenerated(targetDir, 'skills', [...writtenSkills, ...retainedSkills]);

  // Mirror written skills to .gemini/skills/ and .agents/skills/ (#100)
  const mirrorDirs = [
    path.join(targetDir, '.gemini', 'skills'),
    path.join(targetDir, '.agents', 'skills'),
  ];
  for (const mirrorDir of mirrorDirs) {
    fs.mkdirSync(mirrorDir, { recursive: true });
    for (const skillName of writtenSkills) {
      const sourcePath = path.join(sourceSkillsDir, skillName);
      if (fs.existsSync(sourcePath)) {
        guard.copyDir(sourcePath, path.join(mirrorDir, skillName));
      }
    }
  }
  guard.flush();
}

/**
 * Copy commands from source
 */
export async function copyCommands(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const commandsConfig = options.commands;
  const targetCommandsDir = path.join(targetDir, '.claude', 'commands');

  // Determine which commands to copy
  const commandsToCopy: string[] = [];

  if (commandsConfig.all) {
    Object.values(COMMANDS_MAP).forEach((cmds) => commandsToCopy.push(...cmds));
  } else {
    if (commandsConfig.core) commandsToCopy.push(...COMMANDS_MAP.core);
    if (commandsConfig.agents) commandsToCopy.push(...(COMMANDS_MAP.agents || []));
    if (commandsConfig.analysis) commandsToCopy.push(...COMMANDS_MAP.analysis);
    if (commandsConfig.automation) commandsToCopy.push(...COMMANDS_MAP.automation);
    if (commandsConfig.coordination) commandsToCopy.push(...(COMMANDS_MAP.coordination || []));
    if (commandsConfig.github) commandsToCopy.push(...COMMANDS_MAP.github);
    if (commandsConfig.monoswarm) commandsToCopy.push(...(COMMANDS_MAP.monoswarm || []));
    if (commandsConfig.hooks) commandsToCopy.push(...COMMANDS_MAP.hooks);
    if (commandsConfig.mastermind) commandsToCopy.push(...(COMMANDS_MAP.mastermind || []));
    if (commandsConfig.memory) commandsToCopy.push(...(COMMANDS_MAP.memory || []));
    if (commandsConfig.monitoring) commandsToCopy.push(...COMMANDS_MAP.monitoring);
    if (commandsConfig.monograph) commandsToCopy.push(...(COMMANDS_MAP.monograph || []));
    if (commandsConfig.monomind) commandsToCopy.push(...(COMMANDS_MAP.monomind || []));
    if (commandsConfig.optimization) commandsToCopy.push(...COMMANDS_MAP.optimization);
    if (commandsConfig.pair) commandsToCopy.push(...(COMMANDS_MAP.pair || []));
    if (commandsConfig.streamChain) commandsToCopy.push(...(COMMANDS_MAP.streamChain || []));
    if (commandsConfig.training) commandsToCopy.push(...(COMMANDS_MAP.training || []));
    if (commandsConfig.truth) commandsToCopy.push(...(COMMANDS_MAP.truth || []));
    if (commandsConfig.verify) commandsToCopy.push(...(COMMANDS_MAP.verify || []));
    if (commandsConfig.workflows) commandsToCopy.push(...(COMMANDS_MAP.workflows || []));
  }

  // Find source commands directory
  const sourceCommandsDir = findSourceDir('commands', options.sourceBaseDir);
  if (!sourceCommandsDir) {
    result.errors.push('Could not find source commands directory');
    return;
  }

  // Retire command files/directories that this version no longer ships
  // ANYWHERE — see copySkills's doc comment for why this compares against
  // the full shipped catalogue rather than `knownCommands` (this run's
  // selection). User-authored commands are never touched either way.
  const knownCommands = new Set([...new Set(commandsToCopy)]);
  const shippedCommands = allShippedCommands();
  const priorCommands = previouslyGenerated(targetDir, 'commands');
  if (fs.existsSync(targetCommandsDir)) {
    for (const existing of fs.readdirSync(targetCommandsDir)) {
      if (!shippedCommands.has(existing) && priorCommands.has(existing)) {
        const stalePath = path.join(targetCommandsDir, existing);
        retireGeneratedEntry(targetDir, `commands/${existing}`, stalePath, result);
      }
    }
  }

  // Copy every selected command, keeping the ones the user edited (see copySkills).
  const guard = guardFor(targetDir, options, result);
  const writtenCommands: string[] = [];
  for (const cmdName of knownCommands) {
    const sourcePath = path.join(sourceCommandsDir, cmdName);
    const targetPath = path.join(targetCommandsDir, cmdName);

    if (fs.existsSync(sourcePath)) {
      // No pre-copy rmSync — see the note in copySkills. Both branches below
      // overwrite what they ship, so wiping first only destroys files the user
      // added inside a shipped command directory.
      if (fs.statSync(sourcePath).isDirectory()) {
        guard.copyDir(sourcePath, targetPath);
      } else {
        guard.copyFile(sourcePath, targetPath);
      }
      writtenCommands.push(cmdName);
      result.created.files.push(`.claude/commands/${cmdName}`);
      result.summary.commandsCount++;
    }
  }

  const retainedCommands = [...priorCommands].filter(
    (n) => !writtenCommands.includes(n) && fs.existsSync(path.join(targetCommandsDir, n)),
  );
  recordGenerated(targetDir, 'commands', [...writtenCommands, ...retainedCommands]);
  guard.flush();
}

/**
 * Copy agents from source
 */
export async function copyAgents(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const agentsConfig = options.agents;
  const targetAgentsDir = path.join(targetDir, '.claude', 'agents');

  // Determine which agents to copy
  const agentsToCopy: string[] = [];

  if (agentsConfig.all) {
    Object.values(AGENTS_MAP).forEach((agents) => agentsToCopy.push(...agents));
  } else {
    if (agentsConfig.core) agentsToCopy.push(...AGENTS_MAP.core);
    if (agentsConfig.consensus) agentsToCopy.push(...AGENTS_MAP.consensus);
    if (agentsConfig.github) agentsToCopy.push(...AGENTS_MAP.github);
    if (agentsConfig.monoswarm) agentsToCopy.push(...AGENTS_MAP.monoswarm);
    if (agentsConfig.optimization) agentsToCopy.push(...(AGENTS_MAP.optimization || []));
    if (agentsConfig.testing) agentsToCopy.push(...(AGENTS_MAP.testing || []));
  }

  // Find source agents directory
  const sourceAgentsDir = findSourceDir('agents', options.sourceBaseDir);
  if (!sourceAgentsDir) {
    result.errors.push('Could not find source agents directory');
    return;
  }

  // Retire agent category directories that this version no longer ships
  // ANYWHERE — see copySkills's doc comment for why this compares against
  // the full shipped catalogue rather than `knownAgents` (this run's
  // selection). User-authored agent dirs are never touched either way.
  const knownAgents = new Set([...new Set(agentsToCopy)]);
  const shippedAgents = allShippedAgents();
  const priorAgents = previouslyGenerated(targetDir, 'agents');
  if (fs.existsSync(targetAgentsDir)) {
    for (const existing of fs.readdirSync(targetAgentsDir)) {
      if (!shippedAgents.has(existing) && priorAgents.has(existing)) {
        const stalePath = path.join(targetAgentsDir, existing);
        retireGeneratedEntry(targetDir, `agents/${existing}`, stalePath, result);
      }
    }
  }

  // Copy every selected agent category, keeping the files the user edited (see copySkills).
  const guard = guardFor(targetDir, options, result);
  const writtenAgents: string[] = [];
  for (const agentCategory of knownAgents) {
    const sourcePath = path.join(sourceAgentsDir, agentCategory);
    const targetPath = path.join(targetAgentsDir, agentCategory);

    if (fs.existsSync(sourcePath)) {
      // Deliberately NOT rmSync'd first. copyDirRecursive overwrites every
      // file it ships, so wiping the directory adds nothing except destroying
      // anything the user put inside it — notes beside a shipped skill, an
      // extra command in a shipped folder. `init --force` did exactly that.
      // The cost of not wiping is that a file removed from a newer version
      // lingers; the cost of wiping is silent data loss, which is worse.
      guard.copyDir(sourcePath, targetPath);
      // Count agent files (.md only — .yaml agents were migrated to .md)
      const mdFiles = countFiles(sourcePath, '.md');
      result.summary.agentsCount += mdFiles;
      writtenAgents.push(agentCategory);
      result.created.files.push(`.claude/agents/${agentCategory}`);
    }
  }

  const retainedAgents = [...priorAgents].filter(
    (n) => !writtenAgents.includes(n) && fs.existsSync(path.join(targetAgentsDir, n)),
  );
  recordGenerated(targetDir, 'agents', [...writtenAgents, ...retainedAgents]);
  guard.flush();
}
