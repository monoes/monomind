/**
 * Item 6a — Contextual chunk enrichment QA tests.
 *
 * Tests enrichment behavior through the public pipeline API: ingestDocument
 * stores enriched chunks, searchKnowledge returns them.  The 5 private
 * enrichment functions (extractDocTitle, extractDocSummary,
 * buildHeadingHierarchy, headingPathAt, enrichChunks) are exercised
 * indirectly — we verify observable invariants on the stored output.
 *
 * Invariants under test:
 *  1. First chunk starting with its own heading is left untouched
 *  2. Old `§ leaf-heading` prefix is replaced with richer one
 *  3. Summary is only added for non-first chunks (chunkIndex > 0)
 *  4. Summary is truncated to 120 chars with `...` suffix
 *  5. When heading path[0] === title, title is not duplicated
 *  6. Fence-aware: headings inside code fences are ignored
 *  7. Zero network calls, zero new dependencies
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.setConfig({ testTimeout: 60000 });
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GLOBAL = process.env.MONOMIND_GLOBAL_BRAIN_DIR;
let ROOT = '';

beforeAll(() => {
  ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-enrich-'));
  fs.mkdirSync(join(ROOT, '.monomind'), { recursive: true });
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(ROOT, 'global-brain');
  process.chdir(ROOT);
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GLOBAL === undefined) delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
  else process.env.MONOMIND_GLOBAL_BRAIN_DIR = ORIGINAL_GLOBAL;
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* exFAT race */ }
});

/**
 * Build a markdown document big enough to produce multiple chunks.
 * DEFAULT_CHUNK_SIZE is 3200, DEFAULT_OVERLAP is 400, so we need >3200 chars
 * to get 2+ chunks.
 */
function buildTestDoc(opts?: { title?: string; fenceHeading?: boolean; longSummary?: boolean }): string {
  const title = opts?.title ?? 'Test Document Title';
  const summaryText = opts?.longSummary
    ? 'This is a very long summary paragraph that exceeds the one hundred and twenty character truncation threshold used by the enrichment function to trim doc summaries. It keeps going and going past the limit.'
    : 'This is the document summary paragraph.';
  const fenceBlock = opts?.fenceHeading
    ? '```markdown\n## Fake Heading Inside Fence\nThis should be ignored.\n```\n\n'
    : '';

  // Section 1: big enough to be its own chunk
  const section1Body = 'Lorem ipsum dolor sit amet. '.repeat(80);
  // Section 2: also big enough
  const section2Body = 'Consectetur adipiscing elit. '.repeat(80);

  return [
    `# ${title}`,
    '',
    summaryText,
    '',
    fenceBlock,
    '## Section Alpha',
    '',
    section1Body,
    '',
    '### Subsection Beta',
    '',
    section2Body,
    '',
    '## Section Gamma',
    '',
    'Final content paragraph.',
  ].join('\n');
}

describe('chunk enrichment (item 6a)', () => {
  it('first chunk starting with its own heading is returned untouched', async () => {
    const docPath = join(ROOT, 'heading-first.md');
    fs.writeFileSync(docPath, buildTestDoc());

    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const res = await ingestDocument(docPath, 'shared', ROOT);
    expect(res.error).toBeUndefined();
    expect(res.chunksIndexed).toBeGreaterThan(0);

    // Search for something in the first section — the result should contain
    // the first chunk which starts with `# Test Document Title`
    const results = await searchKnowledge('Test Document Title', {
      scope: 'shared', limit: 20, minScore: 0.01, rootDir: ROOT,
      store: 'project', includeSuperseded: true,
    });
    // Find chunk 0
    const chunk0 = results.find(r => r.chunkIndex === 0);
    if (chunk0) {
      // Invariant 1: first chunk starting with heading is untouched — no § prefix
      expect(chunk0.text).toMatch(/^# Test Document Title/);
      expect(chunk0.text).not.toMatch(/^§/);
    }
  });

  it('non-first chunks get § title · heading path prefix', async () => {
    const docPath = join(ROOT, 'multi-section.md');
    fs.writeFileSync(docPath, buildTestDoc());

    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    await ingestDocument(docPath, 'shared', ROOT);

    const results = await searchKnowledge('Consectetur adipiscing', {
      scope: 'shared', limit: 20, minScore: 0.01, rootDir: ROOT,
      store: 'project', includeSuperseded: true,
    });

    // Find a later chunk (chunkIndex > 0)
    const laterChunk = results.find(r => r.chunkIndex > 0);
    if (laterChunk) {
      // Invariant 2 & 3: should have § prefix with doc title and heading path
      expect(laterChunk.text).toMatch(/^§ /);
      // Should contain the doc title in the prefix
      expect(laterChunk.text).toMatch(/Test Document Title/);
    }
  });

  it('summary appears only for non-first chunks', async () => {
    const docPath = join(ROOT, 'summary-check.md');
    fs.writeFileSync(docPath, buildTestDoc());

    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    await ingestDocument(docPath, 'shared', ROOT);

    const results = await searchKnowledge('Lorem ipsum dolor sit amet', {
      scope: 'shared', limit: 20, minScore: 0.01, rootDir: ROOT,
      store: 'project', includeSuperseded: true,
    });

    const chunk0 = results.find(r => r.chunkIndex === 0);
    const laterChunks = results.filter(r => r.chunkIndex > 0);

    // Invariant 3: summary NOT injected as enrichment prefix in first chunk.
    // Note: the summary text IS part of the document body (it's the first
    // paragraph), so it naturally appears in chunk 0's content. What we verify
    // is that it was NOT injected as a separate line after a § prefix.
    if (chunk0) {
      // First chunk starts with heading → returned untouched (no § prefix at all)
      expect(chunk0.text).toMatch(/^# /);
      expect(chunk0.text).not.toMatch(/^§ /);
    }

    // Invariant 3: summary IS in non-first chunks
    for (const c of laterChunks) {
      // Non-first chunks should include the summary line
      expect(c.text).toContain('document summary paragraph');
    }
  });

  it('summary is truncated to 120 chars with ... suffix when long', async () => {
    const docPath = join(ROOT, 'long-summary.md');
    fs.writeFileSync(docPath, buildTestDoc({ longSummary: true }));

    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    await ingestDocument(docPath, 'shared', ROOT);

    const results = await searchKnowledge('Consectetur adipiscing', {
      scope: 'shared', limit: 20, minScore: 0.01, rootDir: ROOT,
      store: 'project', includeSuperseded: true,
    });

    const laterChunk = results.find(r => r.chunkIndex > 0 && r.filePath.includes('long-summary'));
    expect(laterChunk).toBeDefined();
    // Invariant 4: summary should be truncated with ...
    const lines = laterChunk!.text.split('\n');
    // Second line should be the summary (first is §)
    const summaryLine = lines[1];
    expect(summaryLine).toBeDefined();
    expect(summaryLine!.startsWith('§')).toBe(false);
    expect(summaryLine!.length).toBeLessThanOrEqual(120);
    expect(summaryLine!).toMatch(/\.\.\.$/);

  });

  it('headings inside code fences are ignored', async () => {
    const docPath = join(ROOT, 'fence-heading.md');
    fs.writeFileSync(docPath, buildTestDoc({ fenceHeading: true }));

    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    await ingestDocument(docPath, 'shared', ROOT);

    const results = await searchKnowledge('Lorem ipsum dolor sit amet', {
      scope: 'shared', limit: 20, minScore: 0.01, rootDir: ROOT,
      store: 'project', includeSuperseded: true,
    });

    // Invariant 6: "Fake Heading Inside Fence" should NOT appear in any § path
    for (const r of results) {
      if (r.text.startsWith('§')) {
        expect(r.text).not.toContain('Fake Heading Inside Fence');
      }
    }
  });

  it('title deduplication: heading path[0] === title does not repeat', async () => {
    // When the doc title IS the first heading in the path, it shouldn't be
    // duplicated: `§ Title · Title > Sub` should become `§ Title > Sub`
    const docPath = join(ROOT, 'dedup-title.md');
    const doc = buildTestDoc({ title: 'Test Document Title' });
    fs.writeFileSync(docPath, doc);

    const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
    await ingestDocument(docPath, 'shared', ROOT);

    const results = await searchKnowledge('Consectetur', {
      scope: 'shared', limit: 20, minScore: 0.01, rootDir: ROOT,
      store: 'project', includeSuperseded: true,
    });

    for (const r of results) {
      if (r.text.startsWith('§')) {
        const firstLine = r.text.split('\n')[0];
        // Should NOT have "§ Test Document Title · Test Document Title > ..."
        expect(firstLine).not.toMatch(/Test Document Title.*·.*Test Document Title/);
      }
    }
  });

  it('no network imports in document-pipeline.ts', async () => {
    // Invariant 7: the module should not import any network libraries
    const src = fs.readFileSync(
      join(ORIGINAL_CWD, 'src/knowledge/document-pipeline.ts'),
      'utf8',
    );
    // No fetch, no http/https imports, no axios, no got
    expect(src).not.toMatch(/import.*['"]node:https?['"]/);
    expect(src).not.toMatch(/import.*['"]https?['"]/);
    expect(src).not.toMatch(/import.*['"]axios['"]/);
    expect(src).not.toMatch(/import.*['"]got['"]/);
    expect(src).not.toMatch(/import.*['"]node-fetch['"]/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});
