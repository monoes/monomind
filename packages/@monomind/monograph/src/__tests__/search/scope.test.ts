import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';
import {
  CODE_SCOPE_LABELS,
  DOC_SCOPE_LABELS,
  hasDocIntent,
  searchGraph,
} from '../../search/hybrid-query.js';

describe('searchGraph scope', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'search-scope-'));
    writeFileSync(join(tmpDir, 'router.ts'), 'export function improveRouting() { return 1; }\n');
    const sections = Array.from(
      { length: 6 },
      (_, i) => `## Improve Layout ${i}\n\nImprove the layout section ${i}.\n`,
    ).join('\n');
    writeFileSync(join(tmpDir, 'layout.md'), `# Layout\n\n${sections}`);
    await buildAsync(tmpDir);
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto lists code before documentation for a generic query', () => {
    const hits = searchGraph(db, 'improve', { limit: 5 });
    expect(hits[0]?.name).toBe('improveRouting');
    expect(CODE_SCOPE_LABELS).toContain(hits[0]?.label);
  });

  it('auto still fills with documentation when code runs out', () => {
    const hits = searchGraph(db, 'improve', { limit: 5 });
    expect(hits.some((h) => DOC_SCOPE_LABELS.includes(h.label))).toBe(true);
  });

  it('code scope never returns documentation', () => {
    const hits = searchGraph(db, 'improve', { limit: 10, scope: 'code' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => CODE_SCOPE_LABELS.includes(h.label))).toBe(true);
  });

  it('docs scope never returns code', () => {
    const hits = searchGraph(db, 'improve', { limit: 10, scope: 'docs' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => DOC_SCOPE_LABELS.includes(h.label))).toBe(true);
  });

  it('a documentation-flavoured query lists documentation first', () => {
    expect(hasDocIntent('improve docs')).toBe(true);
    expect(hasDocIntent('improve routing')).toBe(false);
    const hits = searchGraph(db, 'improve layout guide', { limit: 3 });
    expect(DOC_SCOPE_LABELS).toContain(hits[0]?.label);
  });

  it('an explicit label overrides scope', () => {
    const hits = searchGraph(db, 'improve', { limit: 10, label: 'Section', scope: 'code' });
    expect(hits.every((h) => h.label === 'Section')).toBe(true);
  });
});
