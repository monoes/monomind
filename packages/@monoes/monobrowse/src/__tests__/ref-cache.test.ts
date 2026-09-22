import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function makeRefs(
  count = 2,
): Map<string, { ref: string; role: string; name: string; nodeId: number }> {
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

    await mod.saveRefCache(9222, 'target-1', 'https://example.com', refs as any);
    const loaded = await mod.loadRefCache(9222, 'target-1');

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

    await mod.saveRefCache(9222, 'target-A', 'https://a.com', refs as any);
    const loaded = await mod.loadRefCache(9222, 'target-B');

    expect(loaded).toBeNull();
  });

  it('corrupt JSON file returns null', async () => {
    const mod = await importRefCache();
    // First save a valid cache to create the directory structure
    await mod.saveRefCache(9222, 't', 'https://x.com', makeRefs(1) as any);

    // Now overwrite the file with invalid JSON
    const cacheFile = join(tempDir, '.monomind', 'monobrowse', 'ax-snapshot-9222.json');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(cacheFile, '{{{not valid json!!!');

    const loaded = await mod.loadRefCache(9222, 't');
    expect(loaded).toBeNull();
  });

  it('clearRefCache removes the cache file', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache(9222, 't1', 'https://x.com', makeRefs(1) as any);

    const cacheFile = join(tempDir, '.monomind', 'monobrowse', 'ax-snapshot-9222.json');
    // Verify file exists
    const before = await stat(cacheFile).catch(() => null);
    expect(before).not.toBeNull();

    await mod.clearRefCache(9222);

    const after = await stat(cacheFile).catch(() => null);
    expect(after).toBeNull();
  });

  it('load after clear returns null', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache(9222, 't1', 'https://x.com', makeRefs(1) as any);
    await mod.clearRefCache(9222);

    const loaded = await mod.loadRefCache(9222, 't1');
    expect(loaded).toBeNull();
  });

  it('freshly saved cache is not stale', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache(9222, 't1', 'https://x.com', makeRefs(1) as any);

    const loaded = await mod.loadRefCache(9222, 't1');
    expect(loaded).not.toBeNull();
    expect(loaded!.stale).toBe(false);
    expect(loaded!.ageMs).toBeLessThan(mod.REF_CACHE_STALE_MS);
  });

  it('cache older than REF_CACHE_STALE_MS is flagged stale', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache(9222, 't1', 'https://x.com', makeRefs(1) as any);

    // Manually backdate the savedAt timestamp
    const cacheFile = join(tempDir, '.monomind', 'monobrowse', 'ax-snapshot-9222.json');
    const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
    raw.savedAt = Date.now() - mod.REF_CACHE_STALE_MS - 5000;
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(cacheFile, JSON.stringify(raw));

    const loaded = await mod.loadRefCache(9222, 't1');
    expect(loaded).not.toBeNull();
    expect(loaded!.stale).toBe(true);
    expect(loaded!.ageMs).toBeGreaterThan(mod.REF_CACHE_STALE_MS);
  });

  it('loading with no cache file returns null (no crash)', async () => {
    const mod = await importRefCache();
    const loaded = await mod.loadRefCache(9222, 'nonexistent');
    expect(loaded).toBeNull();
  });

  it('#318: each session keeps its own ref cache', async () => {
    const mod = await importRefCache();
    await mod.saveRefCache(41111, 'target-A', 'https://a.com', makeRefs(1) as any);
    await mod.saveRefCache(42222, 'target-B', 'https://b.com', makeRefs(2) as any);

    expect((await mod.loadRefCache(41111, 'target-A'))!.url).toBe('https://a.com');
    expect((await mod.loadRefCache(42222, 'target-B'))!.refs.size).toBe(2);

    await mod.clearRefCache(41111);
    expect(await mod.loadRefCache(41111, 'target-A')).toBeNull();
    expect(await mod.loadRefCache(42222, 'target-B')).not.toBeNull();
  });
});

describe('#318 session store (one record per port)', () => {
  it('round-trip: save then load returns the session; launched defaults true', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(9333);
    expect(await mod.loadSessionRecord(9333)).toEqual({
      port: 9333,
      launched: true,
      savedAt: expect.any(Number),
    });
  });

  it('two concurrent sessions coexist — neither overwrites the other', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(41111, { pid: 11 });
    await mod.saveSessionRecord(42222, { pid: 22 });

    expect((await mod.listSessionRecords()).map((r) => r.port).sort()).toEqual([41111, 42222]);
    expect((await mod.loadSessionRecord(41111))!.pid).toBe(11);
    expect((await mod.loadSessionRecord(42222))!.pid).toBe(22);
  });

  it('lists newest first — the discovery order for a command with no --port', async () => {
    const mod = await importRefCache();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 5_000);
    await mod.saveSessionRecord(41111);
    clock.mockReturnValue(now);
    await mod.saveSessionRecord(42222);
    clock.mockRestore();

    expect((await mod.listSessionRecords()).map((r) => r.port)).toEqual([42222, 41111]);
  });

  it('removing one session leaves the others alone', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(41111);
    await mod.saveSessionRecord(42222);

    await mod.removeSessionRecord(41111);

    expect(await mod.loadSessionRecord(41111)).toBeNull();
    expect((await mod.listSessionRecords()).map((r) => r.port)).toEqual([42222]);
  });

  it('removing a session that was never recorded resolves without throwing', async () => {
    const mod = await importRefCache();
    await expect(mod.removeSessionRecord(41111)).resolves.toBeUndefined();
  });

  it('listing with no sessions directory returns an empty list (no crash)', async () => {
    const mod = await importRefCache();
    expect(await mod.listSessionRecords()).toEqual([]);
  });

  it('connect provenance: launched:false survives the round-trip', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(9229, { launched: false });
    expect(await mod.loadSessionRecord(9229)).toEqual({
      port: 9229,
      launched: false,
      savedAt: expect.any(Number),
    });
  });

  it('#115: pid and userDataDir persist so a later process can kill an orphaned launch', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(9333, { pid: 54321, userDataDir: '/tmp/monomind-browse-9333' });
    expect(await mod.loadSessionRecord(9333)).toEqual({
      port: 9333,
      launched: true,
      pid: 54321,
      userDataDir: '/tmp/monomind-browse-9333',
      savedAt: expect.any(Number),
    });
  });

  it('#115: an attached (launched:false) session with no pid argument persists none', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(9229, { launched: false });
    const info = await mod.loadSessionRecord(9229);
    expect(info!.launched).toBe(false);
    expect(info!.pid).toBeUndefined();
  });

  it('#124-review: saveSessionRecord does NOT strip pid when launched:false — callers must not pass one for an attach', async () => {
    // The property above (attach sessions have no pid) is caller discipline,
    // not something this function enforces — the one production caller
    // (`connect`) simply never passes a pid alongside launched:false. This
    // test documents that explicitly so it can't be mistaken for an
    // invariant the code itself guarantees.
    const mod = await importRefCache();
    await mod.saveSessionRecord(9229, { launched: false, pid: 4242 });
    const info = await mod.loadSessionRecord(9229);
    expect(info!.launched).toBe(false);
    expect(info!.pid).toBe(4242);
  });

  it('#115: a non-numeric or non-positive persisted pid is dropped, not trusted', async () => {
    const mod = await importRefCache();
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = join(process.cwd(), '.monomind', 'monobrowse', 'sessions');
    await mkdir(dir, { recursive: true });
    for (const badPid of ['54321', -1, 0, 1.5, null]) {
      await writeFile(
        join(dir, '9333.json'),
        JSON.stringify({ port: 9333, launched: true, pid: badPid }),
      );
      const info = await mod.loadSessionRecord(9333);
      expect(info!.pid).toBeUndefined();
    }
  });

  it('rejects out-of-range or non-integer persisted ports, and skips them when listing', async () => {
    const mod = await importRefCache();
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = join(process.cwd(), '.monomind', 'monobrowse', 'sessions');
    await mkdir(dir, { recursive: true });
    for (const bad of [80, 70000, 1.5, '9222', null]) {
      await writeFile(join(dir, '9333.json'), JSON.stringify({ port: bad }));
      expect(await mod.loadSessionRecord(9333)).toBeNull();
      expect(await mod.listSessionRecords()).toEqual([]);
    }
  });

  it('a corrupt record is skipped, not fatal for the rest of the listing', async () => {
    const mod = await importRefCache();
    await mod.saveSessionRecord(42222);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(process.cwd(), '.monomind', 'monobrowse', 'sessions', '41111.json'),
      '{{{not valid json!!!',
    );

    expect((await mod.listSessionRecords()).map((r) => r.port)).toEqual([42222]);
  });
});
