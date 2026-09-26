/**
 * What init ships: the skill, command and agent selections per option, the
 * directories it creates, and every name this version ships.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MASTERMIND_SKILLS } from '../mastermind/manifest-data.js';

const CANONICAL_MASTERMIND_SKILLS = MASTERMIND_SKILLS.map((skill) => skill.source);

/**
 * Skills to copy based on configuration
 */
export const SKILLS_MAP: Record<string, string[]> = {
  core: [
    'monoswarm',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'skill-builder',
    'specialagent',
    'monodesign',
    'monomotion',
    'monolean',
    'monolean-audit',
    'monolean-debt',
    'monolean-help',
    // Read by the marketing agents (CRO, email, competitive content) before
    // they deliver copy.
    'stop-slop',
    // The canonical workflow list comes from the manifest. Keep the wildcard
    // for supplementary legacy workflows that continue to ship during M1;
    // copySkills expands and de-duplicates both sources deterministically.
    ...CANONICAL_MASTERMIND_SKILLS,
    'mastermind-*',
  ],
  browser: ['agent-browser-testing'],
  // NOTE: memory-toolkit and github-toolkit are single consolidated skills
  // (not one skill per capability) — see .claude/skills/memory-toolkit and
  // .claude/skills/github-toolkit. The finer-grained names previously listed
  // here (memory-advanced, github-code-review, etc.) never had matching
  // source directories and silently copied nothing.
  memory: ['memory-toolkit'],
  github: ['github-toolkit'],
  advanced: ['agentic-jujutsu', 'performance-analysis'],
};

/**
 * Commands to copy based on configuration
 */
export const COMMANDS_MAP: Record<string, string[]> = {
  core: ['mastermind.md', 'tokens.md', 'monobrowse.md', 'ts.md'],
  agents: ['agents'],
  analysis: ['analysis'],
  automation: ['automation'],
  coordination: ['coordination'],
  github: ['github'],
  monoswarm: ['monoswarm'],
  hooks: ['hooks'],
  mastermind: ['mastermind'],
  memory: ['memory'],
  monitoring: ['monitoring'],
  monograph: ['monograph'],
  monomind: ['mastermind'],
  optimization: ['optimization'],
  pair: ['pair'],
  streamChain: ['stream-chain'],
  training: ['training'],
  truth: ['truth'],
  verify: ['verify'],
  workflows: ['workflows'],
};

/**
 * Agents to copy based on configuration
 */
export const AGENTS_MAP: Record<string, string[]> = {
  academic: ['academic'],
  analysis: ['analysis'],
  architecture: ['architecture'],
  consensus: ['consensus'],
  core: ['core'],
  data: ['data'],
  design: ['design'],
  development: ['development'],
  devops: ['devops'],
  documentation: ['documentation'],
  engineering: ['engineering'],
  gameDevelopment: ['game-development'],
  github: ['github'],
  goal: ['goal'],
  marketing: ['marketing'],
  neural: ['neural'],
  optimization: ['optimization'],
  paidMedia: ['paid-media'],
  payments: ['payments'],
  product: ['product'],
  projectManagement: ['project-management'],
  reasoning: ['reasoning'],
  sales: ['sales'],
  schemas: ['schemas'],
  sona: ['sona'],
  spatialComputing: ['spatial-computing'],
  specialists: ['specialists'],
  specialized: ['specialized'],
  sublinear: ['sublinear'],
  support: ['support'],
  monoswarm: ['monoswarm'],
  templates: ['templates'],
  testing: ['testing'],
};

/**
 * Directory structure to create
 */
export const DIRECTORIES = {
  claude: [
    '.claude',
    '.claude/skills',
    '.claude/commands',
    '.claude/agents',
    '.claude/helpers',
    '.gemini',
    '.gemini/skills',
    '.gemini/rules',
    '.agents',
    '.agents/skills',
  ],
  runtime: [
    '.monomind',
    '.monomind/data',
    '.monomind/logs',
    '.monomind/sessions',
    '.monomind/hooks',
    '.monomind/agents',
    '.monomind/workflows',
  ],
};

/**
 * Every skill name this version ships, across ALL `SKILLS_MAP` sections —
 * unlike the run's `skillsToCopy` selection (filtered by
 * `options.skills.{core,memory,github,browser,advanced,all}`), this ignores
 * what the user asked for THIS run entirely. o-38: the stale sweep must ask
 * "does this version still ship X" and never "did the user select X this
 * run" — the two questions were conflated, so `--minimal` (a documented
 * flag, no upgrade required) deleted every previously-installed skill
 * outside the minimal set, user files inside included. `mastermind-*`
 * expands against `sourceSkillsDir` exactly as `copySkills`'s own expansion
 * does — the two must agree, or a name real to one and not the other would
 * either wrongly survive as "shipped" or wrongly retire as "gone".
 */
export function allShippedSkills(sourceSkillsDir: string): Set<string> {
  const shipped = new Set<string>();
  for (const entry of new Set(Object.values(SKILLS_MAP).flat())) {
    if (!entry.endsWith('*')) {
      shipped.add(entry);
      continue;
    }
    const prefix = entry.slice(0, -1);
    if (!fs.existsSync(sourceSkillsDir)) continue;
    for (const name of fs.readdirSync(sourceSkillsDir)) {
      if (name.startsWith(prefix) && fs.existsSync(path.join(sourceSkillsDir, name, 'SKILL.md'))) {
        shipped.add(name);
      }
    }
  }
  return shipped;
}

/** Every command name this version ships, across ALL `COMMANDS_MAP`
 *  sections — see `allShippedSkills`'s doc comment; `COMMANDS_MAP` has no
 *  glob entries, so this is a plain flatten. */
export function allShippedCommands(): Set<string> {
  return new Set(Object.values(COMMANDS_MAP).flat());
}

/** Every agent category name this version ships, across ALL `AGENTS_MAP`
 *  sections — see `allShippedSkills`'s doc comment; `AGENTS_MAP` has no
 *  glob entries, so this is a plain flatten. */
export function allShippedAgents(): Set<string> {
  return new Set(Object.values(AGENTS_MAP).flat());
}
