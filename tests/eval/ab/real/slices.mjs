// Shared helpers for the pinned real-task slices (fetch.mjs, run.mjs, verify.mjs).
// A task fixture "slice:<id>" names an entry of slices.json, materialised by
// fetch.mjs under the cache dir.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const cacheDir = () => resolve(process.env.MONOMIND_AB_CACHE ?? join(HERE, '..', '.cache'));
export const sliceDir = (id) => join(cacheDir(), 'slices', id);
export const loadManifest = () => JSON.parse(readFileSync(join(HERE, 'slices.json'), 'utf8'));

/** sha256 over sorted relative paths and file bytes: identical trees hash identically. */
export function treeHash(dir) {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  };
  walk(dir);
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(relative(dir, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

/** The slice id of a fixture string ("slice:<id>"), or null for a committed fixture directory. */
export const sliceId = (fixture) => (fixture.startsWith('slice:') ? fixture.slice(6) : null);

export const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

/** Directory to copy into a run workspace: the fetched slice, or a committed fixture relative to `abDir`. */
export const fixtureDir = (fixture, abDir) => {
  const id = sliceId(fixture);
  if (!id) return join(abDir, fixture);
  const dir = sliceDir(id);
  if (!isDir(dir))
    throw new Error(`slice ${id} is not fetched; run node tests/eval/ab/real/fetch.mjs`);
  return dir;
};
