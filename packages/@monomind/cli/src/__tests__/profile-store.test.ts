/**
 * Per-profile capture stores — a page saved into `work` must not come back
 * from a search of `personal`.
 *
 * The mechanism under test is deliberately the EXISTING one: a profile is a
 * scope (`profile:<id>`), so it routes through the same `effectiveRoot` /
 * `storeDbPath` / `namespace` trio that `global` already uses. So these
 * tests assert two things — that the routing sends two profiles to two
 * different stores, and that an envelope with no profile (or a hostile one)
 * behaves exactly as it did before any of this existed.
 *
 * The memory bridge is an in-memory fake, as in capture-ingest.test.ts: the
 * property is which store each chunk is written to, not any backend.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';

/** Every chunk write, with the store it was addressed to. */
const writes: Array<{ key: string; namespace: string; dbPath?: string }> = [];

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; namespace: string; dbPath?: string }) => {
    writes.push({ key: o.key, namespace: o.namespace, dbPath: o.dbPath });
    return { success: true, id: `entry_${writes.length}` };
  },
  bridgeSearchEntries: async () => ({ success: true, results: [] }),
  getProjectRoot: () => ROOT,
}));

ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-profile-'));
const BRAIN = join(ROOT, 'global-brain');
process.env.MONOMIND_GLOBAL_BRAIN_DIR = BRAIN;
process.env.MONOAGENT_PROFILES_DIR = join(ROOT, 'monoagent-profiles');

const READABLE = '# Sprocket Calibration\n\nTorque the sprocket to 9 Nm on the bench.\n';

/** makeEnvelope writes one capture envelope and returns its document. */
function makeEnvelope(name: string, meta: Record<string, unknown>): string {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'readable.md'), READABLE);
  fs.writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return join(dir, 'readable.md');
}

const baseMeta = (url: string) => ({
  url,
  canonicalUrl: url,
  title: 'Sprocket Calibration',
  capturedAt: '2026-09-21T10:00:00.000Z',
  source: 'extension',
  tags: [],
});

async function profiles() {
  return import('../knowledge/profile-store.js');
}
async function pipeline() {
  return import('../knowledge/document-pipeline.js');
}
const ingest = async (file: string, scope = 'global') =>
  (await pipeline()).ingestDocument(file, scope, ROOT);

beforeEach(() => {
  writes.length = 0;
  fs.rmSync(join(ROOT, 'inbox'), { recursive: true, force: true });
  fs.rmSync(BRAIN, { recursive: true, force: true });
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
});

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('a profile id is untrusted input that becomes a directory name', () => {
  it('refuses every id that could escape the profiles root', async () => {
    const p = await profiles();
    for (const id of ['../evil', '../../etc/passwd', 'a/b', 'a\\b', '..', 'a..b', '', '   ']) {
      expect(p.isValidProfileId(id), `accepted ${JSON.stringify(id)}`).toBe(false);
      expect(p.profileScope(id)).toBeUndefined();
      expect(p.profileBrainDir(id)).toBeUndefined();
      expect(p.profileInboxDir(id)).toBeUndefined();
      expect(p.profileStoreDir(`profile:${id}`)).toBeUndefined();
      expect(p.parseProfileScope(`profile:${id}`)).toBeUndefined();
    }
    for (const id of [null, undefined, 7, {}, ['work']]) {
      expect(p.isValidProfileId(id)).toBe(false);
    }
    for (const id of ['work', 'p-home', 'org_1', 'a.b', '6f1c2f18-0e5b-4a4c-8f3a-8a2d9a1b0c11']) {
      expect(p.isValidProfileId(id), `rejected ${id}`).toBe(true);
    }
  });

  it('never lets a hostile id out of the global brain, even as a rejected path', async () => {
    const p = await profiles();
    // The dangerous shape is a path that LOOKS resolvable; there must not be
    // one at all. Nothing is created outside the brain either.
    expect(p.profileStoreDir('profile:../../../etc')).toBeUndefined();
    expect(fs.existsSync(join(ROOT, 'etc'))).toBe(false);
  });

  it('routes a capture whose meta.json carries a hostile profile as unprofiled', async () => {
    const p = await profiles();
    const file = makeEnvelope('hostile', { ...baseMeta('https://e.com/x'), profile: '../evil' });
    expect(p.envelopeProfile(file)).toBeUndefined();
    expect(p.captureScope('global', file)).toBe('global');
  });
});

describe('a profile is a scope', () => {
  it('addresses its own directory inside the global brain', async () => {
    const p = await profiles();
    const dir = p.profileBrainDir('work');
    expect(dir).toBe(join(BRAIN, 'profiles', 'work'));
    expect(p.profileStoreDir('profile:work')).toBe(dir);
    expect(p.profileScope('work')).toBe('profile:work');
    expect(p.parseProfileScope('profile:work')).toBe('work');
    // Everything else keeps the store it always had.
    expect(p.profileStoreDir('shared')).toBeUndefined();
    expect(p.profileStoreDir('global')).toBeUndefined();
  });

  it('leaves the global and project scopes exactly where they were', async () => {
    const { effectiveRoot, storeDbPath } = await import('../knowledge/document-store.js');
    expect(storeDbPath('shared')).toBeUndefined();
    expect(storeDbPath('global')).toBe('@global');
    expect(effectiveRoot('shared', ROOT)).toBe(ROOT);
    expect(effectiveRoot('global', ROOT)).toBe(BRAIN);
    // …and a profile routes to its own.
    expect(storeDbPath('profile:work')).toBe(join(BRAIN, 'profiles', 'work'));
    expect(effectiveRoot('profile:work', ROOT)).toBe(join(BRAIN, 'profiles', 'work'));
  });

  it("knows where the Go side writes that profile's captures", async () => {
    const p = await profiles();
    expect(p.profileInboxDir('work')).toBe(
      join(ROOT, 'monoagent-profiles', 'work', '.monomind', 'inbox'),
    );

    fs.mkdirSync(join(ROOT, 'monoagent-profiles', 'work', '.monomind', 'inbox'), {
      recursive: true,
    });
    fs.mkdirSync(join(ROOT, 'monoagent-profiles', 'not-a-profile'), { recursive: true });
    expect(p.profileInboxes()).toEqual([
      {
        id: 'work',
        inbox: join(ROOT, 'monoagent-profiles', 'work', '.monomind', 'inbox'),
        scope: 'profile:work',
      },
    ]);
  });
});

describe('two profiles are two brains', () => {
  it("writes each profile's capture to its own store and namespace", async () => {
    const work = await ingest(
      makeEnvelope('work-page', { ...baseMeta('https://e.com/work'), profile: 'work' }),
    );
    const workWrites = [...writes];
    writes.length = 0;
    const personal = await ingest(
      makeEnvelope('personal-page', { ...baseMeta('https://e.com/home'), profile: 'personal' }),
    );

    expect(work.scope).toBe('profile:work');
    expect(personal.scope).toBe('profile:personal');
    expect(work.chunksIndexed).toBeGreaterThan(0);
    expect(personal.chunksIndexed).toBeGreaterThan(0);

    const store = (list: typeof writes) => [...new Set(list.map((w) => w.dbPath))];
    const ns = (list: typeof writes) => [...new Set(list.map((w) => w.namespace))];
    expect(store(workWrites)).toEqual([join(BRAIN, 'profiles', 'work')]);
    expect(store(writes)).toEqual([join(BRAIN, 'profiles', 'personal')]);
    expect(ns(workWrites)).toEqual(['knowledge:profile:work']);
    expect(ns(writes)).toEqual(['knowledge:profile:personal']);
    // Two stores, two metadata files — neither profile can see the other's.
    expect(
      fs.existsSync(
        join(BRAIN, 'profiles', 'work', '.monomind', 'knowledge', 'doc-metadata.jsonl'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        join(BRAIN, 'profiles', 'personal', '.monomind', 'knowledge', 'doc-metadata.jsonl'),
      ),
    ).toBe(true);
  });

  it("lists a profile's documents only under that profile", async () => {
    await ingest(makeEnvelope('w', { ...baseMeta('https://e.com/work'), profile: 'work' }));
    await ingest(makeEnvelope('p', { ...baseMeta('https://e.com/home'), profile: 'personal' }));
    const { listDocuments } = await pipeline();

    const workDocs = listDocuments(join(BRAIN, 'profiles', 'work'), 'profile:work');
    const homeDocs = listDocuments(join(BRAIN, 'profiles', 'personal'), 'profile:personal');
    expect(workDocs).toHaveLength(1);
    expect(homeDocs).toHaveLength(1);
    expect(workDocs[0].canonicalUrl).toBe('https://e.com/work');
    expect(homeDocs[0].canonicalUrl).toBe('https://e.com/home');
    // The global brain itself holds neither.
    expect(listDocuments(BRAIN, 'global')).toHaveLength(0);
  });

  it('carries the profile through as provenance', async () => {
    const result = await ingest(
      makeEnvelope('w', { ...baseMeta('https://e.com/work'), profile: 'work' }),
    );
    expect(result.provenance?.profile).toBe('work');

    const { normalizeProvenance } = await import('../knowledge/capture-envelope.js');
    expect(
      normalizeProvenance({ url: 'https://e.com', profile: '../evil' })?.profile,
    ).toBeUndefined();
    expect(normalizeProvenance({ url: 'https://e.com', profile: ' work ' })?.profile).toBe('work');
  });
});

describe('a capture with no profile is exactly what it always was', () => {
  it('ingests into the global brain, untouched', async () => {
    const result = await ingest(makeEnvelope('plain', baseMeta('https://e.com/plain')));

    expect(result.scope).toBe('global');
    expect(result.provenance?.profile).toBeUndefined();
    expect([...new Set(writes.map((w) => w.dbPath))]).toEqual(['@global']);
    expect([...new Set(writes.map((w) => w.namespace))]).toEqual(['knowledge:global']);
    expect(fs.existsSync(join(BRAIN, 'profiles'))).toBe(false);
  });

  it('leaves an ordinary project file in the project store', async () => {
    const loose = join(ROOT, 'notes.md');
    fs.writeFileSync(loose, '# Notes\n\nSomething worth keeping.\n');
    const result = await ingest(loose, 'shared');

    expect(result.scope).toBe('shared');
    expect([...new Set(writes.map((w) => w.dbPath))]).toEqual([undefined]);
    expect([...new Set(writes.map((w) => w.namespace))]).toEqual(['knowledge:shared']);
  });

  it('honours a caller that names a profile scope itself', async () => {
    const file = makeEnvelope('plain2', baseMeta('https://e.com/plain'));
    const result = await ingest(file, 'profile:work');
    expect(result.scope).toBe('profile:work');
    expect([...new Set(writes.map((w) => w.dbPath))]).toEqual([join(BRAIN, 'profiles', 'work')]);
  });
});
