import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapabilityManager } from '../../src/capabilities/manager.js';
import type { CapabilityModule, DirectoryScan } from '../../src/capabilities/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeScan(overrides: Partial<DirectoryScan> = {}): DirectoryScan {
  return {
    root: '/tmp/test',
    totalFiles: 100,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: {},
    ...overrides,
  };
}

function makeCap(name: string, detectResult: number): CapabilityModule {
  return {
    name: name as any,
    detect: vi.fn().mockReturnValue(detectResult),
    activate: vi.fn().mockResolvedValue(undefined),
    index: vi.fn().mockResolvedValue({ indexed: 0, skipped: 0, errors: [] }),
  };
}

describe('CapabilityManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `monomind-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('activates modules above threshold', async () => {
    const mgr = new CapabilityManager();
    const docs = makeCap('documents', 0.5);
    const code = makeCap('code', 0.05);
    mgr.register(docs);
    mgr.register(code);

    const scan = makeScan();
    await mgr.activateFromScan(scan, '/tmp/test');
    expect(mgr.isActive('documents' as any)).toBe(true);
    expect(mgr.isActive('code' as any)).toBe(false);
  });

  it('activates graph and timeline when 2+ content caps active', async () => {
    const mgr = new CapabilityManager();
    const docs = makeCap('documents', 0.5);
    const media = makeCap('media', 0.3);
    const graph = makeCap('graph', 0);
    const timeline = makeCap('timeline', 0);
    mgr.register(docs);
    mgr.register(media);
    mgr.register(graph);
    mgr.register(timeline);

    await mgr.activateFromScan(makeScan(), '/tmp/test');
    expect(mgr.isActive('graph' as any)).toBe(true);
    expect(mgr.isActive('timeline' as any)).toBe(true);
  });

  it('does not activate cross-cutting with only 1 content cap', async () => {
    const mgr = new CapabilityManager();
    const docs = makeCap('documents', 0.5);
    const graph = makeCap('graph', 0);
    mgr.register(docs);
    mgr.register(graph);

    await mgr.activateFromScan(makeScan(), '/tmp/test');
    expect(mgr.isActive('graph' as any)).toBe(false);
  });

  it('returns only active modules from getActive', async () => {
    const mgr = new CapabilityManager();
    mgr.register(makeCap('documents', 0.8));
    mgr.register(makeCap('code', 0.01));
    mgr.register(makeCap('media', 0.4));

    await mgr.activateFromScan(makeScan(), '/tmp/test');
    const active = mgr.getActive();
    expect(active.map(a => a.name)).toEqual(['documents', 'media']);
  });

  it('saves capabilities.json on activation', async () => {
    const mgr = new CapabilityManager();
    mgr.register(makeCap('documents', 0.5));
    await mgr.activateFromScan(makeScan(), tmpDir);
    expect(mgr.getActive().length).toBe(1);

    // Verify the file was actually written
    const capFile = path.join(tmpDir, '.monomind', 'capabilities.json');
    expect(fs.existsSync(capFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(capFile, 'utf-8'));
    expect(saved.active).toContain('documents');
  });

  it('applies the type filter before the limit so one type cannot crowd out another', async () => {
    const mgr = new CapabilityManager();
    const docs: CapabilityModule = {
      ...makeCap('documents', 0.5),
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          path: `doc${i}.md`,
          score: 1,
          snippet: 'doc',
          type: 'documents' as const,
        })),
      ),
    };
    const code: CapabilityModule = {
      ...makeCap('code', 0.5),
      search: vi
        .fn()
        .mockResolvedValue([{ path: 'a.js', score: 0.5, snippet: 'Function f', type: 'code' as const }]),
    };
    mgr.register(docs);
    mgr.register(code);
    await mgr.activateFromScan(makeScan(), tmpDir, false);

    // Unfiltered: documents outrank code and fill the limit
    expect((await mgr.search('f', 3)).every((r) => r.type === 'documents')).toBe(true);
    // Filtered: code still surfaces, and documents are never queried
    const filtered = await mgr.search('f', 3, 'code');
    expect(filtered.map((r) => r.path)).toEqual(['a.js']);
    expect(docs.search).toHaveBeenCalledTimes(1);
  });
});
