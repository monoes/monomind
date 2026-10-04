// packages/@monomind/cli/__tests__/orgrt/support/normalize-golden.ts
//
// Org sections P3.0: the normaliser behind the sections-off goldens. It maps
// only truly volatile values to fixed placeholders so a golden compares equal
// from run to run and machine to machine: run and bus-event ids, timestamps,
// pids, temp paths, uuids. Everything else (task ids such as `task-1`, message
// text, event types and reasons) is kept as it is, because that is what the
// goldens exist to pin. Tested in normalize-golden.test.ts.
import { realpathSync } from 'node:fs';

/** Keys whose numeric or string value is a clock reading or a process id. */
const VOLATILE_KEYS = new Set([
  'ts',
  'updated',
  'pid',
  'pidStart',
  'startedAt',
  'createdAt',
  'finishedAt',
  'lastActivity',
  'at',
]);

const RUN_ID = /run-\d{14}-[a-z0-9]{4}/g;
/** `<run>-<epoch ms>-<seq>` bus event ids, with an optional `-audit` suffix. */
const BUS_ID = /<RUN>-\d{13}-\d+(?:-audit)?/g;
/** `msg-<epoch ms>-<8 hex>` mailbox message ids. */
const MSG_ID = /\bmsg-\d{13}-[0-9a-f]{8}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

export interface NormalizeOptions {
  /** Absolute directories (temp project roots) to replace by `<ROOT>`. */
  roots?: string[];
}

function rootsOf(opts: NormalizeOptions): string[] {
  const out = new Set<string>();
  for (const r of opts.roots ?? []) {
    out.add(r);
    try {
      out.add(realpathSync(r));
    } catch {
      /* a root that no longer exists is only matched lexically */
    }
  }
  // longest first, so a nested root is replaced before its parent
  return [...out].sort((a, b) => b.length - a.length);
}

export function normalizeString(s: string, opts: NormalizeOptions = {}): string {
  let out = s;
  for (const r of rootsOf(opts)) out = out.split(r).join('<ROOT>');
  return out
    .replace(RUN_ID, '<RUN>')
    .replace(BUS_ID, '<ID>')
    .replace(MSG_ID, '<MSG>')
    .replace(UUID, '<UUID>')
    .replace(ISO_TIME, '<TIME>');
}

/** Deep copy of `value` with the volatile parts replaced. Key order is kept. */
export function normalizeGolden(value: unknown, opts: NormalizeOptions = {}): unknown {
  if (typeof value === 'string') return normalizeString(value, opts);
  if (Array.isArray(value)) return value.map((v) => normalizeGolden(v, opts));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[normalizeString(k, opts)] =
        VOLATILE_KEYS.has(k) && (typeof v === 'number' || typeof v === 'string')
          ? `<${k.toUpperCase()}>`
          : normalizeGolden(v, opts);
    }
    return out;
  }
  return value;
}
