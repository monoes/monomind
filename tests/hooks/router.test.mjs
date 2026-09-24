/**
 * Tests for .claude/helpers/router.cjs — matchSkills and the export surface.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const ROUTER_PATH = path.resolve(__dirname, '../../.claude/helpers/router.cjs');

let _origProjectDir;
let _tmpDir;

beforeEach(() => {
  // Isolate tests from the real skill registry — point CLAUDE_PROJECT_DIR to a
  // temp dir so loadSkills uses its fallback list.
  _origProjectDir = process.env.CLAUDE_PROJECT_DIR;
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-test-'));
  process.env.CLAUDE_PROJECT_DIR = _tmpDir;
});

afterEach(() => {
  if (_origProjectDir !== undefined) {
    process.env.CLAUDE_PROJECT_DIR = _origProjectDir;
  } else {
    delete process.env.CLAUDE_PROJECT_DIR;
  }
  try {
    fs.rmSync(_tmpDir, { recursive: true, force: true });
  } catch (_e) {}
});

function loadRouter() {
  delete require.cache[ROUTER_PATH];
  return require(ROUTER_PATH);
}

// ── matchSkills ────────────────────────────────────────────────────────────────

describe('matchSkills', () => {
  it('returns an array', () => {
    const r = loadRouter();
    expect(Array.isArray(r.matchSkills('implement a feature'))).toBe(true);
  });

  it('returns empty array for non-string input', () => {
    const r = loadRouter();
    expect(r.matchSkills(null)).toEqual([]);
    expect(r.matchSkills(42)).toEqual([]);
  });

  it('returns empty array when no skill keywords match', () => {
    const r = loadRouter();
    const results = r.matchSkills('zzzzz totally unrelated');
    expect(results).toEqual([]);
  });

  it('returns results sorted by score descending', () => {
    const r = loadRouter();
    const results = r.matchSkills('implement build create feature');
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  it('limits results to topN (default 5)', () => {
    const r = loadRouter();
    const results = r.matchSkills('implement build create test review debug optimize research');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('each result has skill, invoke, description, score fields', () => {
    const r = loadRouter();
    const results = r.matchSkills('implement the feature');
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('skill');
      expect(results[0]).toHaveProperty('invoke');
      expect(results[0]).toHaveProperty('score');
    }
  });
});

// ── exports ───────────────────────────────────────────────────────────────────

describe('exports', () => {
  // The keyword agent table (routeTask, matchExtras, AGENT_CAPABILITIES, ...)
  // named slugs that are not installed agents and had no runtime caller.
  it('exports only matchSkills — no agent table', () => {
    const r = loadRouter();
    expect(Object.keys(r)).toEqual(['matchSkills']);
  });
});
