/**
 * The two per-project routing indexes `init` and `init upgrade` build once
 * every file is written: the agent registry (.monomind/registry.json —
 * project, ~/.claude/agents and extra agents) and the skill index
 * (.claude/helpers/skill-registry.json — project, ~/.claude/skills and the
 * Org library). SessionStart and the CLI keep both fresh afterwards.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildUnifiedRegistry, computeAgentRoots } from '../agents/registry-builder.js';
import { registryPath } from '../agents/registry-freshness.js';
import { regenerateSkillIndex } from './shared.js';

export interface ProjectIndexCounts {
  /** Agents in the registry; absent when the build failed. */
  agents?: { total: number; user: number };
  /** Skill index entries plus Org-library skills; absent when not built. */
  skills?: { total: number; user: number };
}

/** Builds both indexes for `targetDir`. The skill index is built only where
 *  `.claude/helpers` exists (it lives there). Never throws. */
export function buildProjectIndexes(
  targetDir: string,
  sourceHelpersDir?: string | null,
): ProjectIndexCounts {
  const counts: ProjectIndexCounts = {};
  try {
    fs.mkdirSync(path.join(targetDir, '.monomind'), { recursive: true });
    const reg = buildUnifiedRegistry(computeAgentRoots(targetDir), registryPath(targetDir), {
      base: targetDir,
    });
    counts.agents = { total: reg.totalAgents, user: reg.counts.user };
  } catch {
    /* reported as missing from the summary line */
  }
  if (fs.existsSync(path.join(targetDir, '.claude', 'helpers'))) {
    const skills = regenerateSkillIndex(targetDir, sourceHelpersDir);
    if (skills) counts.skills = skills;
  }
  return counts;
}

/** `Indexed 90 agents (2 from ~/.claude/agents) and 560 skills (3 from ~/.claude/skills)`;
 *  null when neither index was built. */
export function formatIndexSummary(counts: ProjectIndexCounts | undefined): string | null {
  const parts: string[] = [];
  if (counts?.agents)
    parts.push(`${counts.agents.total} agents (${counts.agents.user} from ~/.claude/agents)`);
  if (counts?.skills)
    parts.push(`${counts.skills.total} skills (${counts.skills.user} from ~/.claude/skills)`);
  return parts.length ? `Indexed ${parts.join(' and ')}` : null;
}
