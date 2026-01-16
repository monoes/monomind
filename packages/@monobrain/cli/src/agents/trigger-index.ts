/**
 * Trigger Index Persistence (Task 32)
 *
 * Handles saving and loading the TriggerIndex JSON file
 * at `.monobrain/trigger-index.json` (or a custom path).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { TriggerIndex } from '../../../../@monobrain/shared/src/types/trigger.js';

/** Default path for the persisted trigger index. */
export const DEFAULT_TRIGGER_INDEX_PATH = '.monobrain/trigger-index.json';

/**
 * Save a TriggerIndex to a JSON file.
 * Creates parent directories if they don't exist.
 */
export function save(index: TriggerIndex, path: string = DEFAULT_TRIGGER_INDEX_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Load a TriggerIndex from a JSON file.
 * Throws if the file does not exist or contains invalid JSON.
 */
export function load(path: string = DEFAULT_TRIGGER_INDEX_PATH): TriggerIndex {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as TriggerIndex;

  // Basic structural validation
  if (!Array.isArray(parsed.patterns)) {
    throw new Error(`Invalid trigger index: "patterns" must be an array`);
  }
  if (typeof parsed.builtAt !== 'string') {
    throw new Error(`Invalid trigger index: "builtAt" must be a string`);
  }
  if (typeof parsed.totalAgentsScanned !== 'number') {
    throw new Error(`Invalid trigger index: "totalAgentsScanned" must be a number`);
  }

  return parsed;
}
