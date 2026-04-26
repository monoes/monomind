#!/usr/bin/env node
// Monomind CLI - thin wrapper around @monomind/cli with monomind branding
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up from monomind/bin/ to find @monoes/monomindcli in node_modules
function findCliPath() {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '@monoes', 'monomindcli', 'bin', 'cli.js');
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
  ? join(pkgDir, 'node_modules', '@monoes', 'monomindcli')
  : resolve(__dirname, '../../packages/@monomind/cli');

// MCP mode: delegate to cli.js directly (branding irrelevant for JSON-RPC)
const cliArgs = process.argv.slice(2);
const isExplicitMCP = cliArgs.length >= 1 && cliArgs[0] === 'mcp' && (cliArgs.length === 1 || cliArgs[1] === 'start');
const isMCPMode = !process.stdin.isTTY && (process.argv.length === 2 || isExplicitMCP);

if (isMCPMode) {
  await import(toImportURL(join(cliBase, 'bin', 'cli.js')));
} else {
  // CLI mode: use monomind branding
  const { CLI } = await import(toImportURL(join(cliBase, 'dist', 'src', 'index.js')));
  const cli = new CLI({
    name: 'monomind',
    description: 'Monomind - AI Agent Orchestration Platform',
  });
  cli.run().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
