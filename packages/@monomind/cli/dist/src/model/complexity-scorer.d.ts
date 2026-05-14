/**
 * Heuristic complexity scorer for task descriptions.
 *
 * Returns a score in [0, 100] that drives automatic model-tier selection.
 * Higher scores indicate tasks that benefit from more capable (and costly)
 * models.
 */
/**
 * Agent slugs that inherently deal with high-complexity work.
 * When one of these agents is involved the score gets a +20 bonus.
 */
export declare const HIGH_COMPLEXITY_AGENTS: ReadonlySet<string>;
/**
 * Score the complexity of a task description.
 *
 * @param taskDescription - Free-text description of the task.
 * @param agentSlug       - Optional agent identifier; certain agents boost the score.
 * @returns A number in [0, 100].
 */
export declare function scoreComplexity(taskDescription: string, agentSlug?: string): number;
//# sourceMappingURL=complexity-scorer.d.ts.map