#!/usr/bin/env node
// Monobrain CLI - thin wrapper around @monobrain/cli with monobrain branding
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up from monobrain/bin/ to find @monobrain/cli in node_modules
function findCliPath() {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '@monobrain', 'cli', 'bin', 'cli.js');
    if (existsSync(candidate)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Convert path to file:// URL for cross-platform ESM import (Windows requires this)
function toImportURL(filePath) {
  return pathToFileURL(filePath).href;
}

const pkgDir = findCliPath();
const cliBase = pkgDir
  ? join(pkgDir, 'node_modules', '@monobrain', 'cli')
  : resolve(__dirname, '../../packages/@monobrain/cli');

// MCP mode: delegate to cli.js directly (branding irrelevant for JSON-RPC)
const cliArgs = process.argv.slice(2);
const isExplicitMCP = cliArgs.length >= 1 && cliArgs[0] === 'mcp' && (cliArgs.length === 1 || cliArgs[1] === 'start');
const isMCPMode = !process.stdin.isTTY && (process.argv.length === 2 || isExplicitMCP);

if (isMCPMode) {
  await import(toImportURL(join(cliBase, 'bin', 'cli.js')));
} else {
  // CLI mode: use monobrain branding
  const { CLI } = await import(toImportURL(join(cliBase, 'dist', 'src', 'index.js')));
  const cli = new CLI({
    name: 'monobrain',
    description: 'Monobrain - AI Agent Orchestration Platform',
  });
  cli.run().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
