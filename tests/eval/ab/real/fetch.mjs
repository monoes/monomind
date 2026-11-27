#!/usr/bin/env node
// Materialises the pinned open-source slices that the real A/B tasks use
// (tests/eval/ab/tasks-real/*.json, fixture "slice:<id>") into a cache dir.
// The manifest is tests/eval/ab/real/slices.json: per slice, one or more sources (repo URL + full
// commit SHA + paths to keep + destination dir) and optional literal extra files. A slice may
// instead be a variant: `base` (another slice) plus `patches` [{path, find, replace}], used to
// inject a regression into otherwise unmodified upstream code (the bug-localisation tasks).
// Nothing is committed but the manifest; the code comes from the pinned commits, and a sha256 over
// the resulting tree (treeSha256) proves the cache matches what the checks were written against.
//
//   node tests/eval/ab/real/fetch.mjs                 # all slices
//   node tests/eval/ab/real/fetch.mjs --only a,b      # some slices
//   node tests/eval/ab/real/fetch.mjs --update-hashes # (re)write treeSha256 into the manifest
//   node tests/eval/ab/real/fetch.mjs --force         # refetch even if cached
//
// A source may carry `exclude: [suffix, ...]` (file-name suffixes dropped after extraction).
// Cache dir: $MONOMIND_AB_CACHE or tests/eval/ab/.cache. Needs network and git only.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir, sliceDir, treeHash } from './slices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'slices.json');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const ids = Object.keys(manifest.slices).filter((id) => !only || only.includes(id));
if (only) for (const o of only) if (!manifest.slices[o]) throw new Error(`unknown slice ${o}`);

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

function dropSuffixes(dir, suffixes) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) dropSuffixes(p, suffixes);
    else if (suffixes.some((s) => e.name.endsWith(s))) rmSync(p);
  }
}

function fetchSource(src, dest) {
  if (!/^[0-9a-f]{40}$/.test(src.sha))
    throw new Error(`${src.repo}: sha must be a full 40-hex commit`);
  const tmp = mkdtempSync(join(tmpdir(), 'mm-ab-fetch-'));
  try {
    git(tmp, 'init', '-q');
    git(tmp, 'fetch', '-q', '--depth', '1', `https://github.com/${src.repo}`, src.sha);
    const head = git(tmp, 'rev-parse', 'FETCH_HEAD').toString().trim();
    if (head !== src.sha) throw new Error(`${src.repo}: fetched ${head}, pinned ${src.sha}`);
    mkdirSync(dest, { recursive: true });
    // `git archive` of FETCH_HEAD restricted to the wanted paths, extracted into dest.
    const tar = execFileSync('git', ['archive', '--format=tar', 'FETCH_HEAD', '--', ...src.paths], {
      cwd: tmp,
      maxBuffer: 1 << 28,
    });
    execFileSync('tar', ['-x', '-C', dest], { input: tar });
    // Optional `exclude`: file-name suffixes (e.g. ".min.js") removed after extraction, so a slice can
    // drop generated or minified copies that would only add noise.
    if (src.exclude?.length) dropSuffixes(dest, src.exclude);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

let manifestChanged = false;
const done = new Set();

function applyPatches(dir, patches) {
  for (const { path, find, replace } of patches) {
    const f = join(dir, path);
    const text = readFileSync(f, 'utf8');
    if (text.split(find).length !== 2)
      throw new Error(`${path}: patch anchor must occur exactly once: ${find}`);
    writeFileSync(
      f,
      text.replace(find, () => replace),
    );
  }
}

function materialise(id) {
  if (done.has(id)) return;
  done.add(id);
  const slice = manifest.slices[id];
  if (slice.base) {
    if (!manifest.slices[slice.base]) throw new Error(`${id}: unknown base ${slice.base}`);
    materialise(slice.base);
  }
  const dir = sliceDir(id);
  const have = (() => {
    try {
      return treeHash(dir);
    } catch {
      return null;
    }
  })();
  if (have && !flag('--force') && (!slice.treeSha256 || have === slice.treeSha256)) {
    console.log(`${id}: cached (${have.slice(0, 12)})`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  if (slice.base) cpSync(sliceDir(slice.base), dir, { recursive: true });
  for (const src of slice.sources ?? []) fetchSource(src, resolve(dir, src.dest ?? '.'));
  for (const [p, content] of Object.entries(slice.files ?? {})) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  applyPatches(dir, slice.patches ?? []);
  const h = treeHash(dir);
  if (flag('--update-hashes')) {
    slice.treeSha256 = h;
    manifestChanged = true;
  } else if (slice.treeSha256 && slice.treeSha256 !== h) {
    throw new Error(`${id}: tree hash ${h} does not match the manifest ${slice.treeSha256}`);
  }
  console.log(`${id}: fetched into ${dir} (${h.slice(0, 12)})`);
}

for (const id of ids) materialise(id);
if (manifestChanged) writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`cache: ${cacheDir()}`);
