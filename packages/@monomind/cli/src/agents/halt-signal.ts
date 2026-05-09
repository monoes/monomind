/**
 * Halt Signal (Task 35)
 *
 * JSONL-based broadcast/check for swarm-level halt signals.
 * When an agent triggers a cascade halt, other agents in the same swarm
 * can query whether a halt has been issued.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import type { TerminationReason } from '../../../shared/src/types/termination.js';

/** Record written to the JSONL halt log. */
export interface HaltRecord {
  id: string;
  swarmId: string;
  sourceAgentId: string;
  reason: TerminationReason;
  haltedAt: string; // ISO string
}

const ALLOWED_ROOT = () => resolve(process.env.MONOMIND_DATA_DIR ?? process.cwd());

const DEFAULT_FILE = () => join(ALLOWED_ROOT(), 'data', 'halt-signals.jsonl');

function safeHaltFilePath(filePath: string): string {
  const allowedRoot = ALLOWED_ROOT();
  const resolved = resolve(filePath);
  if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + sep)) {
    throw new Error(`Halt signal file path escapes allowed directory: ${filePath}`);
  }
  return resolved;
}

/**
 * Broadcast a halt signal for a swarm.
 */
export function broadcast(
  swarmId: string,
  sourceAgentId: string,
  reason: TerminationReason,
  filePath?: string,
): HaltRecord {
  const target = filePath ? safeHaltFilePath(filePath) : DEFAULT_FILE();
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
  const target = filePath ? safeHaltFilePath(filePath) : DEFAULT_FILE();
  if (!existsSync(target)) {
    return false;
  }

  // Size cap. isHalted is on the swarm-coordination hot path; without this
  // cap a planted multi-GB file (or unbounded broadcast accumulation over
  // weeks) reliably OOMs the CLI on the next call. Treat oversized halt
  // logs as "no halt" — fail-safe in the swarm-termination flow.
  try {
    const stat = statSync(target);
    if (stat.size > 10 * 1024 * 1024) return false;
  } catch {
    return false;
  }

  const raw = readFileSync(target, 'utf-8').trim();
  if (!raw) return false;

  return raw
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      try {
        const rec = JSON.parse(line) as HaltRecord;
        return rec.swarmId === swarmId;
      } catch {
        return false;
      }
    });
}
