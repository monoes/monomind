import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to mock process.cwd() before importing ref-cache so CACHE_DIR
// resolves to our temp directory.
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'monobrowse-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

// Dynamic import so each test picks up the mocked cwd.
// We must bust the module cache between tests.
async function importRefCache() {
  // Vitest module cache means re-import returns the same module.
  // Since CACHE_DIR is set at module-load time, we need resetModules.
  vi.resetModules();
  return import('../browser/ref-cache.js');
}

function makeRefs(count = 2): Map<string, { ref: string; role: string; name: string; nodeId: number }> {
  const map = new Map();
  for (let i = 1; i <= count; i++) {
    map.set(`ref${i}`, { ref: `ref${i}`, role: 'button', name: `Button ${i}`, nodeId: i });
  }
  return map;
}

describe('ref-cache', () => {
  it('round-trip: save then load returns equivalent data', async () => {
    const mod = await importRefCache();
    const refs = makeRefs(2);

    await mod.saveRefCache('target-1', 'https://example.com', refs as any);
    const loaded = await mod.loadRefCache('target-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.url).toBe('https://example.com');
    expect(loaded!.refs.size).toBe(2);
    expect(loaded!.refs.get('ref1')!.role).toBe('button');
    expect(loaded!.refs.get('ref2')!.name).toBe('Button 2');
    expect(typeof loaded!.savedAt).toBe('number');
    expect(typeof loaded!.ageMs).toBe('number');
  });

  it('targetId mismatch returns null', async () => {
    const mod = await importRefCache();
    const refs = makeRefs(1);

    await mod.saveRefCache('target-A', 'https://a.com', refs as any);
    const loaded = await mod.loadRefCache('target-B');

    expect(loaded).toBeNull();
  });

  it('corrupt JSON file returns null', async () => {
    const mod = await importRefCache();
    // First save a valid cache to create the directory structure
    await mod.saveRefCache('t', 'https://x.com', makeRefs(1) as any);

    // Now overwrite the file with invalid JSON
    const cacheFile = join(tempDir, '.monomind', 'monobrowse', 'ax-snapshot.json');
    const { writeFile: wf } = await import('fs/promises');
    await wf(cacheFile, '{{{not valid json!!!');

    const loaded = await mod.loadRefCache('t');
    expect(loaded).toBeNull();
  });

  it('clearRefCache removes the cache file', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache('t1', 'https://x.com', makeRefs(1) as any);

    const cacheFile = join(tempDir, '.monomind', 'monobrowse', 'ax-snapshot.json');
    // Verify file exists
    const before = await stat(cacheFile).catch(() => null);
    expect(before).not.toBeNull();

    await mod.clearRefCache();

    const after = await stat(cacheFile).catch(() => null);
    expect(after).toBeNull();
  });

  it('load after clear returns null', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache('t1', 'https://x.com', makeRefs(1) as any);
    await mod.clearRefCache();

    const loaded = await mod.loadRefCache('t1');
    expect(loaded).toBeNull();
  });

  it('freshly saved cache is not stale', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache('t1', 'https://x.com', makeRefs(1) as any);

    const loaded = await mod.loadRefCache('t1');
    expect(loaded).not.toBeNull();
    expect(loaded!.stale).toBe(false);
    expect(loaded!.ageMs).toBeLessThan(mod.REF_CACHE_STALE_MS);
  });

  it('cache older than REF_CACHE_STALE_MS is flagged stale', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache('t1', 'https://x.com', makeRefs(1) as any);

    // Manually backdate the savedAt timestamp
    const cacheFile = join(tempDir, '.monomind', 'monobrowse', 'ax-snapshot.json');
    const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
    raw.savedAt = Date.now() - mod.REF_CACHE_STALE_MS - 5000;
    const { writeFile: wf } = await import('fs/promises');
    await wf(cacheFile, JSON.stringify(raw));

    const loaded = await mod.loadRefCache('t1');
    expect(loaded).not.toBeNull();
    expect(loaded!.stale).toBe(true);
    expect(loaded!.ageMs).toBeGreaterThan(mod.REF_CACHE_STALE_MS);
  });

  it('loading with no cache file returns null (no crash)', async () => {
    const mod = await importRefCache();
    const loaded = await mod.loadRefCache('nonexistent');
    expect(loaded).toBeNull();
  });
});

describe('active-port persistence', () => {
  it('round-trip: save then load returns the port; launched defaults true', async () => {
    const mod = await importRefCache();
    await mod.saveActivePort(9333);
    expect(await mod.loadActivePort()).toBe(9333);
    expect(await mod.loadActivePortInfo()).toEqual({ port: 9333, launched: true });
  });

  it('connect provenance: launched:false survives the round-trip', async () => {
    const mod = await importRefCache();
    await mod.saveActivePort(9229, { launched: false });
    expect(await mod.loadActivePortInfo()).toEqual({ port: 9229, launched: false });
  });

  it('clear removes the file; load returns null afterwards', async () => {
    const mod = await importRefCache();
    await mod.saveActivePort(9333);
    await mod.clearActivePort();
    expect(await mod.loadActivePort()).toBeNull();
    expect(await mod.loadActivePortInfo()).toBeNull();
  });

  it('clear with no file resolves without throwing', async () => {
    const mod = await importRefCache();
    await mod.clearActivePort();
    await expect(mod.clearActivePort()).resolves.toBeUndefined();
  });

  it('rejects out-of-range or non-integer persisted ports', async () => {
    const mod = await importRefCache();
    const { writeFile, mkdir } = await import('fs/promises');
    const dir = join(process.cwd(), '.monomind', 'monobrowse');
    await mkdir(dir, { recursive: true });
    for (const bad of [80, 70000, 1.5, '9222', null]) {
      await writeFile(join(dir, 'active-port.json'), JSON.stringify({ port: bad }));
      expect(await mod.loadActivePort()).toBeNull();
      expect(await mod.loadActivePortInfo()).toBeNull();
    }
  });
});
