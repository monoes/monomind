/**
 * Typed door into .claude/helpers/pick-stats.cjs, the pick learning loop the
 * hooks feed (SubagentStop, SessionEnd): adherence and outcomes aggregated into
 * .monomind/pick-stats.json, and the bounded prior that re-ranks keyword agent
 * picks. Safe when the helper is missing: an empty summary and no prior.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentPickStats {
  name: string;
  /** Shown as the [PICK] agent. */
  recommended: number;
  /** A Task spawn used the recommended agent. */
  followed: number;
  /** A Task spawn used another agent than the recommended one. */
  overridden: number;
  /** Spawned instead of a different recommended agent. */
  chosen: number;
  /** SubagentStop outcomes of this agent. */
  success: number;
  failure: number;
}

export interface PickStatsSummary {
  /** Prompts routed (route-outcomes records). */
  routes: number;
  /** Routes that printed a [PICK] line. */
  shown: number;
  /** Task/Agent spawns observed (pick-adherence records). */
  spawns: number;
  /** followed / (followed + overridden); null without a recommended spawn. */
  adherenceRate: number | null;
  /** Subagent success rate when the pick was followed; null without data. */
  followedSuccessRate: number | null;
  /** Subagent success rate when the pick was overridden; null without data. */
  notFollowedSuccessRate: number | null;
  /** At most 10, most observations first; `prior` is the ranking factor. */
  topAgents: (AgentPickStats & { successRate: number | null; prior: number })[];
  updatedAt: string | null;
}

interface PickStatsFile {
  agents: Record<string, AgentPickStats>;
}

interface PickStatsModule {
  load(root: string): PickStatsFile;
  update(root: string, opts?: { persist?: boolean }): PickStatsFile | null;
  applyPriors<T extends { id: string; name?: string; score: number }>(
    ranked: T[],
    stats: PickStatsFile,
  ): (T & { baseScore: number; prior: number })[];
  summarize(stats: PickStatsFile | null): PickStatsSummary;
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/decision → ../.. is the package root; dist/src/decision → ../../.. */
const HELPER_CANDIDATES = [
  join(HERE, '..', '..', '.claude', 'helpers', 'pick-stats.cjs'),
  join(HERE, '..', '..', '..', '.claude', 'helpers', 'pick-stats.cjs'),
];

let loaded: PickStatsModule | null | undefined;

function pickStatsModule(): PickStatsModule | null {
  if (loaded !== undefined) return loaded;
  const file = HELPER_CANDIDATES.find((p) => existsSync(p));
  try {
    loaded = file ? (createRequire(import.meta.url)(file) as PickStatsModule) : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

const EMPTY: PickStatsSummary = {
  routes: 0,
  shown: 0,
  spawns: 0,
  adherenceRate: null,
  followedSuccessRate: null,
  notFollowedSuccessRate: null,
  topAgents: [],
  updatedAt: null,
};

/** Pick learning summary for `root`, folded up to the latest hook lines
 *  without writing pick-stats.json. Never throws. */
export function readPickStats(root: string): PickStatsSummary {
  const mod = pickStatsModule();
  if (!mod) return { ...EMPTY };
  try {
    return mod.summarize(mod.update(root, { persist: false }));
  } catch {
    return { ...EMPTY };
  }
}

/** Re-rank keyword-scored agents by the stored outcome prior of `root`.
 *  Entries gain `baseScore` (keyword relevance) and `prior` (the factor);
 *  without the helper they come back unchanged with prior 1. */
export function applyAgentPriors<T extends { id: string; name?: string; score: number }>(
  root: string,
  ranked: T[],
): (T & { baseScore: number; prior: number })[] {
  const mod = pickStatsModule();
  if (mod) {
    try {
      return mod.applyPriors(ranked, mod.load(root));
    } catch {
      /* fall through: keyword order */
    }
  }
  return ranked.map((r) => ({ ...r, baseScore: r.score, prior: 1 }));
}
