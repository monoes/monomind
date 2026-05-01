import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { generateGraphReport } from '../../src/reporting/graph-report.js';
import type { MonographDb } from '../../src/storage/db.js';

const testDir = join(tmpdir(), `monograph-report-${Date.now()}`);
const dbPath = join(testDir, 'graph.db');
const outputPath = join(testDir, 'GRAPH_REPORT.md');
let db: MonographDb;

beforeAll(() => {
  mkdirSync(testDir, { recursive: true });
  db = openDb(dbPath);

  // Insert test nodes
  insertNode(db, {
    id: 'n1',
    label: 'Function',
    name: 'processData',
    normLabel: 'processdata',
    filePath: 'src/data.ts',
    isExported: true,
    communityId: 1,
  });
  insertNode(db, {
    id: 'n2',
    label: 'Class',
    name: 'DataService',
    normLabel: 'dataservice',
    filePath: 'src/service.ts',
    isExported: true,
    communityId: 1,
  });
  insertNode(db, {
    id: 'n3',
    label: 'Function',
    name: 'fetchItems',
    normLabel: 'fetchitems',
    filePath: 'src/api.ts',
    isExported: false,
    communityId: 2,
  });
  insertNode(db, {
    id: 'n4',
    label: 'Interface',
    name: 'DataItem',
    normLabel: 'dataitem',
    filePath: 'src/types.ts',
    isExported: true,
  });

  // Insert test edges
  insertEdge(db, {
    id: 'e1',
    sourceId: 'n2',
    targetId: 'n1',
    relation: 'CALLS',
    confidence: 'EXTRACTED',
    confidenceScore: 1.0,
  });
  insertEdge(db, {
    id: 'e2',
    sourceId: 'n3',
    targetId: 'n2',
    relation: 'IMPORTS',
    confidence: 'EXTRACTED',
    confidenceScore: 1.0,
  });
  insertEdge(db, {
    id: 'e3',
    sourceId: 'n1',
    targetId: 'n4',
    relation: 'REFERENCES',
    confidence: 'INFERRED',
    confidenceScore: 0.5,
  });

  closeDb(db);
});

afterAll(() => {
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm', outputPath]) {
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
});

describe('generateGraphReport', () => {
  it('returns GraphReportResult with correct shape', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);

    expect(result).toMatchObject({
      markdown: expect.any(String),
      path: outputPath,
      stats: {
        nodeCount: expect.any(Number),
        edgeCount: expect.any(Number),
        communityCount: expect.any(Number),
      },
    });
  });

  it('markdown contains # Graph Report header', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.markdown).toContain('# Graph Report');
  });

  it('markdown contains node count in summary', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.stats.nodeCount).toBe(4);
    expect(result.markdown).toContain('4');
  });

  it('markdown contains edge count in summary', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.stats.edgeCount).toBe(3);
    expect(result.markdown).toContain('3');
  });

  it('writes file to the specified output path', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(existsSync(result.path)).toBe(true);
    const contents = readFileSync(result.path, 'utf8');
    expect(contents).toBe(result.markdown);
  });

  it('markdown contains Nodes by Type section', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.markdown).toContain('## Nodes by Type');
    expect(result.markdown).toContain('Function');
    expect(result.markdown).toContain('Class');
  });

  it('markdown contains Edges by Relation section', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.markdown).toContain('## Edges by Relation');
    expect(result.markdown).toContain('CALLS');
    expect(result.markdown).toContain('IMPORTS');
  });

  it('markdown contains Top Nodes by Degree section', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.markdown).toContain('## Top Nodes by Degree');
  });

  it('stats reflect actual DB content', async () => {
    const result = await generateGraphReport(testDir, outputPath, dbPath);
    expect(result.stats.nodeCount).toBe(4);
    expect(result.stats.edgeCount).toBe(3);
    // 2 communities (id 1 and 2)
    expect(result.stats.communityCount).toBe(2);
  });

  it('uses default output path when not specified', async () => {
    const result = await generateGraphReport(testDir, undefined, dbPath);
    expect(result.path).toBe(join(testDir, 'GRAPH_REPORT.md'));
    if (existsSync(result.path)) unlinkSync(result.path);
  });
});
