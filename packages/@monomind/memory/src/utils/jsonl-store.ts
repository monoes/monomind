/**
 * Shared JSONL append/read/rewrite helpers.
 *
 * Previously hand-copied twice in this package (knowledge-store.ts and
 * prompt-version-store.ts) and already drifted on write semantics: an
 * empty-collection rewrite produced a genuinely empty file in one and a
 * one-byte `"\n"` file in the other, and both readers threw on a single
 * corrupt line, losing the whole file — unlike the CLI package's
 * `parseJsonl()` (utils/parse-jsonl.ts), which never throws and drops bad
 * lines individually. This module adopts the empty-file write behavior and
 * the tolerant read behavior as the shared contract.
 *
 * @module @monomind/memory/utils/jsonl-store
 */
import * as fs from 'node:fs';
import { writeFileAtomicSync } from '../atomic-file.js';

/** Append one record as a JSONL line. */
export function appendJsonl<T>(file: string, record: T): void {
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
}

/**
 * Read all records from a JSONL file. Never throws on a malformed line —
 * bad lines are silently dropped, matching parse-jsonl.ts's CLI-side
 * contract, so one corrupt line can't lose the rest of the file.
 */
export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf-8');
  if (!content.trim()) return [];
  const out: T[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed line — never lose the rest of the file over one bad record
    }
  }
  return out;
}

/**
 * Atomically rewrite a JSONL file from a full in-memory record set (tmp +
 * rename, via atomic-file.ts's writeFileAtomicSync — a crash mid-write must
 * not leave a truncated index). An empty `records` array writes a genuinely
 * empty file, not a lone `"\n"` — the write-semantics gap that had already
 * diverged between the two prior hand-copied implementations.
 */
export function rewriteJsonl<T>(file: string, records: T[]): void {
  const data = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  writeFileAtomicSync(file, data, 'utf-8');
}
