#!/usr/bin/env node
/**
 * Pre-seed the semantic-routing embedding model on a fresh install.
 *
 * The semantic router needs Snowflake/snowflake-arctic-embed-xs (~88 MB)
 * cached on disk by @huggingface/transformers; without it, routing falls back
 * to keyword mode. Nothing downloads these weights implicitly — run this
 * script (or `monomind download-embeddings`) explicitly:
 *
 *   node scripts/download-embedding-model.mjs
 *
 * Loading the pipeline once is all it takes — transformers.js populates its
 * `.cache/` directory as a side effect. Exits 0 without downloading when the
 * model is already cached.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';

function findCacheDir() {
  let entry;
  try {
    const require = createRequire(import.meta.url);
    entry = require.resolve('@huggingface/transformers');
  } catch {
    return null;
  }
  let dir = dirname(entry);
  for (let i = 0; i < 5 && !existsSync(join(dir, 'package.json')); i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dir, '.cache');
}

function isCached(cacheDir) {
  return (
    existsSync(join(cacheDir, 'Snowflake')) ||
    existsSync(join(cacheDir, 'Xenova'))
  );
}

async function main() {
  const cacheDir = findCacheDir();
  if (!cacheDir) {
    console.error(
      'Error: @huggingface/transformers is not installed (optionalDependency).\n' +
        'Reinstall with optional dependencies enabled: npm install --include=optional',
    );
    process.exit(1);
  }

  if (isCached(cacheDir)) {
    console.log(`Embedding model already cached at ${cacheDir} — nothing to download.`);
    return;
  }

  console.log(`Downloading ${MODEL_ID} (~88 MB) into ${cacheDir} ...`);

  let hf;
  try {
    hf = await import('@huggingface/transformers');
  } catch (err) {
    console.error(`Error: failed to load @huggingface/transformers: ${err.message}`);
    process.exit(1);
  }

  let lastPct = -1;
  try {
    await hf.pipeline('feature-extraction', MODEL_ID, {
      dtype: 'fp32',
      progress_callback: (p) => {
        if (!p || !p.file) return;
        if (p.status === 'progress' && typeof p.progress === 'number') {
          const pct = Math.floor(p.progress / 10) * 10;
          if (pct !== lastPct) {
            lastPct = pct;
            console.log(`  ${p.file}: ${pct}%`);
          }
        } else if (p.status === 'done') {
          console.log(`  ${p.file}: done`);
        }
      },
    });
  } catch (err) {
    console.error(`Error: model download failed: ${err.message}`);
    process.exit(1);
  }

  console.log('Embedding model cached — semantic routing is now available.');
}

main();
