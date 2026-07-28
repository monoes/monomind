#!/usr/bin/env node
/**
 * Archive superseded document chunks out of the memory store.
 *
 * WHY THIS EXISTS
 * ---------------
 * Document chunks are keyed `doc:<contentHash>:<chunkIndex>`. Re-ingesting a
 * changed file mints a new contentHash, so the previous version's rows are
 * orphaned and never deleted. Measured on this repo's store 2026-07-28: 10,967
 * of 11,465 `doc:` rows (95.6%) are dead versions.
 *
 * Under the Second Brain plan those rows are NOT garbage. They are the only
 * existing record of what a document used to say and when it stopped saying it
 * — the corpus for item 7 (bi-temporal knowledge graph), which is where Zep's
 * LoCoMo lead comes from. Item 4 marks them superseded rather than destroying
 * them, but they currently exist inside exactly one user's store on one
 * machine. This script removes that single point of failure.
 *
 * It is READ-ONLY against the store. It opens the database readonly and never
 * writes to it. Nothing here deletes anything.
 *
 * WHAT IS ARCHIVED, AND WHAT DELIBERATELY IS NOT
 * ---------------------------------------------
 * Archived: chunk key, content hash, chunk index, the originating file path and
 * scope, the chunk text, row timestamps, and `supersededBy` — the content hash
 * that replaced this version, which is what makes the archive a temporal chain
 * rather than a pile of orphans.
 *
 * NOT archived: the embedding vectors (16.8 MB). Two reasons. They are fully
 * recomputable from the archived text, and plan item 2 swaps the embedding
 * model from all-MiniLM-L6-v2 (384d) to EmbeddingGemma (768d), which
 * invalidates every stored vector anyway. Archiving them would preserve 16.8 MB
 * of bytes that are scheduled to become worthless.
 *
 * USAGE
 *   node scripts/archive-superseded-chunks.mjs [--out <path>] [--store <path>] [--root <path>]
 *   node scripts/archive-superseded-chunks.mjs --verify <archive.jsonl.gz>
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ── args ────────────────────────────────────────────────────────────────────

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const VERIFY_ONLY = arg('verify');

/** Resolve the per-project store the CLI would use for this cwd. */
function defaultStorePath(root) {
  // The CLI keys the store directory to the project path; rather than
  // reimplementing that hash, find the store whose doc rows match this repo.
  const projects = path.join(os.homedir(), '.monomind', 'projects');
  if (!fs.existsSync(projects)) return null;
  let best = null;
  for (const dir of fs.readdirSync(projects)) {
    if (!dir.startsWith(path.basename(root) + '-')) continue;
    const db = path.join(projects, dir, 'lancedb', 'memory.db'); // dir name is vestigial; plain SQLite
    if (fs.existsSync(db)) {
      const size = fs.statSync(db).size;
      if (!best || size > best.size) best = { db, size };
    }
  }
  return best?.db ?? null;
}

// ── metadata log ────────────────────────────────────────────────────────────

/**
 * Read the append-only metadata log twice over, for two different purposes.
 *
 * `live`    — last-wins per (filePath, scope), tombstones (chunkCount < 0)
 *             dropped. This mirrors readMetadata() in document-pipeline.ts
 *             exactly and defines what is CURRENT.
 * `history` — every record ever written, keyed by contentHash. This is what
 *             lets a dead hash be attributed back to the file it came from;
 *             without it the archived chunks would be unattributable text.
 */
function readMetadataLog(root) {
  const file = path.join(root, '.monomind', 'knowledge', 'doc-metadata.jsonl');
  if (!fs.existsSync(file)) throw new Error(`no metadata log at ${file}`);

  const latest = new Map();
  const history = new Map();
  const order = [];
  let torn = 0;

  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { torn++; continue; }
    latest.set(`${m.filePath} ${m.scope}`, m);
    if (m.contentHash) {
      if (!history.has(m.contentHash)) history.set(m.contentHash, m);
      order.push(m);
    }
  }

  const liveRecords = [...latest.values()].filter((m) => m.chunkCount >= 0);
  const live = new Set(liveRecords.filter((m) => m.contentHash).map((m) => m.contentHash));

  // Version chain per (filePath, scope), in log order: lets us record which
  // hash superseded which. This is the bi-temporal edge item 7 needs.
  const successor = new Map();
  const perFile = new Map();
  for (const m of order) {
    const k = `${m.filePath} ${m.scope}`;
    const prev = perFile.get(k);
    if (prev && prev !== m.contentHash) successor.set(prev, m.contentHash);
    perFile.set(k, m.contentHash);
  }

  return { live, history, successor, liveRecords, torn };
}

// ── verify mode ─────────────────────────────────────────────────────────────

function verify(archivePath) {
  const manifestPath = archivePath.replace(/\.jsonl\.gz$/, '.manifest.json');
  if (!fs.existsSync(archivePath)) throw new Error(`archive not found: ${archivePath}`);
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const raw = fs.readFileSync(archivePath);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');

  const text = zlib.gunzipSync(raw).toString('utf-8');
  const lines = text.split('\n').filter((l) => l.trim());
  let bad = 0;
  const hashes = new Set();
  for (const l of lines) {
    try {
      const r = JSON.parse(l);
      if (!r.key || typeof r.content !== 'string') bad++;
      else hashes.add(r.contentHash);
    } catch { bad++; }
  }

  const ok = sha === manifest.sha256 && lines.length === manifest.rows && bad === 0;
  console.log(`archive        : ${archivePath}`);
  console.log(`sha256         : ${sha} ${sha === manifest.sha256 ? 'MATCH' : 'MISMATCH'}`);
  console.log(`rows           : ${lines.length} (manifest: ${manifest.rows})`);
  console.log(`distinct hashes: ${hashes.size} (manifest: ${manifest.distinctHashes})`);
  console.log(`malformed      : ${bad}`);
  console.log(ok ? '\nVERIFIED' : '\nVERIFICATION FAILED');
  process.exit(ok ? 0 : 1);
}

if (VERIFY_ONLY) verify(path.resolve(VERIFY_ONLY));

// ── export ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(arg('root', process.cwd()));
const STORE = arg('store') ? path.resolve(arg('store')) : defaultStorePath(ROOT);
if (!STORE || !fs.existsSync(STORE)) {
  console.error('could not locate the memory store; pass --store <path to memory.db>');
  process.exit(1);
}

const { live, history, successor, liveRecords, torn } = readMetadataLog(ROOT);

const stamp = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(
  arg('out', path.join(path.dirname(STORE), 'archive', `superseded-chunks-${stamp}.jsonl.gz`)),
);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const Database = require('better-sqlite3');
const db = new Database(STORE, { readonly: true, fileMustExist: true });

const rows = db.prepare(
  `SELECT key, content, namespace, created_at, updated_at, version
     FROM memory_entries
    WHERE key LIKE 'doc:%'
    ORDER BY key`,
).all();

const gzip = zlib.createGzip({ level: 9 });
const out = fs.createWriteStream(OUT);
gzip.pipe(out);

let archived = 0;
let liveSkipped = 0;
let unattributable = 0;
const deadHashes = new Set();
let contentBytes = 0;

for (const r of rows) {
  const parts = String(r.key).split(':');
  const contentHash = parts[1] ?? '';
  const chunkIndex = Number(parts[2] ?? -1);

  if (live.has(contentHash)) { liveSkipped++; continue; }

  const meta = history.get(contentHash);
  if (!meta) unattributable++;

  deadHashes.add(contentHash);
  contentBytes += (r.content ?? '').length;

  gzip.write(JSON.stringify({
    key: r.key,
    contentHash,
    chunkIndex,
    namespace: r.namespace,
    // Provenance: which document this version of which file came from.
    filePath: meta?.filePath ?? null,
    scope: meta?.scope ?? null,
    title: meta?.title ?? null,
    chunkCount: meta?.chunkCount ?? null,
    // Bi-temporal edge: the hash that replaced this one, if the log knows it.
    supersededBy: successor.get(contentHash) ?? null,
    ingestedAt: meta?.ingestedAt ?? null,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  }) + '\n');
  archived++;
}

gzip.end();
await new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });

const raw = fs.readFileSync(OUT);
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');

const manifest = {
  createdAt: new Date().toISOString(),
  purpose:
    'Superseded document chunks preserved as the corpus for Second Brain plan item 7 ' +
    '(bi-temporal knowledge graph). Read-only export; nothing was deleted from the store.',
  store: STORE,
  projectRoot: ROOT,
  rows: archived,
  distinctHashes: deadHashes.size,
  liveRowsSkipped: liveSkipped,
  unattributableRows: unattributable,
  liveDocuments: liveRecords.length,
  tornMetadataLines: torn,
  uncompressedContentBytes: contentBytes,
  archiveBytes: raw.length,
  sha256,
  embeddingsIncluded: false,
  embeddingsNote:
    'Vectors omitted deliberately: recomputable from the archived text, and plan item 2 ' +
    'changes the embedding model 384d -> 768d, which invalidates every stored vector.',
  schemaVersion: 1,
};
fs.writeFileSync(OUT.replace(/\.jsonl\.gz$/, '.manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`archived        : ${archived} superseded chunks (${deadHashes.size} distinct versions)`);
console.log(`live skipped    : ${liveSkipped} rows across ${liveRecords.length} current documents`);
console.log(`unattributable  : ${unattributable} (no metadata record for the content hash)`);
console.log(`content         : ${(contentBytes / 1e6).toFixed(1)} MB -> ${(raw.length / 1e6).toFixed(1)} MB gzipped`);
console.log(`archive         : ${OUT}`);
console.log(`sha256          : ${sha256}`);
console.log(`\nverify with: node scripts/archive-superseded-chunks.mjs --verify ${OUT}`);
