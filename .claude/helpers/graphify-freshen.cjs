'use strict';
// Runs at SessionStart — rebuilds the knowledge graph using @monoes/monograph in the background.
// Fire-and-forget: spawns detached child, logs start, exits immediately without blocking session.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const graphDir = path.join(projectDir, '.monomind', 'graph');
fs.mkdirSync(graphDir, { recursive: true });

const logPath = path.join(graphDir, 'build.log');
let logFd;
try { logFd = fs.openSync(logPath, 'a'); } catch { logFd = 'ignore'; }

// Resolve the monograph entry point — searches several common layouts
function resolveMonographEntry(dir) {
  // pnpm virtual store — the reliable pre-built copy not affected by workspace symlinks
  const pnpmStore = (() => {
    try {
      const storeBase = path.join(dir, 'node_modules', '.pnpm');
      if (!fs.existsSync(storeBase)) return null;
      const entries = fs.readdirSync(storeBase).filter(e => e.startsWith('@monoes+monograph@'));
      for (const e of entries.sort().reverse()) { // newest version first
        const p = path.join(storeBase, e, 'node_modules', '@monoes', 'monograph', 'dist', 'src', 'index.js');
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    return null;
  })();

  const candidates = [
    // pnpm store version (most reliable — pre-built, isolated from workspace source changes)
    pnpmStore,
    // Monorepo: monobrain root is the monograph package
    path.join(dir, 'dist', 'src', 'index.js'),
    // Monorepo: monograph lives under packages/@monomind/monograph (pnpm workspace)
    path.join(dir, 'packages', '@monomind', 'monograph', 'dist', 'src', 'index.js'),
    // Installed as a flat dependency
    path.join(dir, 'node_modules', '@monoes', 'monograph', 'dist', 'src', 'index.js'),
    path.join(dir, 'node_modules', '@monomind', 'monograph', 'dist', 'src', 'index.js'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const entryPoint = resolveMonographEntry(projectDir);
if (!entryPoint) {
  console.error('[graph] @monoes/monograph not found — skipping build');
  process.exit(0);
}

// Spawn a detached node process to run buildAsync from @monoes/monograph (ESM)
const script = `import { buildAsync } from ${JSON.stringify('file://' + entryPoint)}; await buildAsync(${JSON.stringify(projectDir)});`;
const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  cwd: projectDir,
});
child.unref();

console.log('[graph] background build started for ' + projectDir);
