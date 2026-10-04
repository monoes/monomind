// orgrt/documents/events.ts
//
// The append-only event log of the document store (org sections spec 6.2): one JSON object per line, each with
// a contiguous sequence number and the sha-256 of the previous line's text (an integrity chain, so a reordered,
// dropped, edited or duplicated line is found on replay). An append is one write of the whole line, then fsync,
// before the caller acknowledges anything.
//
// Replay rules: a final line that has no newline, or does not parse, is a torn write (a crash mid-append): it is
// discarded and, when the log is opened for writing, truncated away. Anything else wrong (a bad line in the
// middle, a sequence gap or repeat, a chain mismatch, an unknown event type) is corruption and stops replay.
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fsyncDir, mkdirDurable } from './durable-fs.js';
import type { StoreEvent } from './store-types.js';

export const GENESIS_HASH = '0'.repeat(64);
export const EVENT_TYPES = ['published', 'refused', 'decided', 'read'] as const;

export const sha256 = (text: string | Buffer): string =>
  createHash('sha256').update(text).digest('hex');

export interface LogCorruption {
  code: 'LOG_CORRUPT';
  /** The sequence number that was expected where the bad line is. */
  seq: number;
  offset: number;
  message: string;
}

export interface LogPosition {
  /** Byte offset just after the last good line. */
  offset: number;
  /** Sequence of the last good line (0 for an empty log). */
  seq: number;
  /** Hash of the last good line; GENESIS_HASH for an empty log. */
  head_hash: string;
}

export interface ParsedLog extends LogPosition {
  events: StoreEvent[];
  /** Bytes of a torn final line that follow `offset` (0 when the log ends cleanly). */
  torn_bytes: number;
  corruption?: LogCorruption;
}

/** Parse the log bytes after `from` (the whole log when omitted). Pure. */
export function parseLog(
  buf: Buffer,
  from: LogPosition = { offset: 0, seq: 0, head_hash: GENESIS_HASH },
): ParsedLog {
  const out: ParsedLog = { ...from, events: [], torn_bytes: 0 };
  let pos = from.offset;
  const fail = (message: string): ParsedLog => ({
    ...out,
    corruption: { code: 'LOG_CORRUPT', seq: out.seq + 1, offset: pos, message },
  });
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) return { ...out, torn_bytes: buf.length - pos };
    const text = buf.subarray(pos, nl).toString('utf8');
    const last = nl + 1 >= buf.length;
    let ev: unknown;
    try {
      ev = JSON.parse(text);
    } catch {
      return last
        ? { ...out, torn_bytes: buf.length - pos }
        : fail('a line in the middle of the log does not parse');
    }
    const e = ev as Partial<StoreEvent> | null;
    if (typeof e !== 'object' || e === null || Array.isArray(e))
      return fail('a line is not an event object');
    if (e.seq !== out.seq + 1)
      return fail(`sequence ${String(e.seq)} where ${out.seq + 1} was expected`);
    if (e.prev !== out.head_hash)
      return fail(`event ${e.seq} does not chain from the line before it`);
    if (typeof e.at !== 'string' || !(EVENT_TYPES as readonly string[]).includes(String(e.type)))
      return fail(`event ${e.seq} has an unknown type or no timestamp`);
    out.events.push(e as StoreEvent);
    out.seq = e.seq as number;
    out.head_hash = sha256(text);
    pos = nl + 1;
    out.offset = pos;
  }
  return out;
}

/** The hash and sequence of the line that ends just before `offset`, or undefined when `offset` is not a line end. */
export function lineBefore(buf: Buffer, offset: number): { seq: number; hash: string } | undefined {
  if (offset <= 0 || offset > buf.length || buf[offset - 1] !== 0x0a) return undefined;
  const start = buf.lastIndexOf(0x0a, offset - 2) + 1;
  const text = buf.subarray(start, offset - 1).toString('utf8');
  try {
    const seq = (JSON.parse(text) as { seq?: unknown }).seq;
    return typeof seq === 'number' ? { seq, hash: sha256(text) } : undefined;
  } catch {
    return undefined;
  }
}

type Body = { type: StoreEvent['type'] } & Record<string, unknown>;

export class EventLog {
  private pos: LogPosition;

  constructor(
    readonly path: string,
    pos: LogPosition,
  ) {
    this.pos = { ...pos };
  }

  get position(): LogPosition {
    return { ...this.pos };
  }

  /** Cut a torn tail off the file (crash recovery), durably. */
  static truncate(path: string, offset: number): void {
    const fd = openSync(path, 'r+');
    try {
      ftruncateSync(fd, offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  static read(path: string): Buffer {
    return existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  }

  /** True when the file is exactly as long as this log last left it (nobody else appended or cut it). */
  intact(): boolean {
    const size = existsSync(this.path) ? statSync(this.path).size : 0;
    return size === this.pos.offset;
  }

  /** Append one event: sequence and chain are assigned here. Throws on an I/O error (nothing was acknowledged). */
  append(body: Body, at: string): StoreEvent {
    const event = {
      seq: this.pos.seq + 1,
      prev: this.pos.head_hash,
      at,
      ...body,
    } as unknown as StoreEvent;
    const text = JSON.stringify(event);
    const fresh = !existsSync(this.path);
    if (fresh) mkdirDurable(dirname(this.path));
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, `${text}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (fresh) fsyncDir(dirname(this.path));
    this.pos = {
      seq: event.seq,
      head_hash: sha256(text),
      offset: this.pos.offset + Buffer.byteLength(text) + 1,
    };
    return event;
  }
}
