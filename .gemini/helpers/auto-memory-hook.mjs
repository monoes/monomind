#!/usr/bin/env node
/**
 * Auto Memory Bridge Hook (ADR-048/049) — Minimal Fallback
 * Full version is copied from package source when available.
 *
 * Usage:
 *   node auto-memory-hook.mjs import   # SessionStart
 *   node auto-memory-hook.mjs sync     # SessionEnd / Stop
 *   node auto-memory-hook.mjs status   # Show bridge status
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const DATA_DIR = join(PROJECT_ROOT, '.monomind', 'data');
const STORE_PATH = join(DATA_DIR, 'auto-memory-store.json');

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const dim = (msg) => console.log(`  ${DIM}${msg}${RESET}`);

// Ensure data dir
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

async function loadMemoryPackage() {
  // Strategy 1: Use createRequire for CJS-style resolution (handles nested node_modules
  // when installed as a transitive dependency via npx monomind / npx monomind)
  try {
    const { createRequire } = await import('module');
    const require = createRequire(join(PROJECT_ROOT, 'package.json'));
    return require('@monoes/memory');
  } catch { /* fall through */ }

  // Strategy 2: ESM import (works when @monomind/memory is a direct dependency)
  try { return await import('@monoes/memory'); } catch { /* fall through */ }

  // Strategy 3: Walk up from PROJECT_ROOT looking for the package in any node_modules
  let searchDir = PROJECT_ROOT;
  const { parse } = await import('path');
  while (searchDir !== parse(searchDir).root) {
    const candidate = join(searchDir, 'node_modules', '@monoes', 'memory', 'dist', 'index.js');
    if (existsSync(candidate)) {
      try { return await import(`file://${candidate}`); } catch { /* fall through */ }
    }
    searchDir = dirname(searchDir);
  }

  return null;
}

async function doImport() {
  dim('Auto memory import skipped — AutoMemoryBridge removed');
}

async function doSync() {
  dim('Auto memory sync skipped — AutoMemoryBridge removed');
}

function doStatus() {
  console.log('\n=== Auto Memory Bridge Status ===\n');
  console.log('  Package:        Fallback mode (run init --upgrade for full)');
  console.log(`  Store:          ${existsSync(STORE_PATH) ? 'Initialized' : 'Not initialized'}`);
  console.log('');
}

// Suppress unhandled rejection warnings ONLY for genuine module-not-found from
// optional dynamic imports. Previously this swallowed any error whose message
// contained "Cannot find" (e.g. "Cannot find user with id ..."), masking real
// failures and security regressions.
process.on('unhandledRejection', (reason) => {
  const code = reason && typeof reason === 'object' ? reason.code : undefined;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return;
  if (reason instanceof Error) throw reason;
  throw new Error(String(reason));
});

const command = process.argv[2] || 'status';

try {
  switch (command) {
    case 'import': await doImport(); break;
    case 'sync': await doSync(); break;
    case 'status': doStatus(); break;
    default:
      console.log('Usage: auto-memory-hook.mjs <import|sync|status>');
      process.exit(1);
  }
} catch (err) {
  // Hooks must never crash Claude Code - fail silently
  dim(`Error (non-critical): ${err.message}`);
}
// Ensure clean exit for Claude Code hooks (exit 0 = success)
process.exit(0);
