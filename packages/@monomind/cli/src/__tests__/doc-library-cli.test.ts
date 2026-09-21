/**
 * The CLI surface for the capture library: `doc list` filters (RCL-09),
 * `doc cite` (RCL-10) and `doc watch` (RCL-08).
 *
 * The behaviour of each is pinned in its own module test; what is pinned HERE
 * is the wiring — the subcommands are registered, their flags reach the
 * functions, `--json` emits the shape a GUI or a scheduler reads, and a
 * command that cannot do what was asked exits non-zero instead of printing
 * something reassuring.
 *
 * The store is seeded by writing the metadata log directly: these commands
 * read what ingest wrote, and going through a real ingest here would buy
 * nothing but an embedder.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docCommand } from '../commands/doc.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;
const ORIGINAL_MM_CWD = process.env.MONOMIND_CWD;
let ROOT = '';

const SCRATCH = process.env.MONOMIND_TEST_SCRATCH || join(os.homedir(), 'scratch');

const PRICING_URL = 'https://www.example.com/pricing';
const VITALS_URL = 'https://web.dev/vitals';
const SPROCKET_URL = 'https://docs.example.com/sprockets';

const PRICING_MD = ['# Pricing', '', '## Starter', '', 'Nine dollars a month.', ''].join('\n');

function capture(
  name: string,
  url: string,
  title: string,
  markdown: string,
  extra: Record<string, unknown> = {},
): { filePath: string; contentHash: string; url: string } {
  const dir = join(ROOT, 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'readable.md');
  fs.writeFileSync(filePath, markdown);
  fs.writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ url, canonicalUrl: url, title, source: 'extension', ...extra }),
  );
  return {
    filePath,
    url,
    contentHash: crypto.createHash('sha256').update(markdown).digest('hex'),
  };
}

/** Append the record `ingestDocument` would have written. */
function index(
  entry: { filePath: string; contentHash: string; url: string },
  provenance: Record<string, unknown>,
  version = 1,
): void {
  const dir = join(ROOT, '.monomind', 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    join(dir, 'doc-metadata.jsonl'),
    `${JSON.stringify({
      filePath: entry.filePath,
      contentHash: entry.contentHash,
      chunkCount: 1,
      indexedAt: '2026-09-21T11:00:00.000Z',
      scope: 'shared',
      size: fs.statSync(entry.filePath).size,
      canonicalUrl: entry.url,
      version,
      provenance,
    })}\n`,
  );
}

beforeAll(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  ROOT = fs.mkdtempSync(join(SCRATCH, 'mm-doc-cli-'));
  fs.mkdirSync(join(ROOT, '.monomind'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  delete process.env.MONOMIND_CWD;
  process.chdir(ROOT);

  index(capture('pricing', PRICING_URL, 'Pricing', PRICING_MD), {
    url: PRICING_URL,
    canonicalUrl: PRICING_URL,
    title: 'Pricing',
    capturedAt: '2026-09-20T09:00:00.000Z',
    source: 'extension',
    tags: ['pricing', 'competitor'],
    collection: 'research',
  });
  const article = capture(
    'sprockets',
    SPROCKET_URL,
    'Sprocket Calibration',
    '# Sprocket Calibration\n\nTorque the sprocket to 9 Nm.\n',
    { note: 'torque figures worth keeping' },
  );
  fs.writeFileSync(
    join(ROOT, 'inbox', 'sprockets', 'highlights.json'),
    JSON.stringify({
      version: 1,
      highlights: [
        { id: 'h1', text: 'Torque the sprocket to 9 Nm', anchor: { quote: 'Torque the sprocket' } },
      ],
    }),
  );
  index(article, {
    url: SPROCKET_URL,
    canonicalUrl: SPROCKET_URL,
    title: 'Sprocket Calibration',
    capturedAt: '2026-09-19T09:00:00.000Z',
    source: 'extension',
    note: 'torque figures worth keeping',
    tags: ['mechanics'],
  });

  index(
    capture('vitals', VITALS_URL, 'Web Vitals', '# Web Vitals\n\nLCP, INP, CLS.\n', {
      source: 'monobrowse',
    }),
    {
      url: VITALS_URL,
      canonicalUrl: VITALS_URL,
      title: 'Web Vitals',
      capturedAt: '2026-09-21T08:00:00.000Z',
      source: 'monobrowse',
      tags: ['performance'],
    },
  );
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  if (ORIGINAL_MM_CWD !== undefined) process.env.MONOMIND_CWD = ORIGINAL_MM_CWD;
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const sub = (...names: string[]): Command => {
  let cmd: Command = docCommand;
  for (const name of names) {
    const next = cmd.subcommands?.find((c) => c.name === name || c.aliases?.includes(name));
    if (!next) throw new Error(`doc ${names.join(' ')} is not registered`);
    cmd = next;
  }
  return cmd;
};

const run = async (
  names: string[],
  args: string[] = [],
  flags: Record<string, unknown> = {},
): Promise<CommandResult> => {
  const result = await sub(...names).action?.({
    args,
    flags: { _: args, ...flags } as CommandContext['flags'],
    cwd: ROOT,
    interactive: false,
  });
  if (!result) throw new Error(`doc ${names.join(' ')} returned no CommandResult`);
  return result;
};

describe('doc list — library filters (RCL-09)', () => {
  it('registers the new subcommands', () => {
    expect(sub('list').aliases).toContain('library');
    expect(sub('cite').name).toBe('cite');
    expect(sub('related').name).toBe('related');
    expect(sub('lookup').name).toBe('lookup');
    expect(sub('watch', 'check').name).toBe('check');
    expect(sub('watch', 'add').name).toBe('add');
    expect(sub('watch', 'rm').name).toBe('remove');
  });

  it('filters by substring over title, url, path and note', async () => {
    const byTitle = await run(['list'], [], { text: 'sprocket' });
    expect((byTitle.data as Array<{ title: string }>).map((r) => r.title)).toEqual([
      'Sprocket Calibration',
    ]);
    // The note is part of the haystack — that is what makes it worth saving.
    const byNote = await run(['list'], [], { text: 'worth keeping' });
    expect(byNote.data).toHaveLength(1);
    expect(await run(['list'], [], { text: 'nothing matches this' }).then((r) => r.data)).toEqual(
      [],
    );
  });

  it('gives `doc search` the same facets and a --json mode', () => {
    const names = (sub('search').options ?? []).map((o) => o.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'site',
        'tag',
        'collection',
        'source',
        'since',
        'until',
        'text',
        'json',
      ]),
    );
  });

  it('sorts by capture time and filters by site, tag and source', async () => {
    const all = await run(['list']);
    expect((all.data as Array<{ title: string }>).map((r) => r.title)).toEqual([
      'Web Vitals',
      'Pricing',
      'Sprocket Calibration',
    ]);

    // A bare domain covers its subdomains: docs.example.com is example.com.
    const bySite = await run(['list'], [], { site: 'example.com' });
    expect((bySite.data as Array<{ title: string }>).map((r) => r.title)).toEqual([
      'Pricing',
      'Sprocket Calibration',
    ]);
    const bySubdomain = await run(['list'], [], { site: 'docs.example.com' });
    expect((bySubdomain.data as Array<{ title: string }>).map((r) => r.title)).toEqual([
      'Sprocket Calibration',
    ]);

    // Comma form and repeated form mean the same thing.
    const byTag = await run(['list'], [], { tag: 'performance,pricing' });
    expect(byTag.data).toHaveLength(2);
    const bySource = await run(['list'], [], { source: ['monobrowse'] });
    expect((bySource.data as Array<{ title: string }>).map((r) => r.title)).toEqual(['Web Vitals']);

    const none = await run(['list'], [], { site: 'nowhere.test' });
    expect(none.data).toEqual([]);
    expect(none.success).toBe(true);
  });

  it('filters by capture date and emits JSON rows a GUI can render', async () => {
    const since = await run(['list'], [], { since: '2026-09-21', json: true });
    const rows = since.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Web Vitals',
      url: VITALS_URL,
      site: 'web.dev',
      source: 'monobrowse',
      captured: true,
    });
    const until = await run(['list'], [], { until: '2026-09-20T23:59:00.000Z' });
    expect((until.data as Array<{ title: string }>).map((r) => r.title)).toEqual([
      'Pricing',
      'Sprocket Calibration',
    ]);
  });
});

describe('doc cite (RCL-10)', () => {
  it('quotes a passage with its URL and capture time', async () => {
    const result = await run(['cite'], [PRICING_URL], { chunk: 0, json: true });
    const cite = result.data as Record<string, unknown>;
    expect(cite.url).toBe(PRICING_URL);
    expect(cite.capturedAt).toBe('2026-09-20T09:00:00.000Z');
    expect(String(cite.passage)).toContain('Nine dollars a month');
    expect(String(cite.citeUrl)).toContain('#:~:text=');
    expect(String(cite.anchor)).toMatch(/^[0-9a-f]{12}#\d+-\d+$/);

    // The anchor it just produced resolves back to the same passage.
    const round = await run(['cite'], [PRICING_URL], { anchor: cite.anchor, json: true });
    expect((round.data as Record<string, unknown>).passage).toBe(cite.passage);
  });

  it('exits non-zero for a page it does not have', async () => {
    const missing = await run(['cite'], ['https://example.com/nope'], { chunk: 0 });
    expect(missing.success).toBe(false);
    expect(missing.exitCode).toBe(1);
    const noArgs = await run(['cite']);
    expect(noArgs.success).toBe(false);
  });
});

describe('doc lookup (RCL-02)', () => {
  it('answers with the note written at save time', async () => {
    const result = await run(['lookup'], [SPROCKET_URL], { json: true });
    expect(result.data).toMatchObject({
      saved: true,
      url: SPROCKET_URL,
      title: 'Sprocket Calibration',
      site: 'docs.example.com',
      capturedAt: '2026-09-19T09:00:00.000Z',
      // The whole point of the badge over a bookmark: `doc list --json` rows
      // carry no note, and this does.
      note: 'torque figures worth keeping',
      versions: 1,
      tags: ['mechanics'],
      source: 'extension',
    });
    // A fragment is a scroll position, not a different page.
    const fragment = await run(['lookup'], [`${SPROCKET_URL}#section-3`], { json: true });
    expect((fragment.data as { saved: boolean }).saved).toBe(true);
  });

  it('counts highlights only when asked, and says plainly when nothing is saved', async () => {
    const plain = await run(['lookup'], [SPROCKET_URL], { json: true });
    expect((plain.data as { highlights?: number }).highlights).toBeUndefined();
    const withHl = await run(['lookup'], [SPROCKET_URL], { json: true, highlights: true });
    expect((withHl.data as { highlights?: number }).highlights).toBe(1);

    const unsaved = await run(['lookup'], ['https://example.com/never-seen'], { json: true });
    expect(unsaved.data).toMatchObject({ saved: false, versions: 0, tags: [] });
    expect(unsaved.success).toBe(true);

    const noArgs = await run(['lookup']);
    expect(noArgs.success).toBe(false);
    expect(noArgs.exitCode).toBe(1);
  });
});

describe('doc watch (RCL-08)', () => {
  it('adds, lists, checks and removes a watch', async () => {
    const added = await run(['watch', 'add'], [PRICING_URL], { interval: '6h', json: true });
    expect((added.data as Record<string, unknown>).intervalSeconds).toBe(21_600);

    const listed = await run(['watch', 'list'], [], { json: true });
    expect(listed.data).toHaveLength(1);

    // Nothing has been re-captured, so a forced check says so.
    const quiet = await run(['watch', 'check'], [], { force: true, json: true });
    expect((quiet.data as { changed: number }).changed).toBe(0);

    // A new version of the page: same URL, new text, new record.
    const v2 = capture(
      'pricing-v2',
      PRICING_URL,
      'Pricing',
      '# Pricing\n\n## Starter\n\nTwelve dollars a month.\n',
    );
    index(v2, { url: PRICING_URL, canonicalUrl: PRICING_URL, title: 'Pricing' }, 2);

    const changed = await run(['watch', 'check'], [], { force: true, json: true });
    const report = changed.data as {
      changed: number;
      results: Array<{ status: string; diff?: { changed: Array<{ key: string }> } }>;
    };
    expect(report.changed).toBe(1);
    expect(report.results[0].status).toBe('changed');
    expect(report.results[0].diff?.changed.map((c) => c.key)).toEqual(['Pricing > Starter']);

    expect((await run(['watch', 'remove'], [PRICING_URL])).success).toBe(true);
    expect((await run(['watch', 'remove'], [PRICING_URL])).success).toBe(false);
  });

  it('refuses an unparseable interval instead of quietly defaulting', async () => {
    const bad = await run(['watch', 'add'], [VITALS_URL], { interval: 'every tuesday' });
    expect(bad.success).toBe(false);
    expect(bad.exitCode).toBe(1);
  });
});
