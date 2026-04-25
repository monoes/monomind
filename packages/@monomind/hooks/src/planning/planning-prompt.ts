/**
 * Builds a system-prompt segment that instructs an agent to produce a plan
 * before executing a task.
 * @packageDocumentation
 */

import type { PlanningConfig } from './types.js';

/**
 * Build a planning prompt segment for the given config and task description.
 *
 * The returned string is intended to be appended to the agent's system prompt
 * so that it emits a structured plan before acting.
 */
export function buildPlanningPrompt(
  config: PlanningConfig,
  taskDescription: string,
): string {
  const formatInstructions = getFormatInstructions(config.format);

  const lines: string[] = [
    'MANDATORY PLANNING STEP',
    '========================',
    '',
    'Before executing any actions you MUST first produce a plan.',
    '',
    `Task: ${taskDescription}`,
    '',
    'Format your plan as follows:',
    formatInstructions,
    '',
    `Token budget: keep your plan under ${config.maxPlanTokens} tokens (approximately ${config.maxPlanTokens * 4} characters).`,
  ];

  if (config.requireApproval) {
    lines.push('');
    lines.push(
      'IMPORTANT: Wait for explicit approval of your plan before proceeding with execution.',
    );
  }

  return lines.join('\n');
}

function getFormatInstructions(format: string): string {
  switch (format) {
    case 'markdown':
      return [
        '## Plan',
        '- Step 1: [describe first action]',
        '- Step 2: [describe second action]',
        '- Step N: [describe final action]',
      ].join('\n');

    case 'json':
      return '{"steps": ["step 1 description", "step 2 description", ...], "estimatedSteps": N, "confidence": 0.X}';

    case 'numbered-list':
      return [
        '1. First step description',
        '2. Second step description',
        'N. Final step description',
      ].join('\n');

    default:
      return '(use plain text)';
  }
}
