/**
 * Validates agent plan output against the configured format and constraints.
 * @packageDocumentation
 */

import type { PlanningConfig } from './types.js';

/** Result of validating an agent plan. */
export interface PlanValidationResult {
  /** Whether the plan passes all validation rules. */
  valid: boolean;
  /** Human-readable error messages (empty when valid). */
  errors: string[];
  /** Number of steps detected in the plan. */
  parsedSteps: number;
  /** Confidence extracted from JSON plans (if present). */
  confidence?: number;
}

/**
 * Validate a plan string against the planning configuration.
 */
export function validatePlan(
  planText: string,
  config: PlanningConfig,
): PlanValidationResult {
  const errors: string[] = [];
  let parsedSteps = 0;
  let confidence: number | undefined;

  // Token budget check (approximate: 1 token ~ 4 chars)
  const approxTokens = Math.ceil(planText.length / 4);
  if (approxTokens > config.maxPlanTokens) {
    errors.push(
      `Plan exceeds token budget: ~${approxTokens} tokens (max ${config.maxPlanTokens})`,
    );
  }

  // Format-specific validation
  switch (config.format) {
    case 'json': {
      try {
        const parsed = JSON.parse(planText);
        if (!Array.isArray(parsed.steps)) {
          errors.push('JSON plan must contain a "steps" array');
        } else {
          parsedSteps = parsed.steps.length;
        }
        if (typeof parsed.confidence === 'number') {
          confidence = parsed.confidence;
        }
      } catch {
        errors.push('Plan is not valid JSON');
      }
      break;
    }

    case 'markdown': {
      // Match lines starting with "- " or "* "
      const bullets = planText.match(/^[\t ]*[-*] .+/gm);
      if (!bullets || bullets.length === 0) {
        errors.push('Markdown plan must contain at least one bullet ("- " or "* ")');
      } else {
        parsedSteps = bullets.length;
      }
      break;
    }

    case 'numbered-list': {
      // Match lines starting with a number followed by ". "
      const numbered = planText.match(/^\d+\.\s+.+/gm);
      if (!numbered || numbered.length === 0) {
        errors.push('Numbered-list plan must contain at least one numbered item (e.g. "1. ...")');
      } else {
        parsedSteps = numbered.length;
      }
      break;
    }

    default:
      errors.push(`Unknown plan format: ${config.format}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    parsedSteps,
    confidence,
  };
}
