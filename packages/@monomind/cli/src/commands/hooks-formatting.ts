/**
 * Display formatting helpers for hooks commands.
 * Extracted from hooks.ts (ARCH-1) — formatIntelligenceStatus.
 */

import { output } from '../output.js';

/**
 * Format an intelligence component status string with colour coding.
 */
export function formatIntelligenceStatus(status: string): string {
  switch (status) {
    case 'active':
    case 'ready':
      return output.success(status);
    case 'training':
      return output.highlight(status);
    case 'idle':
      return output.dim(status);
    case 'disabled':
    case 'error':
      return output.error(status);
    default:
      return status;
  }
}
