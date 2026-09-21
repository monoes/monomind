/**
 * RCL-03 — related-at-save.
 *
 * This runs on every capture, in front of the user, so the behaviours worth
 * pinning are mostly about what it does when things are NOT fine: an empty
 * store, a URL nobody captured, a vector search that hangs or throws. All of
 * those are an empty list or the cheap signals alone — never an exception,
 * because a capture must not fail because the sidebar had nothing to say.
 *
 * The fake bridge scores by word overlap with the query so "similar" means
 * something specific and assertable here, instead of depending on a model.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';
const store = new Map<string, { value: string; tags: string[] }>();
let searchBehaviour: 'overlap' | 'throw' | 'hang' | 'empty' = 'overlap';

function overlapScore(query: string, text: string): number {
  const q = new Set(query.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const t = new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  if (!q.size) return 0;
  let shared = 0;
  for (const w of t) if (q.has(w)) shared++;
  return Math.min(0.99, shared / q.size);
}

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  bridgeSearchEntries: async (o: { query: string; threshold?: number }) => {
    if (searchBehaviour === 'throw') throw new Error('embedder unavailable');
    if (searchBehaviour === 'hang') await new Promise(() => {});
    if (searchBehaviour === 'empty') return { success: true, results: [] };
    return {
      success: true,
      results: [...store.entries()]
        .map(([key, v], i) => ({
          id: `entry_${i}`,
          key,
          content: v.value,
          tags: v.tags,
          score: overlapScore(o.query, v.value),
        }))
        .filter((r) => r.score >= (o.threshold ?? 0)),
    };
  },
  getProjectRoot: () => ROOT,
}));

const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-related-'));

function envelope(name: string, url: string, title: string, body: string): string {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'readable.md'), `# ${title}\n\n${body}\n`);
  fs.writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      url,
      canonicalUrl: url,
      title,
      capturedAt: '2026-09-20T09:00:00.000Z',
      source: 'extension',
    }),
  );
  return join(dir, 'readable.md');
}

const SPROCKET = 'https://docs.example.com/sprockets/calibration';

async function seedLibrary() {
  const { ingestDocument } = await import('../knowledge/document-pipeline.js');
  await ingestDocument(
    envelope(
      'sprockets',
      SPROCKET,
      'Sprocket calibration',
      'Torque the sprocket bearing to nine newton metres before calibration.',
    ),
    'shared',
    ROOT,
  );
  await ingestDocument(
    envelope(
      'bearings',
      'https://docs.example.com/bearings',
      'Bearing tolerances',
      'Bearing torque tolerance for a sprocket is plus or minus 0.2 newton metres.',
    ),
    'shared',
    ROOT,
  );
  await ingestDocument(
    envelope(
      'cakes',
      'https://baking.example.org/cakes',
      'Lemon drizzle',
      'Whisk sugar into the butter, then fold the flour through gently.',
    ),
    'shared',
    ROOT,
  );
}

beforeEach(() => {
  store.clear();
  searchBehaviour = 'overlap';
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
  fs.rmSync(join(ROOT, 'inbox'), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('RCL-03 related documents', () => {
  it('ranks the existing capture of the same URL first, for a capture not yet ingested', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    await seedLibrary();
    // Exactly the capture-time call: the envelope is on disk, nothing has
    // ingested it yet, and its identity comes from its own meta.json.
    const fresh = envelope('sprockets-again', SPROCKET, 'Sprocket calibration', 'New body text.');

    const related = await relatedDocuments(fresh, { rootDir: ROOT, scope: 'shared', limit: 3 });
    expect(related[0].url).toBe(SPROCKET);
    expect(related[0].reasons).toContain('same-url');
    expect(related[0].score).toBe(1);
    expect(related.map((r) => r.filePath)).not.toContain(fresh);
    expect(related.map((r) => r.title)).toContain('Bearing tolerances');
  });

  it('surfaces same-site and similar documents, and excludes the target itself', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    await seedLibrary();

    const related = await relatedDocuments(SPROCKET, { rootDir: ROOT, scope: 'shared', limit: 3 });
    expect(related.map((r) => r.filePath)).not.toContain(join(ROOT, 'inbox/sprockets/readable.md'));

    const bearings = related.find((r) => r.title === 'Bearing tolerances');
    expect(bearings).toBeTruthy();
    expect(bearings?.reasons).toEqual(expect.arrayContaining(['same-site', 'similar']));
    expect(bearings?.site).toBe('docs.example.com');
    expect(bearings?.excerpt).toBeTruthy();
    expect(bearings?.anchor).toMatch(/^[0-9a-f]{12}#\d+-\d+$/);
    // Unrelated site, unrelated words — below both signals.
    expect(related.map((r) => r.title)).not.toContain('Lemon drizzle');
  });

  it('answers for a URL that has never been captured, using the site signal', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    await seedLibrary();
    const related = await relatedDocuments('https://docs.example.com/gearboxes/new', {
      rootDir: ROOT,
      scope: 'shared',
      limit: 3,
    });
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((r) => r.site === 'docs.example.com')).toBe(true);
  });

  it('honours the limit and takes text the caller already has', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    await seedLibrary();
    const related = await relatedDocuments('https://elsewhere.example.net/new-page', {
      rootDir: ROOT,
      scope: 'shared',
      limit: 1,
      text: 'sprocket bearing torque newton metres calibration',
    });
    expect(related).toHaveLength(1);
    expect(related[0].reasons).toContain('similar');
  });

  it('degrades to an empty list on an empty store', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    expect(await relatedDocuments(SPROCKET, { rootDir: ROOT, scope: 'shared' })).toEqual([]);
  });

  it('keeps the cheap signals when the vector pass throws', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    await seedLibrary();
    searchBehaviour = 'throw';
    const related = await relatedDocuments(SPROCKET, { rootDir: ROOT, scope: 'shared', limit: 3 });
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((r) => r.reasons.includes('same-site'))).toBe(true);
    expect(related.every((r) => r.excerpt === undefined)).toBe(true);
  });

  it('returns within its budget when the vector pass hangs', async () => {
    const { relatedDocuments } = await import('../knowledge/related.js');
    await seedLibrary();
    searchBehaviour = 'hang';
    const started = Date.now();
    const related = await relatedDocuments(SPROCKET, {
      rootDir: ROOT,
      scope: 'shared',
      limit: 3,
      timeoutMs: 150,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(related.every((r) => !r.reasons.includes('similar'))).toBe(true);
  });
});
