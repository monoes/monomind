/**
 * Halt Signal (Task 35)
 *
 * JSONL-based broadcast/check for swarm-level halt signals.
 * When an agent triggers a cascade halt, other agents in the same swarm
 * can query whether a halt has been issued.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { TerminationReason } from '../../../shared/src/types/termination.js';

/** Record written to the JSONL halt log. */
export interface HaltRecord {
  id: string;
  swarmId: string;
  sourceAgentId: string;
  reason: TerminationReason;
  haltedAt: string; // ISO string
}

const DEFAULT_FILE = () => join(process.cwd(), 'data', 'halt-signals.jsonl');

/**
 * Broadcast a halt signal for a swarm.
 */
export function broadcast(
  swarmId: string,
  sourceAgentId: string,
  reason: TerminationReason,
  filePath?: string,
): HaltRecord {
  const target = filePath ?? DEFAULT_FILE();
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const record: HaltRecord = {
    id: randomUUID(),
    swarmId,
    sourceAgentId,
    reason,
    haltedAt: new Date().toISOString(),
  };

  appendFileSync(target, JSON.stringify(record) + '\n', 'utf-8');
  return record;
}

/**
 * Check whether any halt signal exists for the given swarm.
 */
export function isHalted(
  swarmId: string,
  filePath?: string,
): boolean {
  const target = filePath ?? DEFAULT_FILE();
  if (!existsSync(target)) {
    return false;
  }

  const raw = readFileSync(target, 'utf-8').trim();
  if (!raw) return false;

  return raw
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      const rec = JSON.parse(line) as HaltRecord;
      return rec.swarmId === swarmId;
    });
}
