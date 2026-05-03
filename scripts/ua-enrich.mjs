#!/usr/bin/env node
/**
 * ua-enrich.mjs — Option C
 *
 * Background enrichment runner that:
 *  1. Runs the Understand-Anything extract-structure.mjs deterministic extraction
 *     on changed (or all) files in a project directory.
 *  2. Merges the resulting structural + metadata into an existing monograph DB
 *     WITHOUT requiring the full LLM agent pipeline.
 *
 * For full LLM semantic enrichment (summaries, layers), run the /understand
 * skill separately and then call ua-import.mjs on the resulting graph.json.
 *
 * This script is designed to be called from the post-edit or post-build hook
 * as a lightweight, non-LLM enrichment step that runs in <2s.
 *
 * Usage:
 *   node scripts/ua-enrich.mjs [--dir <projectDir>] [--file <changedFile>] [--db <monograph.db>]
 *
 * Options:
 *   --dir   Project root to scan (default: cwd)
 *   --file  Single file to re-enrich (incremental mode)
 *   --db    Path to monograph.db (default: <dir>/.monomind/monograph.db)
 *   --full  Force full scan even if graph.json exists
 *
 * Env:
 *   UA_GRAPH_JSON  Override path to UA graph.json
 *   UA_PLUGIN_DIR  Override path to understand-anything-plugin directory
 */

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const CWD   = process.cwd();

// ── Parse CLI args ───────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : null;
}
const hasFlag = (f) => process.argv.includes('--' + f);

const projectDir  = resolve(arg('dir') || CWD);
const changedFile = arg('file') ? resolve(arg('file')) : null;
const dbPath      = resolve(arg('db') || join(projectDir, '.monomind', 'monograph.db'));
const fullScan    = hasFlag('full');

// ── Locate Understand-Anything plugin ───────────────────────────────────────
function findUAPlugin() {
  const envPath = process.env.UA_PLUGIN_DIR;
  if (envPath && existsSync(envPath)) return resolve(envPath);

  // Common sibling locations relative to the monobrain root
  const candidates = [
    join(__dir, '..', '..', 'knowledgegraph', 'Understand-Anything', 'understand-anything-plugin'),
    join(dirname(__dir), '..', 'knowledgegraph', 'Understand-Anything', 'understand-anything-plugin'),
    '/Users/morteza/Desktop/tools/knowledgegraph/Understand-Anything/understand-anything-plugin',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── Locate extract-structure.mjs ─────────────────────────────────────────────
function findExtractScript(pluginDir) {
  const candidates = [
    join(pluginDir, 'skills', 'understand', 'extract-structure.mjs'),
    join(pluginDir, 'extract-structure.mjs'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── Resolve monograph package ────────────────────────────────────────────────
function requireMonograph() {
  const require = createRequire(import.meta.url);
  const candidates = [
    join(CWD, 'node_modules/.pnpm/node_modules/@monoes/monograph'),
    join(CWD, 'packages/node_modules/.pnpm/node_modules/@monoes/monograph'),
    join(CWD, 'node_modules/@monoes/monograph'),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return require(c); } catch {}
  }
  try { return require('@monoes/monograph'); } catch {}
  throw new Error('Cannot find @monoes/monograph');
}

// ── Check for existing UA graph.json ────────────────────────────────────────
function findUAGraph(dir) {
  if (process.env.UA_GRAPH_JSON) return process.env.UA_GRAPH_JSON;
  const candidates = [
    join(dir, '.understand', 'knowledge-graph.json'),
    join(dir, '.understand', 'graph.json'),
    join(dir, '.ua', 'knowledge-graph.json'),
    join(dir, '.ua', 'graph.json'),
    join(dir, 'graph.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[UA-ENRICH] Starting enrichment for', projectDir);

  if (!existsSync(dbPath)) {
    console.log('[UA-ENRICH] monograph.db not found — skipping (build monograph first)');
    process.exit(0);
  }

  const mg = requireMonograph();
  const db = mg.openDb(dbPath);

  // ── Phase 1: Try importing existing UA graph.json ──────────────────────────
  const existingGraph = findUAGraph(projectDir);
  if (existingGraph && !fullScan) {
    const stat = statSync(existingGraph);
    const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
    if (ageHours < 24) {
      console.log(`[UA-ENRICH] Found recent graph.json (${ageHours.toFixed(1)}h old) — importing`);
      mg.closeDb(db);
      // Delegate to ua-import.mjs
      const importScript = join(__dir, 'ua-import.mjs');
      if (existsSync(importScript)) {
        const result = spawnSync(process.execPath, [importScript, existingGraph, dbPath], {
          stdio: 'inherit', cwd: CWD,
        });
        process.exit(result.status ?? 0);
      }
      console.log('[UA-ENRICH] ua-import.mjs not found — continuing with direct enrichment');
    } else {
      console.log(`[UA-ENRICH] graph.json is ${ageHours.toFixed(0)}h old — will re-enrich from DB only`);
    }
  }

  // ── Phase 2: Deterministic structural extraction (no LLM) ─────────────────
  // Run UA's extract-structure.mjs on the target file/directory and capture output.
  const pluginDir = findUAPlugin();
  const extractScript = pluginDir ? findExtractScript(pluginDir) : null;

  if (extractScript && changedFile) {
    console.log('[UA-ENRICH] Running deterministic extraction on', basename(changedFile));
    try {
      const result = spawnSync(process.execPath, [extractScript, changedFile], {
        cwd: projectDir,
        timeout: 10_000,
        encoding: 'utf-8',
      });
      if (result.stdout) {
        let extracted;
        try { extracted = JSON.parse(result.stdout); } catch { extracted = null; }
        if (extracted && extracted.functions) {
          // Write extracted structural data back into the node's properties
          const normPath = changedFile.startsWith(projectDir)
            ? changedFile.slice(projectDir.length + 1)
            : changedFile;
          const row = db.prepare("SELECT id, properties FROM nodes WHERE file_path LIKE ? LIMIT 1")
            .get('%' + basename(changedFile));
          if (row) {
            const existing = row.properties ? JSON.parse(row.properties) : {};
            const merged = {
              ...existing,
              ua_extracted: {
                functions:  extracted.functions?.length ?? 0,
                classes:    extracted.classes?.length ?? 0,
                imports:    extracted.imports?.length ?? 0,
                exports:    extracted.exports?.length ?? 0,
                updatedAt:  new Date().toISOString(),
              },
            };
            db.prepare("UPDATE nodes SET properties = ? WHERE id = ?")
              .run(JSON.stringify(merged), row.id);
            console.log(`[UA-ENRICH] Updated structural data for ${row.id}`);
          }
        }
      }
    } catch (e) {
      console.log('[UA-ENRICH] Extraction warning:', e.message);
    }
  } else if (!extractScript) {
    console.log('[UA-ENRICH] UA extract script not found — skipping deterministic extraction');
    console.log('[UA-ENRICH] Set UA_PLUGIN_DIR env var or place Understand-Anything beside monobrain');
  }

  // ── Phase 3: Propagate existing UA summaries to FTS ───────────────────────
  // If nodes have ua_type/summary in properties but FTS is stale, rebuild it.
  try {
    const enrichedCount = db.prepare(
      `SELECT COUNT(*) AS c FROM nodes WHERE properties LIKE '%ua_type%'`
    ).get().c;
    if (enrichedCount > 0) {
      console.log(`[UA-ENRICH] ${enrichedCount} UA-enriched nodes in DB`);
      db.prepare(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`).run();
      console.log('[UA-ENRICH] FTS rebuilt');
    } else {
      console.log('[UA-ENRICH] No UA enrichment data yet — run ua-import.mjs after /understand');
    }
  } catch { /* FTS may not exist */ }

  // ── Phase 4: Write enrichment status to .monomind/ ────────────────────────
  try {
    const statusPath = join(projectDir, '.monomind', 'ua-enrich-status.json');
    writeFileSync(statusPath, JSON.stringify({
      lastRun: new Date().toISOString(),
      mode: changedFile ? 'incremental' : 'full',
      file: changedFile || null,
      pluginFound: !!pluginDir,
      graphFound: !!existingGraph,
    }, null, 2));
  } catch {}

  mg.closeDb(db);
  console.log('[UA-ENRICH] Done');
}

main().catch((e) => {
  console.error('[UA-ENRICH] Error:', e.message);
  process.exit(1);
});
