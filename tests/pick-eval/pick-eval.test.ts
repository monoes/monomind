/**
 * Regression guard for agent/skill picking. The keyword ranker runs over a
 * FROZEN catalog (catalog-snapshot.json) so an unrelated agent or skill edit
 * cannot move these numbers; only a ranker or catalog-loader change can.
 * Expectations list EVERY acceptable id for a task (see dataset.json).
 *
 * The live-catalog check runs only with MONOMIND_PICK_EVAL_LIVE=1.
 * Scores and misses: `pnpm run pick:eval [--catalog frozen]`.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../../packages/@monomind/cli/src/decision/jev.js';
import {
  type EvalCatalogs,
  type EvalKind,
  type EvalTask,
  gatedEval,
  keywordEval,
  keywordPicks,
  projectCatalogs,
  readEvalSnapshot,
  readEvalTasks,
  scorePicks,
  unknownExpectations,
} from '../../packages/@monomind/cli/src/decision/pick-eval.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// A little under the frozen-catalog scores (82 tasks; 79 with an agent and
// 78 with a skill expectation, 3 where nothing fits). Raise them when the
// ranker improves; never lower them to make a change pass.
const FLOOR = { agentsTop1: 49, agentsTop3: 55, skillsTop1: 53, skillsTop3: 65 };
// Precision of what the [PICK] gate shows over keyword ranking (frozen: agents
// 46/50, skills 36/43; before the task-head / template fixes 46/50 and 34/43,
// before the vibe / "not for" fixes 46/50 and 34/42 on 77 tasks).
const GATED_FLOOR = { agents: 0.92, skills: 0.83 };
// The live catalogs drift with every agent/skill edit: a looser floor.
const LIVE_FLOOR = { agentsTop1: 40, skillsTop1: 42 };
// Catalog entries edited on purpose to fix a reviewed wrong pick whose cause
// was the entry's own text, not the ranker. The snapshot keeps its frozen
// text (an unrelated edit must not move the floors), so the guard below reads
// just these entries from the repo: monoswarm-multi-repo and sync-coordinator
// said "org" for a GitHub organization, api-designer carried a
// `documentation` tag, code-documenter's description left out API reference
// docs and tutorials.
const REVISED = {
  agents: ['monoswarm-multi-repo', 'sync-coordinator'],
  skills: ['api-designer', 'code-documenter'],
};
// Reviewed prompts where a wrong [PICK] was seen: the SDK docs task (15), the
// short docs and org-creation prompts and their variants (129, 130, 138-142).
const REVIEWED = [15, 129, 130, 138, 139, 140, 141, 142];

/** The frozen snapshot with the REVISED entries as the repo has them now. */
function frozenWithRevisions(snapshot: EvalCatalogs, repo: EvalCatalogs): EvalCatalogs {
  const kind = (k: EvalKind): CatalogItem[] => {
    const current = new Map(repo[k].map((i) => [i.id, i]));
    return snapshot[k].map((i) => (REVISED[k].includes(i.id) ? (current.get(i.id) ?? i) : i));
  };
  return { agents: kind('agents'), skills: kind('skills') };
}

describe('scorePicks', () => {
  const tasks: EvalTask[] = [
    { id: 1, task: 'a', agents: ['x', 'y'], skills: ['s'] },
    { id: 2, task: 'b', agents: ['x'], skills: [] },
    { id: 3, task: 'c', agents: ['z'], skills: ['t'] },
  ];

  it('counts any acceptable id as a hit and skips kinds with no expectation', () => {
    const r = scorePicks(tasks, [
      { agents: ['y', 'x'], skills: ['q', 'r', 's'] },
      { agents: ['q', 'x'], skills: ['anything'] },
      { agents: ['q', 'r', 'w', 'z'], skills: [] },
    ]);
    expect(r.agents).toMatchObject({ n: 3, top1: 1, top3: 2 });
    expect(r.skills).toMatchObject({ n: 2, top1: 0, top3: 1 });
    expect(r.agents.misses.map((m) => [m.id, m.rank])).toEqual([
      [2, 2],
      [3, null],
    ]);
  });
});

describe('pick eval on the frozen catalog', () => {
  const tasks = readEvalTasks(ROOT);
  const snapshot = readEvalSnapshot(ROOT);

  it('has the eval set and the snapshot', () => {
    expect(tasks?.length).toBe(82);
    expect(snapshot?.agents.length).toBeGreaterThan(50);
    expect(snapshot?.skills.length).toBeGreaterThan(300);
  });

  it('expects only ids the snapshot contains', () => {
    expect(unknownExpectations(tasks ?? [], snapshot ?? { agents: [], skills: [] })).toEqual([]);
  });

  it('keyword ranking stays above the floors', () => {
    const r = keywordEval(tasks ?? [], snapshot ?? { agents: [], skills: [] });
    expect(r.agents.top1).toBeGreaterThanOrEqual(FLOOR.agentsTop1);
    expect(r.agents.top3).toBeGreaterThanOrEqual(FLOOR.agentsTop3);
    expect(r.skills.top1).toBeGreaterThanOrEqual(FLOOR.skillsTop1);
    expect(r.skills.top3).toBeGreaterThanOrEqual(FLOOR.skillsTop3);
  });
});

describe('the gated pick on the frozen catalog', () => {
  const tasks = readEvalTasks(ROOT) ?? [];
  const r = gatedEval(tasks, readEvalSnapshot(ROOT) ?? { agents: [], skills: [] });

  it('shows mostly right picks (precision of what clears the [PICK] bar)', () => {
    expect(r.agents.precision).toBeGreaterThanOrEqual(GATED_FLOOR.agents);
    expect(r.skills.precision).toBeGreaterThanOrEqual(GATED_FLOOR.skills);
  });

  it('shows nothing when nothing fits', () => {
    const none = new Set(tasks.filter((t) => t.noPick).map((t) => t.id));
    expect(none.size).toBeGreaterThanOrEqual(3);
    expect([...r.agents.wrong, ...r.skills.wrong].filter((w) => none.has(w.id))).toEqual([]);
  });

  it('never shows the reviewed false positives', () => {
    const shown = [...r.agents.wrong, ...r.skills.wrong].map((w) => w.shown);
    for (const id of [
      'public-relations',
      'engineering-embedded-firmware-engineer',
      'competitor-comparison-pages',
    ])
      expect(shown).not.toContain(id);
  });

  it('shows no wrong pick on the reviewed docs and org-creation prompts', () => {
    // "write developer documentation for the REST API" showed api-designer and
    // "create a new org that monitors competitors" Performance Monitor plus
    // competitor-comparison-pages: the head of the task, not its modifier.
    const reviewed = new Set([129, 130, 138, 140, 141]);
    const wrong = [...r.agents.wrong, ...r.skills.wrong].filter((w) => reviewed.has(w.id));
    expect(wrong).toEqual([]);
  });
});

describe('the gated pick with the revised catalog entries', () => {
  const tasks = readEvalTasks(ROOT) ?? [];
  const snapshot = readEvalSnapshot(ROOT) ?? { agents: [], skills: [] };
  const catalogs = frozenWithRevisions(snapshot, projectCatalogs(ROOT));

  it('finds every revised entry in the repo', () => {
    const repo = projectCatalogs(ROOT);
    for (const k of ['agents', 'skills'] as const)
      for (const id of REVISED[k]) expect(repo[k].map((i) => i.id)).toContain(id);
  });

  it('shows no wrong pick on any reviewed prompt', () => {
    // "set up an org that tracks competitor pricing changes" showed
    // monoswarm-multi-repo (a GitHub-organization rollout agent) and "document
    // the public REST API for external developers" / the SDK docs task showed
    // api-designer (designs APIs, does not document them).
    const r = gatedEval(
      tasks.filter((t) => REVIEWED.includes(t.id)),
      catalogs,
    );
    expect([...r.agents.wrong, ...r.skills.wrong]).toEqual([]);
  });

  it('keeps the frozen floors', () => {
    const r = keywordEval(tasks, catalogs);
    expect(r.agents.top1).toBeGreaterThanOrEqual(FLOOR.agentsTop1);
    expect(r.skills.top1).toBeGreaterThanOrEqual(FLOOR.skillsTop1);
    const g = gatedEval(tasks, catalogs);
    expect(g.agents.precision).toBeGreaterThanOrEqual(GATED_FLOOR.agents);
    expect(g.skills.precision).toBeGreaterThanOrEqual(GATED_FLOOR.skills);
  });
});

describe('pick: low skills on the frozen catalog', () => {
  it('no admin/meta skill (pick: low) reaches a top 3', () => {
    const snapshot = readEvalSnapshot(ROOT) ?? { agents: [], skills: [] };
    const low = new Set(snapshot.skills.filter((s) => s.pick === 'low').map((s) => s.id));
    expect(low.size).toBeGreaterThan(10);
    // A task that names org management ("create a new org") is what the
    // admin pages are for: they may surface there.
    const tasks = (readEvalTasks(ROOT) ?? []).filter((t) => t.domain !== 'org-admin');
    const shown = keywordPicks(tasks, snapshot).flatMap((p) =>
      p.skills.filter((id) => low.has(id)),
    );
    expect(shown).toEqual([]);
  });
});

describe.skipIf(process.env.MONOMIND_PICK_EVAL_LIVE !== '1')(
  'pick eval on the live catalogs',
  () => {
    it('keyword ranking stays above the live floors', () => {
      const r = keywordEval(readEvalTasks(ROOT) ?? [], projectCatalogs(ROOT));
      expect(r.agents.top1).toBeGreaterThanOrEqual(LIVE_FLOOR.agentsTop1);
      expect(r.skills.top1).toBeGreaterThanOrEqual(LIVE_FLOOR.skillsTop1);
    });
  },
);
