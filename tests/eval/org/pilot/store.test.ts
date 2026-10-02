import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type DocContract, HandoffStore, MAX_DOC_CHARS } from './store.js';

const contract: DocContract = {
  id: 'brief',
  title: 'Content brief',
  producer: 'researcher',
  consumers: ['writer', 'reviewer'],
  max_attempts: 3,
  schema: {
    type: 'object',
    required: ['topic', 'claims'],
    additionalProperties: false,
    properties: {
      topic: { type: 'string', minLength: 3 },
      claims: { type: 'array', minItems: 1, items: { type: 'string' } },
    },
  },
};
const good = { topic: 'Pricing page', claims: ['v2.22 ships sections'] };
const fresh = (contracts = [contract]) => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-store-'));
  return { dir, store: new HandoffStore(dir, contracts) };
};

describe('publish', () => {
  it('accepts a conforming document from its producer as a pending version 1', () => {
    const { store } = fresh();
    expect(store.publish('researcher', 'brief', good)).toEqual({
      ok: true,
      version: 1,
      status: 'pending',
    });
  });

  it('refuses a document that fails its schema, names the problems, creates no version, and counts the attempt', () => {
    const { store } = fresh();
    const r = store.publish('researcher', 'brief', { topic: 'x' }) as {
      ok: false;
      error: string;
      problems: string[];
    };
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(
      expect.arrayContaining(['$.topic: shorter than 3 characters', '$.claims: required']),
    );
    expect(store.read('writer', 'brief')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no version/),
    });
    expect(store.attempts('brief')).toBe(1);
  });

  it('refuses anyone but the producer and an unknown document', () => {
    const { store } = fresh();
    expect(store.publish('writer', 'brief', good)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/only researcher/),
    });
    expect(store.publish('researcher', 'nope', good)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown document/),
    });
  });

  it('caps publish attempts, schema failures included, and says what to do', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', {});
    store.publish('researcher', 'brief', {});
    store.publish('researcher', 'brief', good);
    expect(store.publish('researcher', 'brief', good)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/3 publish attempts.*lead/),
    });
  });

  it('refuses a document over the size limit', () => {
    const { store } = fresh();
    const big = { topic: 'Big', claims: ['x'.repeat(MAX_DOC_CHARS)] };
    expect(store.publish('researcher', 'brief', big)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/over/),
    });
  });

  it('supersedes the earlier pending version when a revision is published', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', good);
    expect(store.publish('researcher', 'brief', { ...good, topic: 'Pricing v2' })).toMatchObject({
      version: 2,
    });
    expect(store.read('writer', 'brief', 1)).toMatchObject({
      ok: true,
      doc: { status: 'superseded' },
    });
  });
});

describe('read', () => {
  it('lets the producer and each consumer read, and refuses everyone else', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', good);
    for (const role of ['researcher', 'writer', 'reviewer'])
      expect(store.read(role, 'brief')).toMatchObject({ ok: true });
    expect(store.read('intruder', 'brief')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a producer or consumer/),
    });
  });

  it('returns the latest accepted version when there is one, else the latest', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', good);
    expect(store.read('writer', 'brief')).toMatchObject({ doc: { version: 1, status: 'pending' } });
    store.decide('writer', 'brief', 1, 'accept');
    store.decide('reviewer', 'brief', 1, 'accept');
    store.publish('researcher', 'brief', { ...good, topic: 'Second' });
    expect(store.read('writer', 'brief')).toMatchObject({
      doc: { version: 1, status: 'accepted' },
    });
    expect(store.read('writer', 'brief', 2)).toMatchObject({
      doc: { version: 2, status: 'pending' },
    });
  });
});

describe('decide: acceptance is per consumer', () => {
  it('accepts a version only when every consumer has accepted', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', good);
    expect(store.decide('writer', 'brief', 1, 'accept')).toMatchObject({
      ok: true,
      status: 'pending',
      waiting_on: ['reviewer'],
    });
    expect(store.decide('reviewer', 'brief', 1, 'accept')).toMatchObject({
      ok: true,
      status: 'accepted',
      waiting_on: [],
    });
  });

  it('rejects the version as soon as one consumer rejects, and requires a reason', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', good);
    expect(store.decide('writer', 'brief', 1, 'reject')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/reason/),
    });
    expect(store.decide('writer', 'brief', 1, 'reject', 'claims unsourced')).toMatchObject({
      ok: true,
      status: 'rejected',
    });
    expect(store.read('researcher', 'brief', 1)).toMatchObject({
      doc: { decisions: { writer: { decision: 'reject', reason: 'claims unsourced' } } },
    });
  });

  it('refuses a decision from a non-consumer, on a superseded version, and a changed mind', () => {
    const { store } = fresh();
    store.publish('researcher', 'brief', good);
    expect(store.decide('researcher', 'brief', 1, 'accept')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a consumer/),
    });
    store.publish('researcher', 'brief', { ...good, topic: 'Rev two' });
    expect(store.decide('writer', 'brief', 1, 'accept')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/superseded by version 2/),
    });
    store.decide('writer', 'brief', 2, 'accept');
    expect(store.decide('writer', 'brief', 2, 'accept')).toMatchObject({ ok: true }); // the same decision again is idempotent
    expect(store.decide('writer', 'brief', 2, 'reject', 'changed my mind')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already accepted/),
    });
  });

  it('refuses a decision on a version that does not exist', () => {
    const { store } = fresh();
    expect(store.decide('writer', 'brief', 1, 'accept')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no version 1/),
    });
  });
});

describe('the harness-owned store', () => {
  it('survives a restart of the harness process', () => {
    const { dir, store } = fresh();
    store.publish('researcher', 'brief', good);
    store.decide('writer', 'brief', 1, 'accept');
    const again = new HandoffStore(dir, [contract]);
    expect(again.read('reviewer', 'brief')).toMatchObject({
      doc: { version: 1, decisions: { writer: { decision: 'accept' } } },
    });
    expect(again.attempts('brief')).toBe(1);
  });

  it('records every call, accepted or refused, in an events log', () => {
    const { dir, store } = fresh();
    store.publish('researcher', 'brief', {});
    store.publish('researcher', 'brief', good);
    store.read('intruder', 'brief');
    store.decide('writer', 'brief', 1, 'accept');
    const events = readFileSync(join(dir, 'pilot-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events.map((e) => [e.kind, e.ok])).toEqual([
      ['publish', false],
      ['publish', true],
      ['read', false],
      ['decide', true],
    ]);
    expect(events[0]).toMatchObject({ role: 'researcher', doc: 'brief' });
  });

  it('refuses a contract whose schema leaves the dialect, and one that names no consumer', () => {
    expect(() => fresh([{ ...contract, schema: { type: 'string', pattern: 'a' } }])).toThrow(
      /pattern/,
    );
    expect(() => fresh([{ ...contract, consumers: [] }])).toThrow(/consumer/);
  });
});
