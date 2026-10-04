/**
 * #429: statusline.cjs caches its process-spawning segments (git, sqlite3,
 * curl, npm) in .monomind/cache/statusline.json, so a render with a warm cache
 * spawns nothing, and an expired segment is recomputed.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cp = require('node:child_process');

const SL_PATH = path.resolve(__dirname, '../../.claude/helpers/statusline.cjs');
const CACHE_UTIL = path.resolve(__dirname, '../../.claude/helpers/utils/statusline-cache.cjs');

let tmpDir;
let cacheFile;
let execSpy;
let spawnSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cache-test-'));
  cacheFile = path.join(tmpDir, '.monomind', 'cache', 'statusline.json');
  // Every spawning segment has something to look at: a monograph DB, a memory
  // DB, and a dashboard port (nothing listens on it).
  fs.mkdirSync(path.join(tmpDir, '.monomind', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.monomind', 'monograph.db'), '');
  fs.writeFileSync(path.join(tmpDir, '.monomind', 'memory', 'memory.db'), '');
  fs.writeFileSync(path.join(tmpDir, '.monomind', 'control.json'), JSON.stringify({ port: 1 }));
  execSpy = vi.spyOn(cp, 'execSync');
  spawnSpy = vi.spyOn(cp, 'spawnSync');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLAUDE_PROJECT_DIR;
  delete require.cache[SL_PATH];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// statusline.cjs destructures child_process at load, so the spies must be in
// place before each (re)load.
function loadSL() {
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  delete require.cache[SL_PATH];
  return require(SL_PATH);
}

function renderBoth() {
  const sl = loadSL();
  sl.generateDashboard();
  sl.generateStatusline();
}

function spawnedCommands() {
  return [
    ...execSpy.mock.calls.map((c) => String(c[0])),
    ...spawnSpy.mock.calls.map((c) => [c[0], ...(c[1] || [])].join(' ')),
  ];
}

describe('statusline segment cache (#429)', () => {
  it('a cold render spawns git and sqlite3 and writes the cache', () => {
    renderBoth();
    const cmds = spawnedCommands();
    expect(cmds.some((c) => c.includes('git status --porcelain'))).toBe(true);
    expect(cmds.some((c) => c.startsWith('sqlite3'))).toBe(true);
    expect(fs.existsSync(cacheFile)).toBe(true);
  });

  it('a render with a warm cache spawns no git, sqlite3 or curl', () => {
    renderBoth();
    execSpy.mockClear();
    spawnSpy.mockClear();

    renderBoth();
    expect(spawnedCommands()).toEqual([]);
  });

  it('an expired git segment is refreshed; unexpired DB counts are not', () => {
    renderBoth();
    // Age every entry by 6 s: past the 5 s git TTL, inside the 30 s count TTL.
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    for (const entry of Object.values(data)) entry.at -= 6000;
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    const gitAtBefore = data.git.at;
    execSpy.mockClear();
    spawnSpy.mockClear();

    renderBoth();
    const cmds = spawnedCommands();
    expect(cmds.some((c) => c.includes('git status --porcelain'))).toBe(true);
    expect(cmds.some((c) => c.startsWith('sqlite3'))).toBe(false);
    const after = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    expect(after.git.at).toBeGreaterThan(gitAtBefore);
  });

  it('does not create .monomind/ in a project that has none', () => {
    fs.rmSync(path.join(tmpDir, '.monomind'), { recursive: true, force: true });
    renderBoth();
    expect(fs.existsSync(path.join(tmpDir, '.monomind'))).toBe(false);
  });
});

describe('createSegmentCache', () => {
  it('recomputes only after the TTL has passed', () => {
    const { createSegmentCache } = require(CACHE_UTIL);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    let t = 1000;
    const cached = createSegmentCache(cacheFile, () => t);
    const compute = vi.fn(() => ({ n: 1 }));
    expect(cached('k', 5000, compute)).toEqual({ n: 1 });
    t += 4999;
    cached('k', 5000, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    t += 1;
    cached('k', 5000, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('shares entries across instances through the file', () => {
    const { createSegmentCache } = require(CACHE_UTIL);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    createSegmentCache(cacheFile)('k', 5000, () => 'v1');
    const compute = vi.fn(() => 'v2');
    expect(createSegmentCache(cacheFile)('k', 5000, compute)).toBe('v1');
    expect(compute).not.toHaveBeenCalled();
  });

  it('treats a corrupt cache file as empty', () => {
    const { createSegmentCache } = require(CACHE_UTIL);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, 'not json');
    expect(createSegmentCache(cacheFile)('k', 5000, () => 7)).toBe(7);
  });
});
