// orgrt/documents/snapshot.ts
//
// The derived-state snapshot (org sections spec 6.2, checkpoint R15): the state at event `seq`, with the byte
// offset the log had then and the hash of the line that ends there. Opening the store loads the snapshot and
// replays only the events after `offset`; a snapshot is never authoritative, so one that does not fit the log
// (written for another run, an offset past the end or not on a line boundary, a hash that does not match the line
// there) is rejected with a reason and the store replays the whole log instead.
import { existsSync, readFileSync } from 'node:fs';
import { lineBefore } from './events.js';
import { type DocState } from './state.js';
import { STORE_FORMAT } from './store-types.js';
import { writeFileDurable } from './durable-fs.js';

export interface Snapshot {
  format: number;
  run: string;
  seq: number;
  offset: number;
  head_hash: string;
  state: DocState;
}

export function writeSnapshot(path: string, snap: Snapshot): void {
  writeFileDurable(path, JSON.stringify(snap));
}

export type SnapshotCheck = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

/** Read the snapshot at `path` and check it against the log bytes it claims to describe. */
export function loadSnapshot(path: string, run: string, log: Buffer): SnapshotCheck {
  if (!existsSync(path)) return { ok: false, reason: 'none' };
  let s: Snapshot;
  try {
    s = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (typeof s !== 'object' || s === null || s.format !== STORE_FORMAT)
    return { ok: false, reason: 'unknown format' };
  if (s.run !== run) return { ok: false, reason: 'written for another run' };
  if (!Number.isInteger(s.offset) || !Number.isInteger(s.seq) || s.seq < 1 || s.offset < 1)
    return { ok: false, reason: 'bad position' };
  if (s.offset > log.length) return { ok: false, reason: 'offset is past the end of the log' };
  const line = lineBefore(log, s.offset);
  if (!line) return { ok: false, reason: 'offset is not the end of a line' };
  if (line.seq !== s.seq || line.hash !== s.head_hash)
    return { ok: false, reason: 'does not match the log line at its offset' };
  if (typeof s.state !== 'object' || s.state === null || s.state.seq !== s.seq)
    return { ok: false, reason: 'state does not match its sequence' };
  return { ok: true, snapshot: s };
}
