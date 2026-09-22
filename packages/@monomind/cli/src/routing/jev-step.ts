/**
 * Route-layer step 0: the Jev decision model picks among the routing package's
 * routes (keyword hit always a candidate). null = no confident decision, and
 * the existing keyword → embeddings → Haiku cascade runs unchanged.
 * Main-process safe: no transformers/onnxruntime imports.
 */
import { type RouteLike, routeCatalog } from '../decision/catalogs.js';
import { acceptAgent, type PickOptions, pickWithJev } from '../decision/jev.js';

export interface JevRouteResult {
  agentSlug: string;
  confidence: number;
  method: 'jev';
  routeName: string;
  provider: string;
}

export async function routeWithJev(
  task: string,
  routes: RouteLike[],
  keywordSlug: string | undefined,
  opts: PickOptions = {},
): Promise<JevRouteResult | null> {
  const picked = await pickWithJev(
    task,
    { agents: routeCatalog(routes) },
    {
      ...opts,
      include: { agents: keywordSlug ? [keywordSlug] : [] },
      agentInstructions: 'Which specialist agent should handle this software task?',
    },
  );
  const slug = acceptAgent(picked?.agent, opts.env);
  if (!picked?.agent || !slug) return null;
  const route = routes.find((r) => r.agentSlug === slug);
  return {
    agentSlug: slug,
    confidence: picked.agent.confidence,
    method: 'jev',
    routeName: route?.name ?? slug,
    provider: picked.provider,
  };
}
