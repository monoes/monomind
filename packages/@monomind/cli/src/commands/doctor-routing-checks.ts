/**
 * Doctor — routing checks: routing learning (route-outcome accuracy) and the
 * agent registry the picker ranks. Extracted from doctor-project-checks.ts.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthCheck } from './doctor-env-checks.js';

function fmtPct(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v * 100)}%`;
}

/** Below this many outcomes a success rate is noise, so none is reported (#425). */
const MIN_ROUTING_SAMPLE = 30;

/** Summarize .monomind/route-outcomes.jsonl, or null when it holds no outcomes.
 *  An accuracy figure is printed only from >= MIN_ROUTING_SAMPLE outcomes that
 *  include both successes and failures — a one-sided flag measures nothing. */
async function routeOutcomeCheck(): Promise<HealthCheck | null> {
  const { computeRoutingAccuracy, computeAdherence } = await import(
    '../monovector/route-outcomes.js'
  );
  const baseDir = join(process.cwd(), '.monomind');
  const acc = await computeRoutingAccuracy(baseDir, 100);
  const n = acc.totalWithOutcome;
  if (acc.accuracy === null || n === 0) return null;
  const adh = await computeAdherence(baseDir);
  const follow = `PICK follow rate ${fmtPct(adh.adherence)} (n=${adh.sample})`;
  const name = 'Routing Learning';
  if (n < MIN_ROUTING_SAMPLE)
    return {
      name,
      status: 'info',
      message: `insufficient data: ${n} routed task(s) with an outcome (need ${MIN_ROUTING_SAMPLE}); ${follow}`,
    };
  if (acc.accuracy === 1 || acc.accuracy === 0)
    return {
      name,
      status: 'warn',
      message: `${n} outcomes, all marked ${acc.accuracy === 1 ? 'successful' : 'failed'} — no contrasting signal, so no accuracy is reported; ${follow}`,
    };
  const trend =
    acc.recentVsPrior === null
      ? ''
      : ` trend ${acc.recentVsPrior >= 0 ? '+' : ''}${Math.round(acc.recentVsPrior * 100)}%`;
  return {
    name,
    status: 'pass',
    message: `routing accuracy ${fmtPct(acc.accuracy)} (n=${n}) [native ${fmtPct(acc.byMode.native)} / js ${fmtPct(acc.byMode.js)}]${trend}; ${follow}`,
  };
}

/** Fallback when route-outcomes.jsonl has no data: summarize .monomind/routing-feedback.jsonl honestly. */
function routingFeedbackFallback(): { message: string; status: HealthCheck['status'] } | null {
  try {
    const p = join(process.cwd(), '.monomind', 'routing-feedback.jsonl');
    if (!existsSync(p) || statSync(p).size > 512 * 1024) return null;
    const records = readFileSync(p, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null);
    if (records.length === 0) return null;
    const sessions = new Set(records.map((r) => r.sessionId).filter(Boolean));
    const byAgent = new Map<string, number>();
    for (const r of records) {
      const a = typeof r.suggestedAgent === 'string' ? r.suggestedAgent : 'unknown';
      byAgent.set(a, (byAgent.get(a) ?? 0) + 1);
    }
    const top = [...byAgent.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([a, n]) => `${a}=${n}`)
      .join(', ');
    const flags = records
      .map((r) => r.intelligenceFeedback)
      .filter((v): v is boolean => typeof v === 'boolean');
    const trueCount = flags.filter(Boolean).length;
    const base = `routing feedback (fallback): ${records.length} decisions across ${sessions.size} sessions; top agents: ${top}`;
    if (flags.length < MIN_ROUTING_SAMPLE)
      return {
        message: `${base}; insufficient data: ${flags.length} success flag(s) (need ${MIN_ROUTING_SAMPLE})`,
        status: 'info',
      };
    if (trueCount === flags.length) {
      return {
        message: `${base}; success flag is degenerate (100% true — sessionSuccess heuristic never records failure)`,
        status: 'warn',
      };
    }
    return {
      message: `${base}; success rate ${Math.round((trueCount / flags.length) * 100)}% (n=${flags.length})`,
      status: 'pass',
    };
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[routingFeedbackFallback] parse failed:', e);
    return null;
  }
}

export async function checkMonoesIntegration(): Promise<HealthCheck> {
  try {
    const outcomes = await routeOutcomeCheck().catch((e) => {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[routeOutcomeCheck] compute failed:', e);
      return null;
    });
    if (outcomes) return outcomes;
    const fb = routingFeedbackFallback();
    if (fb) return { name: 'Routing Learning', status: fb.status, message: fb.message };
    return { name: 'Routing Learning', status: 'info', message: 'no routing outcome data yet' };
  } catch (err) {
    return {
      name: 'Routing Learning',
      status: 'warn',
      message: `Could not compute routing accuracy: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function checkAgentRegistry(opts: { readOnly?: boolean } = {}): Promise<HealthCheck> {
  try {
    const { buildUnifiedRegistry, computeAgentRoots } = await import(
      '../agents/registry-builder.js'
    );
    const { findProjectRoot, registryPath } = await import('../agents/registry-freshness.js');
    const project = findProjectRoot(process.cwd());
    const cwd = project ?? process.cwd();
    const roots = computeAgentRoots(cwd);
    const write = project !== null && !opts.readOnly;
    if (write) mkdirSync(join(cwd, '.monomind'), { recursive: true });
    // Rebuilds fresh in-memory (and, inside a project, refreshes
    // .monomind/registry.json on disk, never replacing a non-empty registry
    // with an empty one) rather than reading a file a separate startup task
    // may also be writing. Outside a project, and in read-only mode (issue
    // #335), nothing is written.
    const registry = buildUnifiedRegistry(roots, write ? registryPath(cwd) : undefined, {
      base: cwd,
    });
    const entries = registry.agents;
    // An extra root (MONOMIND_EXTRA_AGENT_PATHS or a sibling agency-agents dir)
    // wins slug conflicts over .claude/agents — say so instead of hiding it.
    const extras = roots.filter((r) => r.origin === 'extra').map((r) => r.dir);
    // User agents (~/.claude/agents) are indexed too; project agents win.
    const shadowed = registry.shadowed.length;
    const extraNote =
      `; ${registry.counts.user} from ~/.claude/agents` +
      (shadowed ? ` (${shadowed} shadowed by a project agent)` : '') +
      (extras.length ? `; extra agent roots (win on conflict): ${extras.join(', ')}` : '');
    if (entries.length === 0) {
      return {
        name: 'Agent Registry',
        status: 'warn',
        message: `No agents found under .claude/agents or ~/.claude/agents${extraNote}`,
        fix: 'monomind init  (installs agent definitions)',
      };
    }
    let missingSlug = 0,
      missingName = 0,
      missingDescription = 0,
      missingWhenToUse = 0;
    for (const agent of entries) {
      if (!agent.slug) missingSlug++;
      if (!agent.name) missingName++;
      if (!agent.description) missingDescription++;
      // The pick index leads with when_to_use; older installs lack it.
      if (!agent.whenToUse) missingWhenToUse++;
    }
    const dupes = registry.duplicates;
    const total = missingSlug + missingName + missingDescription + missingWhenToUse + dupes.length;
    if (total === 0) {
      return {
        name: 'Agent Registry',
        status: 'pass',
        message: `${entries.length} agent(s), all metadata complete${extraNote}`,
      };
    }
    const parts = [
      missingSlug > 0 ? `${missingSlug} missing slug` : null,
      missingName > 0 ? `${missingName} missing name` : null,
      missingDescription > 0 ? `${missingDescription} missing description` : null,
      missingWhenToUse > 0 ? `${missingWhenToUse} missing when_to_use` : null,
      dupes.length > 0
        ? `duplicate slug ${dupes.map((d) => `"${d.slug}" (kept ${d.kept}, dropped ${d.dropped.join(', ')})`).join('; ')}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      name: 'Agent Registry',
      status: 'warn',
      message: `${total} metadata issue(s) across ${entries.length} agent(s): ${parts}${extraNote}`,
      fix: dupes.length
        ? 'Give each duplicated agent a unique `slug:` in its frontmatter'
        : missingWhenToUse > 0
          ? 'monomind init upgrade  (refreshes unedited bundled agents; add `when_to_use:` to your own agents in .claude/agents/*.md)'
          : 'Add the missing field(s) to frontmatter in .claude/agents/*.md',
    };
  } catch (err) {
    return {
      name: 'Agent Registry',
      status: 'warn',
      message: `Could not build/parse agent registry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
