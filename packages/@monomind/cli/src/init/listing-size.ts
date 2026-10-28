/**
 * How much of Claude Code's skill/command/agent listing an install uses
 * (GH #411). Claude Code lists every skill and command with its description in
 * a budget of about 1% of the context window (~8k chars on a 200k model); past
 * it, descriptions are dropped. Agents are listed separately, in the Agent
 * tool's description, on every request.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFrontmatter } from '../orgrt/skill-library.js';
import { isCommandDoc, isDeprecatedAgent } from './asset-maps.js';
import type { AssetPack } from './packs.js';

/** The skill + command listing budget: ~1% of a 200k-token context, in chars. */
export const LISTING_BUDGET_CHARS = 8000;
/** The agent listing sits in the Agent tool's description, outside that
 *  budget but sent on every request; the default install keeps it to half. */
export const AGENT_LISTING_BUDGET_CHARS = LISTING_BUDGET_CHARS / 2;
/** The most chars a shipped skill, command or agent description may have:
 *  the budget over the ~40 entries a default install lists. Enforced by
 *  scripts/lint-skills.mjs (DESCRIPTION_MAX_CHARS there). */
export const DESCRIPTION_MAX_CHARS = 200;

export interface ListingEntry {
  kind: 'skill' | 'command' | 'agent';
  name: string;
  description: string;
  /** Chars of the listing line: `- name: description\n`. */
  chars: number;
}

export interface ListingSize {
  skills: { count: number; chars: number };
  commands: { count: number; chars: number };
  agents: { count: number; chars: number };
  /** Skills plus commands — the part Claude Code budgets. */
  skillsAndCommandsChars: number;
  entries: ListingEntry[];
}

function listMd(dir: string, base = dir, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listMd(full, base, out);
    else if (e.name.endsWith('.md')) out.push(path.relative(base, full));
  }
  return out.sort();
}

function str(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v.join(' ') : (v ?? '')).trim();
}

/** Description as the listing shows it: frontmatter `description` (plus a
 *  skill's `when_to_use`), else the first non-empty line of the body. */
export function listingDescription(text: string, kind: ListingEntry['kind']): string {
  const { data, body } = parseFrontmatter(text);
  const desc = str(data.description);
  const when = kind === 'skill' ? str(data.when_to_use) : '';
  if (desc) return when ? `${desc} ${when}` : desc;
  const first = body.split('\n').find((l) => l.trim() !== '') ?? '';
  return first.replace(/^#+\s*/, '').trim();
}

function entry(kind: ListingEntry['kind'], name: string, text: string): ListingEntry {
  const description = listingDescription(text, kind);
  return { kind, name, description, chars: `- ${name}: ${description}\n`.length };
}

/** Measure the listing of an installed `.claude/` directory. */
export function measureListing(claudeDir: string): ListingSize {
  const entries: ListingEntry[] = [];
  const skillsDir = path.join(claudeDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir).sort()) {
      const file = path.join(skillsDir, name, 'SKILL.md');
      if (fs.existsSync(file)) entries.push(entry('skill', name, fs.readFileSync(file, 'utf-8')));
    }
  }
  const commandsDir = path.join(claudeDir, 'commands');
  for (const rel of listMd(commandsDir)) {
    const name = rel.replace(/\.md$/, '').split(path.sep).join(':');
    entries.push(entry('command', name, fs.readFileSync(path.join(commandsDir, rel), 'utf-8')));
  }
  const agentsDir = path.join(claudeDir, 'agents');
  for (const rel of listMd(agentsDir)) {
    const text = fs.readFileSync(path.join(agentsDir, rel), 'utf-8');
    const name = str(parseFrontmatter(text).data.name) || path.basename(rel, '.md');
    entries.push(entry('agent', name, text));
  }
  const total = (kind: ListingEntry['kind']) => {
    const of = entries.filter((e) => e.kind === kind);
    return { count: of.length, chars: of.reduce((n, e) => n + e.chars, 0) };
  };
  const skills = total('skill');
  const commands = total('command');
  return {
    skills,
    commands,
    agents: total('agent'),
    skillsAndCommandsChars: skills.chars + commands.chars,
    entries,
  };
}

/**
 * Listing chars a pack adds, read from a source `.claude/` tree (the package's
 * own): skills and commands (the budgeted part) and agents. Directory entries
 * count what init installs from them (no docs, no deprecated agents).
 */
export function packListingChars(
  claudeDir: string,
  pack: AssetPack,
): { skillsAndCommands: number; agents: number } {
  const size = (kind: ListingEntry['kind'], file: string, name: string) =>
    fs.existsSync(file) ? entry(kind, name, fs.readFileSync(file, 'utf-8')).chars : 0;
  const files = (root: string, rel: string): string[] => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    if (!fs.statSync(abs).isDirectory()) return [rel];
    return listMd(abs).map((f) => path.join(rel, f));
  };
  let skillsAndCommands = 0;
  for (const s of pack.skills) {
    skillsAndCommands += size('skill', path.join(claudeDir, 'skills', s, 'SKILL.md'), s);
  }
  const commandsDir = path.join(claudeDir, 'commands');
  for (const rel of pack.commands.flatMap((c) => files(commandsDir, c))) {
    if (isCommandDoc(rel)) continue;
    const name = rel.replace(/\.md$/, '').split(path.sep).join(':');
    skillsAndCommands += size('command', path.join(commandsDir, rel), name);
  }
  let agents = 0;
  const agentsDir = path.join(claudeDir, 'agents');
  for (const rel of pack.agents.flatMap((a) => files(agentsDir, a))) {
    const file = path.join(agentsDir, rel);
    if (isDeprecatedAgent(file)) continue;
    const name = str(parseFrontmatter(fs.readFileSync(file, 'utf-8')).data.name);
    agents += size('agent', file, name || path.basename(rel, '.md'));
  }
  return { skillsAndCommands, agents };
}

/** One-line warning when the skills and commands in `claudeDir` exceed the listing budget, else null. */
export function listingBudgetWarning(claudeDir: string): string | null {
  const chars = measureListing(claudeDir).skillsAndCommandsChars;
  if (chars <= LISTING_BUDGET_CHARS) return null;
  return `Skills and commands take ${chars} chars of Claude Code's listing, over the ~${LISTING_BUDGET_CHARS} it shows before dropping descriptions. \`monomind packs remove <pack>\` to trim.`;
}
