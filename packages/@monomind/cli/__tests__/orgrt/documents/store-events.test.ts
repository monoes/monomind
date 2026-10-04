import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, parseLog, sha256 } from '../../../src/orgrt/documents/events.js';
import { applyEvent, emptyState } from '../../../src/orgrt/documents/state.js';
import { DocumentStore } from '../../../src/orgrt/documents/store.js';
import { briefBinding, fresh, good, must, open, pub, refusal, tmp } from './store-support.js';

const here = dirname(fileURLToPath(import.meta.url));
const logOf = (dir: string) => join(dir, 'events.jsonl');
const lines = (dir: string) => readFileSync(logOf(dir), 'utf8').split('\n').filter(Boolean);

/** A flow with publishes, a rejection, a republish, decisions, reads and counted refusals. */
function flow(store: DocumentStore) {
  const a = must(store.publish(pub({ idempotency_key: 'p1' })));
  store.publish(pub({ idempotency_key: 'bad', body: {} }));
  store.read({ role: 'writer', id: a.id });
  must(store.decide({ role: 'writer', id: a.id, version: 1, decision: 'reject', reason: 'no', idempotency_key: 'd1' }));
  const b = must(store.publish(pub({ idempotency_key: 'p2', supersedes: a.ref, note: 'fixed' })));
  must(store.decide({ role: 'writer', id: a.id, version: 2, decision: 'accept', idempotency_key: 'd2' }));
  must(store.decide({ role: 'reviewer', id: a.id, version: 2, decision: 'accept', idempotency_key: 'd3' }));
  must(store.publish(pub({ idempotency_key: 'p3' })));
  return b;
}

describe('persisted layout', () => {
  it('writes events.jsonl, immutable bodies without a status, contract snapshots and nothing else but a snapshot', () => {
    const { dir, store } = fresh();
    const v = must(store.publish(pub()));
    store.snapshot();
    expect(readdirSync(dir).sort()).toEqual(['contracts', 'events.jsonl', 'research', 'snapshot.json']);
    expect(readdirSync(join(dir, 'research', 'brief'))).toEqual(['brief-1@v1.json']);
    const body = JSON.parse(readFileSync(join(dir, 'research', 'brief', 'brief-1@v1.json'), 'utf8'));
    expect(body).toMatchObject({ id: 'brief-1', version: 1, type: 'brief', section: 'research', producer: 'researcher', run: 'run-1', body: good });
    expect(Object.keys(body)).not.toContain('status');
    expect(readdirSync(join(dir, 'contracts'))).toEqual([`brief@${v.contract_revision}.json`]);
    expect(sha256(readFileSync(join(dir, 'contracts', `brief@${v.contract_revision}.json`), 'utf8').trimEnd())).toBe(v.contract_revision);
  });

  it('matches the persisted-format golden: event lines, body file and chain, byte for byte', () => {
    const dir = tmp('p35-golden-');
    const store = open(dir, { snapshotEvery: 0 });
    flow(store);
    const path = join(here, 'fixtures/store-v1/golden.json');
    const actual = { events: lines(dir), body: readFileSync(join(dir, 'research', 'brief', 'brief-1@v2.json'), 'utf8') };
    if (process.env.UPDATE_STORE_GOLDEN) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(path, 'utf8')) as { events: string[]; body: string };
    expect(lines(dir)).toEqual(golden.events);
    expect(readFileSync(join(dir, 'research', 'brief', 'brief-1@v2.json'), 'utf8')).toBe(golden.body);
  });

  it('every event is sequenced from 1 and chained to the hash of the line before it', () => {
    const { dir, store } = fresh();
    flow(store);
    let prev = GENESIS_HASH;
    lines(dir).forEach((l, i) => {
      const e = JSON.parse(l);
      expect(e.seq).toBe(i + 1);
      expect(e.prev).toBe(prev);
      prev = sha256(l);
    });
    expect(store.info().head_hash).toBe(prev);
  });
});

describe('replay', () => {
  it('state after N events equals the state rebuilt from the log, at every N', () => {
    const { dir, store } = fresh({ snapshotEvery: 0 });
    flow(store);
    const all = parseLog(readFileSync(logOf(dir))).events;
    const live = emptyState();
    for (const e of all) {
      applyEvent(live, e);
      const rebuilt = emptyState();
      for (const x of parseLog(readFileSync(logOf(dir))).events.slice(0, e.seq)) applyEvent(rebuilt, x);
      expect(rebuilt).toEqual(live);
    }
  });

  it('a reopened store reports the same documents, receipts and counters as the live one', () => {
    const { dir, store } = fresh();
    flow(store);
    const again = open(dir);
    expect(again.list()).toEqual(store.list());
    expect(again.attempts('brief')).toEqual(store.attempts('brief'));
    expect(again.info().seq).toBe(store.info().seq);
    expect(must(again.publish(pub({ idempotency_key: 'p1' }))).replayed).toBe(true); // idempotency survives a reopen
    expect(must(again.publish(pub())).ref).toBe('brief-3@v1');
  });

  it('is deterministic: two replays of one log give identical state, and the reopened store keeps appending', () => {
    const { dir, store } = fresh({ snapshotEvery: 0 });
    flow(store);
    const x = open(dir, { snapshotEvery: 0 });
    const y = open(dir, { snapshotEvery: 0 });
    expect(x.list()).toEqual(y.list());
    must(x.publish(pub()));
    expect(lines(dir).length).toBe(store.info().seq + 1);
    expect(open(dir).info().corrupt).toBeUndefined();
  });

  it('refuses a reordered log (swapped lines) as corruption, and says where', () => {
    const { dir, store } = fresh();
    flow(store);
    const l = lines(dir);
    [l[2], l[3]] = [l[3], l[2]];
    writeFileSync(logOf(dir), `${l.join('\n')}\n`);
    const s = open(dir);
    expect(s.info().corrupt?.code).toBe('STORE_CORRUPT');
    expect(s.info().corrupt?.message).toMatch(/sequence 4 where 3/);
    expect(refusal(s.publish(pub())).code).toBe('STORE_CORRUPT');
    expect(refusal(s.decide({ role: 'writer', id: 'brief-1', version: 1, decision: 'accept', idempotency_key: 'z' })).code).toBe('STORE_CORRUPT');
    expect(refusal(s.read({ role: 'writer', id: 'brief-1' })).code).toBe('STORE_CORRUPT');
    expect(readFileSync(logOf(dir), 'utf8')).toBe(`${l.join('\n')}\n`); // nothing was repaired or rewritten
  });

  it.each([
    ['a dropped line', (l: string[]) => l.filter((_, i) => i !== 3)],
    ['a duplicated line', (l: string[]) => [...l.slice(0, 3), l[2], ...l.slice(3)]],
    ['an edited line', (l: string[]) => l.map((x, i) => (i === 3 ? x.replace('"by":"', '"by":"x') : x))],
    ['garbage in the middle', (l: string[]) => [...l.slice(0, 3), '{not json', ...l.slice(3)]],
    ['an unknown event type', (l: string[]) => l.map((x, i) => (i === 3 ? x.replace(/"type":"[a-z]+"/, '"type":"mystery"') : x))],
  ])('detects %s as corruption', (_n, mutate) => {
    const { dir, store } = fresh();
    flow(store);
    writeFileSync(logOf(dir), `${mutate(lines(dir)).join('\n')}\n`);
    expect(open(dir).info().corrupt?.code).toBe('STORE_CORRUPT');
  });

  it('a log whose events contradict the state (a decision on a version that does not exist) is corruption', () => {
    const { dir, store } = fresh();
    must(store.publish(pub()));
    const bogus = { seq: 2, prev: sha256(lines(dir)[0]), at: 'x', type: 'decided', op: 'decide:w:k', doc: 'brief-1', version: 9, consumer: 'writing', by: 'writer', decision: 'accept', payload_sha256: 'x', contract_revision: 'x', status_after: 'pending', waiting_on: [] };
    appendFileSync(logOf(dir), `${JSON.stringify(bogus)}\n`);
    expect(open(dir).info().corrupt?.message).toMatch(/does not exist/);
  });
});

describe('crash safety', () => {
  it.each([
    ['half a line, no newline', (l: string) => l.slice(0, Math.floor(l.length / 2))],
    ['a whole line missing only its newline', (l: string) => l],
    ['a complete-looking but unparseable final line', (l: string) => `${l.slice(0, 20)}\u0000\u0000\u0000\n`],
  ])('discards and repairs a torn final event: %s', (_n, tail) => {
    const { dir, store } = fresh();
    const a = must(store.publish(pub()));
    const good1 = readFileSync(logOf(dir), 'utf8');
    const next = JSON.stringify({ seq: 2, prev: sha256(lines(dir)[0]), at: 'x', type: 'read', doc: a.id, version: 1, by: 'writer', purpose: 'work' });
    appendFileSync(logOf(dir), tail(next));
    const s = open(dir);
    expect(s.info().corrupt).toBeUndefined();
    expect(s.info().torn_bytes_repaired).toBeGreaterThan(0);
    expect(s.info().seq).toBe(1);
    expect(readFileSync(logOf(dir), 'utf8')).toBe(good1); // the tail was cut off
    expect(must(s.publish(pub())).ref).toBe('brief-2@v1'); // and the log keeps going with seq 2
    expect(open(dir).info().seq).toBe(2);
  });

  it('ignores a body with no committed event (a crash between the rename and the append), and a later publish overwrites it', () => {
    const { dir, store } = fresh();
    must(store.publish(pub()));
    mkdirSync(join(dir, 'research', 'brief'), { recursive: true });
    writeFileSync(join(dir, 'research', 'brief', 'brief-2@v1.json'), '{"orphan":true}');
    const s = open(dir);
    expect(s.list().map((d) => d.id)).toEqual(['brief-1']);
    expect(s.info().bad_bodies).toEqual([]);
    expect(must(s.publish(pub())).ref).toBe('brief-2@v1');
    expect(must(s.peek('brief-2')).body).toEqual(good);
  });

  it('flags a committed event whose body is missing as corruption: reads, decisions and a supersede of it are refused, other documents work', () => {
    const { dir, store } = fresh();
    const a = must(store.publish(pub()));
    const b = must(store.publish(pub()));
    rmSync(join(dir, 'research', 'brief', 'brief-1@v1.json'));
    const s = open(dir);
    expect(s.info().bad_bodies).toEqual([{ ref: 'brief-1@v1', code: 'BODY_MISSING' }]);
    expect(refusal(s.read({ role: 'writer', id: a.id })).code).toBe('BODY_MISSING');
    expect(refusal(s.decide({ role: 'writer', id: a.id, version: 1, decision: 'accept', idempotency_key: 'x' })).code).toBe('BODY_MISSING');
    expect(refusal(s.publish(pub({ supersedes: a.ref }))).code).toBe('BODY_MISSING');
    expect(must(s.read({ role: 'writer', id: b.id })).version).toBe(1);
  });

  it('refuses a body whose bytes no longer match the hash its event recorded', () => {
    const { dir, store } = fresh();
    const a = must(store.publish(pub()));
    const f = join(dir, 'research', 'brief', 'brief-1@v1.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('Pricing page', 'Pricing PAGE'));
    expect(refusal(store.read({ role: 'writer', id: a.id })).code).toBe('BODY_CORRUPT');
  });

  it('stops when the log changed under it (another writer, or a failed write) instead of forking the chain', () => {
    const { dir, store } = fresh();
    must(store.publish(pub()));
    appendFileSync(logOf(dir), 'intruder\n');
    expect(refusal(store.publish(pub())).code).toBe('LOG_DIVERGED');
    expect(refusal(store.publish(pub())).code).toBe('STORE_CORRUPT');
  });

  it('a temp file left by a crash during a body write is harmless', () => {
    const { dir, store } = fresh();
    must(store.publish(pub()));
    writeFileSync(join(dir, 'research', 'brief', 'brief-2@v1.json.4242.tmp'), 'half');
    const s = open(dir);
    expect(must(s.publish(pub())).ref).toBe('brief-2@v1');
  });

  it('a body is written before its event: the event log never names a body that was not durable', () => {
    const { dir, store } = fresh();
    const seen: boolean[] = [];
    store.onCommitted((e) => { if (e.type === 'published') seen.push(existsSync(join(dir, 'research', 'brief', `${e.doc}@v${e.version}.json`))); });
    must(store.publish(pub()));
    expect(seen).toEqual([true]);
  });
});

describe('concurrency inside one process', () => {
  it('many publishes, decisions and reads interleaved through async callers get distinct contiguous sequences', async () => {
    const { dir, store } = fresh({ snapshotEvery: 0 });
    const jobs = Array.from({ length: 60 }, (_, i) =>
      Promise.resolve().then(() => {
        if (i % 3 === 0) return store.publish(pub({ idempotency_key: `dup-${i % 6}` })); // duplicate keys interleave too
        if (i % 3 === 1) return store.read({ role: 'writer', id: 'brief-1' });
        return store.publish(pub({ body: i % 2 ? good : {} }));
      }),
    );
    await Promise.all(jobs);
    const parsed = parseLog(readFileSync(logOf(dir)));
    expect(parsed.corruption).toBeUndefined();
    expect(parsed.events.map((e) => e.seq)).toEqual(Array.from({ length: parsed.events.length }, (_, i) => i + 1));
    const again = open(dir);
    expect(again.info().corrupt).toBeUndefined();
    expect(again.list()).toEqual(store.list());
    const keys = parsed.events.filter((e) => e.type === 'published').map((e) => (e as { op: string }).op);
    expect(new Set(keys).size).toBe(keys.length); // an idempotency key commits once
  });

  it('operations are serialised: a second operation started while one commits is refused, never interleaved', () => {
    const { store } = fresh();
    const out: string[] = [];
    store.onCommitted(() => out.push(store.read({ role: 'writer', id: 'brief-1' }).ok ? 'ran' : 'refused'));
    must(store.publish(pub()));
    expect(out).toEqual(['refused']);
  });
});

describe('construction', () => {
  it('refuses bad bindings: duplicate types, bad sections, no producers, no deciders, an invalid contract', () => {
    const dir = tmp();
    const mk = (b: object) => () => new DocumentStore({ dir, run: 'r', bindings: [b as never] });
    expect(mk({ ...briefBinding(), section: 'Bad Section' })).toThrow(/section/);
    expect(mk({ ...briefBinding(), producers: [] })).toThrow(/producer/);
    expect(mk({ ...briefBinding(), consumers: [{ id: 'writing', deciders: [] }] })).toThrow(/decider/);
    expect(mk({ ...briefBinding(), consumers: [{ id: 'a', deciders: ['x'] }, { id: 'a', deciders: ['y'] }] })).toThrow(/twice/);
    expect(mk({ ...briefBinding({ schema: { type: 'string', pattern: 'a' } }) })).toThrow(/pattern/);
    expect(() => new DocumentStore({ dir, run: 'r', bindings: [briefBinding(), briefBinding()] })).toThrow(/twice/);
  });

  it('creates no files until it has something to say except the contract snapshots', () => {
    const dir = join(tmp(), 'docs', 'run-1');
    open(dir);
    expect(readdirSync(dir)).toEqual(['contracts']);
    expect(existsSync(logOf(dir))).toBe(false);
  });

  it('a contract snapshot that no longer matches its revision is corruption', () => {
    const { dir, store } = fresh();
    const v = must(store.publish(pub()));
    const f = join(dir, 'contracts', `brief@${v.contract_revision}.json`);
    writeFileSync(f, `${readFileSync(f, 'utf8')} `);
    expect(open(dir).info().corrupt?.message).toMatch(/contract snapshot/);
  });
});
