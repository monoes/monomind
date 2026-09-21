/**
 * RCL-08 — watch a captured page for change.
 *
 * `check` is a function a scheduler calls; it fetches nothing and starts
 * nothing. It compares the content hash the pipeline already stored against
 * the baseline the last check wrote down, and when they differ it says WHICH
 * SECTIONS moved — a raw character diff of a re-captured page is noise.
 *
 * Pinned here: the baseline is seeded at add-time (so adding a watch does not
 * immediately announce the capture that created it), intervals are honoured
 * unless forced, a change reports a section summary built from the previous
 * version's own archived file, and every degraded path (no such page, missing
 * archive, corrupt watch file) reports rather than throws.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let ROOT = '';
const store = new Map<string, { value: string; tags: string[] }>();

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: { key: string; value: string; tags?: string[] }) => {
    store.set(o.key, { value: o.value, tags: o.tags ?? [] });
    return { success: true, id: `entry_${store.size}` };
  },
  bridgeSearchEntries: async () => ({ success: true, results: [] }),
  getProjectRoot: () => ROOT,
}));

const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-watch-'));

const CANONICAL = 'https://example.com/pricing';

function envelope(name: string, markdown: string): string {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'readable.md'), markdown);
  fs.writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      url: CANONICAL,
      canonicalUrl: CANONICAL,
      title: 'Pricing',
      capturedAt: '2026-09-21T10:00:00.000Z',
      source: 'extension',
    }),
  );
  return join(dir, 'readable.md');
}

const V1 = [
  '# Pricing',
  '',
  'Plans for every team.',
  '',
  '## Starter',
  '',
  'Nine dollars a month, billed annually.',
  '',
  '## Enterprise',
  '',
  'Talk to sales.',
  '',
].join('\n');

const V2 = [
  '# Pricing',
  '',
  'Plans for every team.',
  '',
  '## Starter',
  '',
  'Twelve dollars a month, billed annually. Seats are now unlimited.',
  '',
  '## Teams',
  '',
  'Thirty dollars a month.',
  '',
].join('\n');

beforeEach(() => {
  store.clear();
  fs.rmSync(join(ROOT, '.monomind'), { recursive: true, force: true });
  fs.rmSync(join(ROOT, 'inbox'), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('RCL-08 section diff', () => {
  it('names the sections that moved instead of diffing characters', async () => {
    const { diffSections, splitSections } = await import('../knowledge/section-diff.js');
    expect(splitSections(V1).map((s) => s.key)).toEqual([
      'Pricing',
      'Pricing > Starter',
      'Pricing > Enterprise',
    ]);

    const diff = diffSections(V1, V2);
    expect(diff.added).toEqual(['Pricing > Teams']);
    expect(diff.removed).toEqual(['Pricing > Enterprise']);
    expect(diff.changed.map((c) => c.key)).toEqual(['Pricing > Starter']);
    expect(diff.changed[0].addedWords).toBeGreaterThan(0);
    expect(diff.changed[0].sample).toContain('Twelve dollars');
    expect(diff.unchanged).toBe(1); // the intro paragraph under "Pricing"
    expect(diff.summary).toContain('Pricing > Starter');
  });

  it('does not call re-ordered words a rewrite, and says so when only formatting moved', async () => {
    const { diffSections } = await import('../knowledge/section-diff.js');
    const wrapped = '# A\n\nthe quick brown\nfox jumps\n';
    const rewrapped = '# A\n\nthe quick brown fox jumps\n';
    expect(diffSections(wrapped, rewrapped).changed).toEqual([]);
    const reordered = diffSections('# A\n\nalpha beta gamma\n', '# A\n\ngamma beta alpha\n');
    expect(reordered.changed[0]).toMatchObject({ addedWords: 0, removedWords: 0 });
  });
});

describe('RCL-08 watch list', () => {
  it('parses intervals and refuses a typo', async () => {
    const { parseInterval, DEFAULT_INTERVAL_SECONDS } = await import('../knowledge/watch.js');
    expect(parseInterval('30m')).toBe(1800);
    expect(parseInterval('6h')).toBe(21_600);
    expect(parseInterval('2d')).toBe(172_800);
    expect(parseInterval('900')).toBe(900);
    expect(parseInterval(undefined)).toBe(DEFAULT_INTERVAL_SECONDS);
    expect(() => parseInterval('every tuesday')).toThrow(/unparseable/);
    expect(() => parseInterval('0h')).toThrow(/positive/);
  });

  it('adds, lists and removes, seeding the baseline from what is indexed', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { addWatch, listWatches, removeWatch } = await import('../knowledge/watch.js');
    const ingest = await ingestDocument(envelope('v1', V1), 'shared', ROOT);

    const entry = await addWatch(ROOT, CANONICAL, { interval: '6h' });
    expect(entry.url).toBe(CANONICAL);
    expect(entry.intervalSeconds).toBe(21_600);
    expect(entry.lastHash).toBeTruthy();
    expect(entry.label).toBe('Pricing');
    expect(listWatches(ROOT)).toHaveLength(1);

    // Re-adding updates the interval and does not duplicate the row.
    const again = await addWatch(ROOT, CANONICAL, { interval: '2d' });
    expect(again.intervalSeconds).toBe(172_800);
    expect(listWatches(ROOT)).toHaveLength(1);
    expect(ingest.chunksIndexed).toBeGreaterThan(0);

    expect(removeWatch(ROOT, CANONICAL)).toBe(true);
    expect(removeWatch(ROOT, CANONICAL)).toBe(false);
    expect(listWatches(ROOT)).toEqual([]);
  });

  it('treats a corrupt watch file as an empty list', async () => {
    const { listWatches } = await import('../knowledge/watch.js');
    fs.mkdirSync(join(ROOT, '.monomind', 'knowledge'), { recursive: true });
    fs.writeFileSync(join(ROOT, '.monomind', 'knowledge', 'watches.json'), '{ truncated');
    expect(listWatches(ROOT)).toEqual([]);
  });
});

describe('RCL-08 check', () => {
  it('reports a re-captured page as changed, with what changed in it', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { addWatch, checkWatches, listWatches } = await import('../knowledge/watch.js');
    await ingestDocument(envelope('v1', V1), 'shared', ROOT);
    await addWatch(ROOT, CANONICAL, { interval: '1h' });

    // Nothing has happened yet: not due, and nothing to say.
    const quiet = await checkWatches(ROOT);
    expect(quiet.results[0].status).toBe('not-due');
    expect(quiet.changed).toBe(0);

    const second = await ingestDocument(envelope('v2', V2), 'shared', ROOT);
    expect(second.version).toBe(2);

    const report = await checkWatches(ROOT, { force: true });
    expect(report.changed).toBe(1);
    const hit = report.results[0];
    expect(hit.status).toBe('changed');
    expect(hit.version).toBe(2);
    expect(hit.previousHash).not.toBe(hit.currentHash);
    expect(hit.diff?.added).toEqual(['Pricing > Teams']);
    expect(hit.diff?.changed.map((c) => c.key)).toEqual(['Pricing > Starter']);
    expect(hit.title).toBe('Pricing');

    // The baseline moved, so the same change is not reported twice.
    const after = await checkWatches(ROOT, { force: true });
    expect(after.changed).toBe(0);
    expect(after.results[0].status).toBe('unchanged');
    expect(listWatches(ROOT)[0].lastChangedAt).toBeTruthy();
  });

  it('honours the interval unless forced, and leaves the baseline alone on a dry run', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { addWatch, checkWatches, listWatches } = await import('../knowledge/watch.js');
    await ingestDocument(envelope('v1', V1), 'shared', ROOT);
    await addWatch(ROOT, CANONICAL, { interval: '1h' });
    await ingestDocument(envelope('v2', V2), 'shared', ROOT);

    const tomorrow = new Date(Date.now() + 26 * 3_600_000);
    const dry = await checkWatches(ROOT, { now: tomorrow, dryRun: true });
    expect(dry.results[0].status).toBe('changed');
    expect(dry.skipped).toBe(0);
    const stored = listWatches(ROOT)[0];
    expect(stored.lastChangedAt).toBeUndefined();

    // Still changed, because the dry run wrote nothing down.
    const wet = await checkWatches(ROOT, { now: tomorrow });
    expect(wet.results[0].status).toBe('changed');
  });

  it('reports an unindexed page instead of throwing, and keeps looking at it', async () => {
    const { addWatch, checkWatches, listWatches } = await import('../knowledge/watch.js');
    await addWatch(ROOT, 'https://example.com/never-captured', { interval: '1h' });
    const report = await checkWatches(ROOT);
    expect(report.results[0].status).toBe('missing');
    expect(report.results[0].note).toMatch(/nothing indexed/);
    // Not stamped as checked — the next run looks again.
    expect(listWatches(ROOT)[0].lastCheckedAt).toBeUndefined();
  });

  it('still reports a change when the previous version has been deleted', async () => {
    const { ingestDocument } = await import('../knowledge/document-pipeline.js');
    const { addWatch, checkWatches } = await import('../knowledge/watch.js');
    const first = envelope('v1', V1);
    await ingestDocument(first, 'shared', ROOT);
    await addWatch(ROOT, CANONICAL, { interval: '1h' });
    await ingestDocument(envelope('v2', V2), 'shared', ROOT);
    fs.rmSync(join(ROOT, 'inbox', 'v1'), { recursive: true, force: true });

    const report = await checkWatches(ROOT, { force: true });
    expect(report.results[0].status).toBe('changed');
    expect(report.results[0].diff).toBeUndefined();
    expect(report.results[0].note).toMatch(/hash only/);
  });
});
