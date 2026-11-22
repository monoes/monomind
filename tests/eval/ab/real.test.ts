// Offline structure checks of the 30 real A/B tasks (tasks-real/) and their pinned slices
// (real/slices.json). Nothing here fetches, spawns an agent or spends money; the behavioural
// proof (check fails on the untouched slice, passes with the reference patch) is
// `node tests/eval/ab/real/verify.mjs`, which needs the slices fetched.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without type declarations
import { fixtureDir, sliceId, treeHash } from './real/slices.mjs';

const AB = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(AB, 'real/slices.json'), 'utf8')) as {
  slices: Record<
    string,
    {
      license: string;
      base?: string;
      sources?: { repo: string; sha: string; paths: string[] }[];
      patches?: { path: string; find: string; replace: string }[];
      treeSha256?: string;
    }
  >;
};
const tasks = readdirSync(join(AB, 'tasks-real'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(AB, 'tasks-real', f), 'utf8')));

const hardTasks = readdirSync(join(AB, 'tasks-hard'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(AB, 'tasks-hard', f), 'utf8')));

describe('real task set', () => {
  it('has exactly 30 uniquely named tasks in the shared task schema', () => {
    expect(tasks).toHaveLength(30);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(30);
    for (const t of tasks) {
      expect(Object.keys(t).sort()).toEqual(
        ['check', 'fixture', 'id', 'maxTurns', 'prompt', 'tags', 'timeoutS', 'title'].sort(),
      );
      expect(Array.isArray(t.tags) && t.tags.length > 0).toBe(true);
      expect(Array.isArray(t.check.command)).toBe(true);
      expect(typeof t.check.timeoutS).toBe('number');
      expect(t.prompt.length).toBeGreaterThan(150);
    }
  });

  it('mixes the four task kinds', () => {
    const count = (tag: string) => tasks.filter((t) => t.tags.includes(tag)).length;
    expect(count('rename')).toBeGreaterThanOrEqual(8);
    expect(count('feature')).toBeGreaterThanOrEqual(6);
    expect(count('bug-localisation')).toBeGreaterThanOrEqual(6);
    expect(count('callers-impact')).toBeGreaterThanOrEqual(4);
  });

  it('gives every task a slice, a hidden overlay with its check and a reference patch', () => {
    for (const t of tasks) {
      const id = sliceId(t.fixture);
      expect(id, t.id).toBeTruthy();
      expect(manifest.slices[id], `${t.id}: slice ${id}`).toBeDefined();
      expect(t.check.overlay, t.id).toBe(`real/hidden/${t.id}`);
      expect(readdirSync(join(AB, t.check.overlay)), t.id).toContain('check.mjs');
      expect(readdirSync(join(AB, 'real/reference')), t.id).toContain(`${t.id}.patch`);
    }
  });

  it('never mentions the hidden check in the prompt', () => {
    for (const t of tasks) {
      expect(t.prompt).not.toMatch(/check\.mjs|hidden check|overlay/i);
      expect(t.fixture.startsWith('slice:')).toBe(true);
    }
  });
});

describe('slices manifest', () => {
  it('pins every source to a full commit sha, with a license and a content hash', () => {
    for (const [id, s] of Object.entries(manifest.slices)) {
      expect(s.license, id).toMatch(/^(MIT|ISC)$/);
      expect(s.treeSha256, id).toMatch(/^[0-9a-f]{64}$/);
      for (const src of s.sources ?? []) {
        expect(src.sha, `${id} ${src.repo}`).toMatch(/^[0-9a-f]{40}$/);
        expect(src.paths.length).toBeGreaterThan(0);
      }
      if (s.base) {
        expect(manifest.slices[s.base], `${id} base`).toBeDefined();
        expect(s.patches?.length, `${id} patches`).toBeGreaterThan(0);
      } else {
        expect(s.sources?.length, id).toBeGreaterThan(0);
      }
    }
  });

  it('uses every slice in at least one task of either set', () => {
    const used = new Set([...tasks, ...hardTasks].map((t) => sliceId(t.fixture)));
    const bases = new Set(Object.values(manifest.slices).map((s) => s.base));
    for (const id of Object.keys(manifest.slices)) expect(used.has(id) || bases.has(id), id).toBe(true);
  });
});

describe('slice helpers', () => {
  it('parses slice fixtures and leaves directory fixtures alone', () => {
    expect(sliceId('slice:semver-7.7.1')).toBe('semver-7.7.1');
    expect(sliceId('fixtures/pagination')).toBeNull();
    expect(fixtureDir('fixtures/pagination', '/x/ab')).toBe('/x/ab/fixtures/pagination');
  });

  it('hashes a tree by paths and bytes, independent of creation order', () => {
    const mk = (order: string[]) => {
      const d = mkdtempSync(join(tmpdir(), 'mm-ab-hash-'));
      for (const f of order) {
        mkdirSync(dirname(join(d, f)), { recursive: true });
        writeFileSync(join(d, f), `content of ${f}`);
      }
      return d;
    };
    const a = mk(['x/1.js', 'y.js']);
    const b = mk(['y.js', 'x/1.js']);
    expect(treeHash(a)).toBe(treeHash(b));
    writeFileSync(join(b, 'y.js'), 'changed');
    expect(treeHash(a)).not.toBe(treeHash(b));
  });
});

describe('hard task set (tasks-hard)', () => {
  const arms = JSON.parse(readFileSync(join(AB, 'arms.json'), 'utf8')).arms as Record<
    string,
    { settings: string; setup: string[][]; assume: { inputTokens: number; outputTokens: number } }
  >;

  it('has 15 tasks with ids distinct from the real set, in the shared task schema', () => {
    expect(hardTasks).toHaveLength(15);
    expect(new Set([...hardTasks, ...tasks].map((t) => t.id)).size).toBe(45);
    for (const t of hardTasks) {
      expect(Object.keys(t).sort()).toEqual(
        ['check', 'fixture', 'id', 'maxTurns', 'prompt', 'tags', 'timeoutS', 'title'].sort(),
      );
      expect(Array.isArray(t.check.command)).toBe(true);
      expect(t.prompt.length).toBeGreaterThan(300);
    }
  });

  it('mixes rename, feature, bug-localisation and callers-impact tasks', () => {
    const count = (tag: string) => hardTasks.filter((t) => t.tags.includes(tag)).length;
    expect(count('rename')).toBeGreaterThanOrEqual(4);
    expect(count('feature')).toBeGreaterThanOrEqual(4);
    expect(count('bug-localisation')).toBeGreaterThanOrEqual(4);
    expect(count('callers-impact')).toBeGreaterThanOrEqual(4);
  });

  it('gives every task a slice, a hidden check and a reference patch, and never names files in the prompt', () => {
    for (const t of hardTasks) {
      const id = sliceId(t.fixture);
      expect(manifest.slices[id], `${t.id}: slice ${id}`).toBeDefined();
      expect(t.check.overlay, t.id).toBe(`real/hidden/${t.id}`);
      expect(readdirSync(join(AB, t.check.overlay)), t.id).toContain('check.mjs');
      expect(readdirSync(join(AB, 'real/reference')), t.id).toContain(`${t.id}.patch`);
      expect(t.prompt, t.id).not.toMatch(/check\.mjs|hidden check|overlay/i);
      // no file names: strip API names such as Prism.languages.mjs first
      const prose = t.prompt.replace(/\b[A-Z]\w*(?:\.\w+)+/g, '');
      expect(prose, t.id).not.toMatch(/[\w-]+\.(?:m?js|cjs|json|ts|patch)\b/);
    }
  });

  it('draws on pinned slices of permissively licensed code from four code bases', () => {
    const slices = new Set(hardTasks.map((t) => sliceId(t.fixture)));
    for (const id of slices) {
      const s = manifest.slices[id];
      expect(s.license, id).toMatch(/^(MIT|ISC|BSD-[23]-Clause)$/);
      expect(s.treeSha256, id).toMatch(/^[0-9a-f]{64}$/);
    }
    const repos = new Set([...slices].map((id) => id.replace(/-\d.*$/, '')));
    expect([...repos].sort()).toEqual(['core-js', 'lodash', 'prismjs', 'ramda']);
  });

  it('keeps the slices large when they are fetched (hundreds of files)', () => {
    for (const id of new Set(hardTasks.map((t) => sliceId(t.fixture)))) {
      let dir: string;
      try {
        dir = fixtureDir(`slice:${id}`, AB);
      } catch {
        continue; // not fetched in this environment
      }
      const count = (d: string): number =>
        readdirSync(d, { withFileTypes: true }).reduce(
          (n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1),
          0,
        );
      expect(count(dir), id).toBeGreaterThanOrEqual(300);
    }
  });

  it('adds a lean-graph arm that is lean plus a monograph build, next to the unchanged arms', () => {
    expect(Object.keys(arms)).toEqual(['off', 'lean', 'lean-graph', 'full']);
    expect(arms['lean-graph'].settings).toBe(arms.lean.settings);
    expect(arms['lean-graph'].setup).toEqual([...arms.lean.setup, ['monograph', 'build']]);
    expect(arms['lean-graph'].assume).toEqual(arms.lean.assume);
    expect(arms.off.setup).toEqual([]);
    expect(arms.full.setup).toEqual([['init', '--full', '--yes'], ['monograph', 'build']]);
  });
});
