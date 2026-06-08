/**
 * Build the classification prompt for LLM fallback routing.
 */
export function buildClassificationPrompt(
  taskDescription: string,
  capabilityIndex: string,
  candidateHints: string
): string {
  return `You are a task routing classifier. Your job is to select the single best agent slug for a given task.

## Available Agents
${capabilityIndex}

## Semantic Pre-Candidates (top 3 by embedding similarity)
${candidateHints}

## Task to Route
"${taskDescription}"

## Instructions
1. Review the task description carefully.
2. Consider the semantic pre-candidates — they may already be correct.
3. Select the SINGLE best agent slug from the Available Agents list above.
4. Output ONLY the agent slug — no explanation, no markdown, no punctuation.
5. The slug must exactly match one of the slugs in the Available Agents list.

Agent slug:`;
}
