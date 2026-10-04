import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineBefore, parseLog } from '../../../src/orgrt/documents/events.js';
import { fresh, must, open, pub } from './store-support.js';

const snapPath = (dir: string) => join(dir, 'snapshot.json');
const logPath = (dir: string) => join(dir, 'events.jsonl');

function build(n: number) {
  const ctx = fresh({ snapshotEvery: 0 });
  let ref = must(ctx.store.publish(pub())).ref;
  for (let i = 0; i < n; i++) ref = must(ctx.store.publish(pub({ supersedes: ref, body: { topic: `Topic ${i}`, claims: ['c'] } }))).ref;
  return ctx;
}

describe('snapshot', () => {
  it('snapshot plus the events after it equals a full replay', () => {
    const { dir, store } = build(4);
    store.snapshot();
    must(store.publish(pub()));
    must(store.decide({ role: 'writer', id: 'brief-1', version: 5, decision: 'accept', idempotency_key: 'd' }));
    const viaSnapshot = open(dir);
    expect(viaSnapshot.info().snapshot).toEqual({ used: true });
    const full = JSON.parse(readFileSync(snapPath(dir), 'utf8'));
    writeFileSync(snapPath(dir), JSON.stringify({ ...full, run: 'other-run' })); // force a full replay
    const viaLog = open(dir);
    expect(viaLog.info().snapshot).toEqual({ used: false, reason: 'written for another run' });
    expect(viaSnapshot.list()).toEqual(viaLog.list());
    expect(viaSnapshot.info().seq).toBe(viaLog.info().seq);
    expect(viaSnapshot.info().head_hash).toBe(viaLog.info().head_hash);
  });

  it('the automatic snapshot is written every snapshotEvery events', () => {
    const { dir, store } = fresh({ snapshotEvery: 3 });
    must(store.publish(pub()));
    must(store.publish(pub()));
    expect(() => readFileSync(snapPath(dir))).toThrow();
    must(store.publish(pub()));
    expect(JSON.parse(readFileSync(snapPath(dir), 'utf8'))).toMatchObject({ format: 1, run: 'run-1', seq: 3 });
    expect(open(dir).info().snapshot.used).toBe(true);
  });

  it('records the byte offset and the hash of the line that ends there', () => {
    const { dir, store } = build(2);
    store.snapshot();
    const s = JSON.parse(readFileSync(snapPath(dir), 'utf8'));
    const log = readFileSync(logPath(dir));
    expect(s.offset).toBe(log.length);
    expect(lineBefore(log, s.offset)).toEqual({ seq: 3, hash: s.head_hash });
    expect(parseLog(log).head_hash).toBe(s.head_hash);
  });

  const reject: [string, (s: Record<string, unknown>) => void, string][] = [
    ['an offset past the end of the log', (s) => { s.offset = (s.offset as number) + 50; }, 'offset is past the end of the log'],
    ['an offset in the middle of a line', (s) => { s.offset = (s.offset as number) - 3; }, 'offset is not the end of a line'],
    ['a hash that does not match the line there', (s) => { s.head_hash = 'f'.repeat(64); }, 'does not match the log line at its offset'],
    ['another sequence than the line there', (s) => { s.seq = 2; (s.state as { seq: number }).seq = 2; }, 'does not match the log line at its offset'],
    ['a state that disagrees with its sequence', (s) => { (s.state as { seq: number }).seq = 1; }, 'state does not match its sequence'],
    ['an unknown format', (s) => { s.format = 2; }, 'unknown format'],
  ];
  it.each(reject)('rejects a snapshot with %s and replays the whole log instead', (_n, mutate, reason) => {
    const { dir, store } = build(3);
    store.snapshot();
    const s = JSON.parse(readFileSync(snapPath(dir), 'utf8'));
    mutate(s);
    writeFileSync(snapPath(dir), JSON.stringify(s));
    const again = open(dir);
    expect(again.info().snapshot).toEqual({ used: false, reason });
    expect(again.info().corrupt).toBeUndefined();
    expect(again.list()).toEqual(store.list());
  });

  it('rejects an unreadable snapshot', () => {
    const { dir, store } = build(1);
    store.snapshot();
    writeFileSync(snapPath(dir), '{trunc');
    expect(open(dir).info().snapshot).toEqual({ used: false, reason: 'unreadable' });
  });

  it('a snapshot taken before a torn tail still works after the tail is cut', () => {
    const { dir, store } = build(2);
    store.snapshot();
    appendFileSync(logPath(dir), '{"seq":4,"pr');
    const again = open(dir);
    expect(again.info()).toMatchObject({ seq: 3, snapshot: { used: true } });
    expect(again.info().torn_bytes_repaired).toBeGreaterThan(0);
  });

  it('the log wins when the snapshot is stale: events after the snapshot are replayed', () => {
    const { dir, store } = build(1);
    store.snapshot();
    for (let i = 0; i < 3; i++) must(store.publish(pub()));
    const again = open(dir);
    expect(again.list()).toHaveLength(4);
    expect(again.info().seq).toBe(5);
  });
});
