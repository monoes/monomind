import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { documentsCapability, extractText } from '../../src/capabilities/cap-documents.js';
import type { DirectoryScan, FileEntry } from '../../src/capabilities/types.js';
import path from 'path';
import fs from 'fs';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'documents');
const hasXlsx = (() => {
  try {
    createRequire(import.meta.url).resolve('xlsx');
    return true;
  } catch {
    return false;
  }
})();
const xlsxIt = hasXlsx ? it : it.skip;

function makeScan(docConfidence: number): DirectoryScan {
  return {
    root: FIXTURES,
    totalFiles: 10,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: docConfidence, files: 5, signals: ['.md', '.txt'] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: { '.md': 3, '.txt': 2 },
  };
}

describe('documentsCapability', () => {
  it('has name "documents"', () => {
    expect(documentsCapability.name).toBe('documents');
  });

  it('returns scan confidence from detect', () => {
    expect(documentsCapability.detect(makeScan(0.7))).toBe(0.7);
  });

  it('indexes markdown and text files (T0 metadata)', async () => {
    const files: FileEntry[] = [
      {
        path: 'readme.md',
        absolutePath: path.join(FIXTURES, 'readme.md'),
        extension: '.md',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
      {
        path: 'notes.txt',
        absolutePath: path.join(FIXTURES, 'notes.txt'),
        extension: '.txt',
        size: 50,
        modified: new Date(),
        created: new Date(),
      },
    ];

    const result = await documentsCapability.index(files);
    expect(result.indexed).toBe(2);
    expect(result.errors.length).toBe(0);
  });

  it('search returns results for indexed content', async () => {
    await documentsCapability.activate(FIXTURES);

    const files: FileEntry[] = [
      {
        path: 'readme.md',
        absolutePath: path.join(FIXTURES, 'readme.md'),
        extension: '.md',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];
    await documentsCapability.index(files);

    const results = await documentsCapability.search!('test document', 5);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.type).toBe('documents');
    }
  });

  // MEM-8/MEM-9 regression: xlsx ingestion was silently dead (missing dependency),
  // and pptx/epub extraction shelled out to the `unzip` CLI (unavailable on Windows).
  function makeFile(name: string, extension: string): FileEntry {
    const absolutePath = path.join(FIXTURES, name);
    return {
      path: name,
      absolutePath,
      extension,
      size: fs.statSync(absolutePath).size,
      modified: new Date(),
      created: new Date(),
    };
  }

  xlsxIt('extracts XLSX spreadsheet content when SheetJS is installed', async () => {
    const text = await extractText(makeFile('sample.xlsx', '.xlsx'));
    expect(text).toContain('Sheet1');
    expect(text).toContain('Alpha');
    expect(text).toContain('42');
    expect(text).toContain('Beta');
  });

  it('extracts PPTX slide text via pure-JS zip reading (no unzip shell-out)', async () => {
    const text = await extractText(makeFile('sample.pptx', '.pptx'));
    expect(text).toContain('Hello from slide one');
    expect(text).toContain('Second slide content here');
  });

  it('extracts EPUB chapter text via pure-JS zip reading (no unzip shell-out)', async () => {
    const text = await extractText(makeFile('sample.epub', '.epub'));
    expect(text).toContain('Chapter One');
    expect(text).toContain('epub fixture body text');
  });

  xlsxIt('indexes and finds XLSX content through the full capability pipeline', async () => {
    await documentsCapability.activate(FIXTURES);
    const files: FileEntry[] = [makeFile('sample.xlsx', '.xlsx')];
    const result = await documentsCapability.index(files);
    expect(result.indexed).toBe(1);
    expect(result.errors).toEqual([]);

    const xlsxResults = await documentsCapability.search!('Alpha', 5);
    expect(xlsxResults.some(r => r.path === 'sample.xlsx')).toBe(true);
  });

  it('indexes and finds PPTX/EPUB content through the full capability pipeline', async () => {
    await documentsCapability.activate(FIXTURES);
    const files: FileEntry[] = [makeFile('sample.pptx', '.pptx'), makeFile('sample.epub', '.epub')];
    const result = await documentsCapability.index(files);
    expect(result.indexed).toBe(2);
    expect(result.errors).toEqual([]);

    const pptxResults = await documentsCapability.search!('slide one', 5);
    expect(pptxResults.some(r => r.path === 'sample.pptx')).toBe(true);

    const epubResults = await documentsCapability.search!('Chapter One', 5);
    expect(epubResults.some(r => r.path === 'sample.epub')).toBe(true);
  });

  it('reports per-extractor health checks including XLSX and PPTX/ODT/ODP/EPUB', async () => {
    const checks = await documentsCapability.healthChecks!();
    const names = checks.map(c => c.name);
    expect(names).toContain('XLSX/XLS/ODS');
    expect(names).toContain('PPTX/ODT/ODP/EPUB');
    expect(names).toContain('Legacy DOC/PPT/Pages (macOS)');
    const xlsxCheck = checks.find(c => c.name === 'XLSX/XLS/ODS');
    expect(xlsxCheck?.status).toBe(hasXlsx ? 'pass' : 'warn');
    if (!hasXlsx) expect(xlsxCheck?.hint).toContain('pnpm add xlsx');
    expect(checks.find(c => c.name === 'PPTX/ODT/ODP/EPUB')?.status).toBe('pass');
  });
});
