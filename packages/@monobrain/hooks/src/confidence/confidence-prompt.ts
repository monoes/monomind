/**
 * Confidence prompt injection and parsing.
 * @packageDocumentation
 */

const CONFIDENCE_REGEX = /CONFIDENCE:\s*([\d.]+)/i;

/**
 * Returns a system prompt segment instructing the agent to report confidence.
 */
export function inject(): string {
  return [
    'After completing your task, report your confidence in the result.',
    'Add a line in this exact format:',
    '',
    '  CONFIDENCE: 0.XX',
    '',
    'where 0.XX is a number between 0.00 (no confidence) and 1.00 (fully confident).',
    'This line must appear on its own line in your output.',
  ].join('\n');
}

/**
 * Parse a confidence score from raw agent output.
 * Returns a number clamped to [0, 1], or null if no score found.
 */
export function parseScore(rawOutput: string): number | null {
  const match = CONFIDENCE_REGEX.exec(rawOutput);
  if (!match) return null;

  const raw = parseFloat(match[1]);
  if (isNaN(raw)) return null;

  return Math.min(Math.max(raw, 0), 1);
}
