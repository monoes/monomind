/**
 * The route layer's central-picker step: the same pickForTask/rankForTask
 * ranking `monomind pick` and the routing hooks use, over the registry's
 * agents. The @monoes/routing keyword hit, when there is one, is always a
 * decision-model candidate. Main-process safe: no transformers/onnxruntime.
 */
import { automaticMinConfidence, type PickOptions } from '../decision/jev.js';
import type { RouteLike } from '../decision/catalogs.js';
import type { RankedEntry } from '../decision/picks.js';
import { confidenceOf, keywordLeader, pickForTask, spawnableName } from './agent-pick.js';

export interface PickRouteResult {
  /** Spawnable agent name (Task subagent_type). */
  agentSlug: string;
  confidence: number;
  method: 'jev' | 'keyword';
  routeName: string;
  provider?: string;
}

export interface PickRoute {
  /** The decision model's pick, when it clears the automatic floor. */
  jev: PickRouteResult | null;
  /** The keyword ranking's top agent, when it clearly leads. */
  keyword: PickRouteResult | null;
}

export async function pickRoute(
  task: string,
  routes: RouteLike[],
  keywordSlug: string | undefined,
  opts: PickOptions & { root?: string } = {},
): Promise<PickRoute> {
  const { root, ...pickOpts } = opts;
  const ranking = await pickForTask({
    task,
    kind: 'agents',
    top: 3,
    root,
    options: {
      ...pickOpts,
      // The route layer acts on its answer (`agent spawn --task`).
      minConfidence: automaticMinConfidence(pickOpts.env),
      include: { agents: keywordSlug ? [keywordSlug] : [] },
    },
  });
  const toResult = (e: RankedEntry, method: 'jev' | 'keyword'): PickRouteResult => {
    const name = spawnableName(e);
    return {
      agentSlug: name,
      confidence: confidenceOf(e),
      method,
      routeName: routes.find((r) => r.agentSlug === name)?.name ?? name,
      ...(method === 'jev' && ranking.provider ? { provider: ranking.provider } : {}),
    };
  };
  const ranked = ranking.agents.ranked;
  if (ranking.agents.method === 'jev' && ranked[0]) {
    return { jev: toResult(ranked[0], 'jev'), keyword: null };
  }
  const leader = keywordLeader(ranked);
  return { jev: null, keyword: leader ? toResult(leader, 'keyword') : null };
}
