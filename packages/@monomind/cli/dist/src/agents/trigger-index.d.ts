/**
 * Trigger Index Persistence (Task 32)
 *
 * Handles saving and loading the TriggerIndex JSON file
 * at `.monomind/trigger-index.json` (or a custom path).
 */
import type { TriggerIndex } from '../../../../@monoes/shared/src/types/trigger.js';
/** Default path for the persisted trigger index. */
export declare const DEFAULT_TRIGGER_INDEX_PATH = ".monomind/trigger-index.json";
/**
 * Save a TriggerIndex to a JSON file.
 * Creates parent directories if they don't exist.
 */
export declare function save(index: TriggerIndex, path?: string): void;
/**
 * Load a TriggerIndex from a JSON file.
 * Throws if the file does not exist or contains invalid JSON.
 */
export declare function load(path?: string): TriggerIndex;
//# sourceMappingURL=trigger-index.d.ts.map