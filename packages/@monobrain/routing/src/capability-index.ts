import { Route } from './types.js';

const MAX_INDEX_CHARS = 8000;

/**
 * Build a compact text index of all agent capabilities for LLM classification.
 * Each entry: "<agentSlug>: <description>"
 * Total output stays under MAX_INDEX_CHARS to fit in a single LLM prompt.
 */
export function buildCapabilityIndex(routes: Route[]): string {
  const lines: string[] = [];
  for (const route of routes) {
    const description = route.description ?? route.utterances[0] ?? route.name;
    lines.push(`${route.agentSlug}: ${description}`);
  }

  let index = lines.join('\n');
  if (index.length > MAX_INDEX_CHARS) {
    const trimmedLines = routes.map(r => {
      const desc = (r.description ?? r.utterances[0] ?? r.name).slice(0, 80);
      return `${r.agentSlug}: ${desc}`;
    });
    index = trimmedLines.join('\n').slice(0, MAX_INDEX_CHARS);
  }
  return index;
}

/**
 * Build a compact list of the top-N candidate agents by semantic score for hint injection.
 */
export function buildCandidateHints(
  scores: Array<{ agentSlug: string; score: number }>,
  topN = 3
): string {
  return scores
    .slice(0, topN)
    .map(s => `- ${s.agentSlug} (similarity: ${s.score.toFixed(3)})`)
    .join('\n');
}
