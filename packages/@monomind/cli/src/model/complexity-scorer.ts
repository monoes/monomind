/**
 * Heuristic complexity scorer for task descriptions.
 *
 * Returns a score in [0, 100] that drives automatic model-tier selection.
 * Higher scores indicate tasks that benefit from more capable (and costly)
 * models.
 */

// ---------------------------------------------------------------------------
// Keyword sets
// ---------------------------------------------------------------------------

const HIGH_COMPLEXITY_KEYWORDS: readonly string[] = [
  'architecture',
  'distributed',
  'security audit',
  'cve',
  'consensus',
  'fault-tolerant',
  'migrate',
  'refactor across',
  'orchestrat',
  'design system',
  'database schema',
  'performance optim',
  'threat model',
  'encryption',
  'zero-knowledge',
];

const LOW_COMPLEXITY_KEYWORDS: readonly string[] = [
  'format',
  'list',
  'rename',
  'sort',
  'typo',
  'lint',
  'log',
  'comment',
  'print',
  'echo',
  'delete unused',
  'remove import',
];

/**
 * Agent slugs that inherently deal with high-complexity work.
 * When one of these agents is involved the score gets a +20 bonus.
 */
export const HIGH_COMPLEXITY_AGENTS: ReadonlySet<string> = new Set([
  'engineering-software-architect',
  'security-architect',
  'security-auditor',
  'system-architect',
  'performance-engineer',
  'byzantine-coordinator',
  'collective-intelligence-coordinator',
]);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const STEP_INDICATOR_RE = /(?:step\s*\d|first[\s,].*then[\s,]|phase\s*\d)/i;
const CODE_BLOCK_RE = /```[\s\S]*?```/;
const FILE_REF_RE = /\b[\w./-]+\.\w{1,5}\b/;

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

/**
 * Score the complexity of a task description.
 *
 * @param taskDescription - Free-text description of the task.
 * @param agentSlug       - Optional agent identifier; certain agents boost the score.
 * @returns A number in [0, 100].
 */
export function scoreComplexity(
  taskDescription: string,
  agentSlug?: string,
): number {
  let score = 50;
  const lower = taskDescription.toLowerCase();
  const wordCount = taskDescription.trim().split(/\s+/).length;

  // -- Word-count adjustments ------------------------------------------------
  if (wordCount < 20) {
    score -= 20;
  }
  if (wordCount > 100) {
    score += 20;
  }
  if (wordCount > 200) {
    score += 10;
  }

  // -- Keyword adjustments (first match only) --------------------------------
  if (HIGH_COMPLEXITY_KEYWORDS.some((kw) => lower.includes(kw))) {
    score += 10;
  }
  if (LOW_COMPLEXITY_KEYWORDS.some((kw) => lower.includes(kw))) {
    score -= 10;
  }

  // -- Structural indicators -------------------------------------------------
  if (STEP_INDICATOR_RE.test(taskDescription)) {
    score += 10;
  }
  if (CODE_BLOCK_RE.test(taskDescription) || FILE_REF_RE.test(taskDescription)) {
    score += 5;
  }

  // -- Agent bonus -----------------------------------------------------------
  if (agentSlug && HIGH_COMPLEXITY_AGENTS.has(agentSlug)) {
    score += 20;
  }

  // -- Clamp -----------------------------------------------------------------
  return Math.max(0, Math.min(100, score));
}
