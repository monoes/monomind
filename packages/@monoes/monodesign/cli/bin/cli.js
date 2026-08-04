#!/usr/bin/env node

/**
 * Monodesign CLI
 *
 * Usage:
 *   monomind design detect [file-or-dir-or-url...]
 *   monomind design fix <file-or-dir...> [--dry-run] [--json] [--rule <id,...>]
 *   monomind design ignores <list|add-file|add-value|remove-...>
 *   monomind design --help
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Is this a detect target (the `monomind design src/` shorthand) or a mistyped
// command? Flags, URLs, path-shaped args, and real files/dirs (e.g. an
// extension-less `Dockerfile`) are targets; anything else is an unknown command.
function looksLikeDetectTarget(arg) {
  const isFlag = arg.startsWith('-');
  const isUrl = /^https?:\/\//i.test(arg);
  const isPathShaped = arg.includes('/') || arg.includes('\\') || arg.includes('.');
  const isExistingPath = existsSync(resolve(arg));
  return isFlag || isUrl || isPathShaped || isExistingPath;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`Usage: monodesign <command> [options]

Commands:
  detect [file-or-dir-or-url...]   Scan for UI anti-patterns and design quality issues
  fix <file-or-dir...>             Auto-fix findings with safe codemods (--dry-run, --json, --rule)
  ignores                          Manage detector ignore rules, files, and values

Options:
  --help       Show this help message
  --version    Show version number

The monodesign skill itself ships with monomind (npx monomind init).`);
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    console.log(pkg.version);
    process.exit(0);
  }

  if (command === 'detect') {
    process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];
    const { detectCli } = await import('../engine/detect-antipatterns.mjs');
    await detectCli();
  } else if (command === 'fix') {
    const { runFixCli } = await import('../engine/fix/index.mjs');
    await runFixCli(args.slice(1));
  } else if (command === 'ignores' || command === 'ignore') {
    const { run } = await import('./commands/ignores.mjs');
    await run(args.slice(1));
  } else if (looksLikeDetectTarget(command)) {
    // Default: treat as detect arguments (allow `monomind design src/` shorthand)
    process.argv = [process.argv[0], process.argv[1], ...args];
    const { detectCli } = await import('../engine/detect-antipatterns.mjs');
    await detectCli();
  } else {
    // An unknown bareword: a mistyped command (or an old cached version run
    // against newer docs). Fail loudly instead of silently statting it as a path.
    console.error(`Unknown command: "${command}"\n\nTo see a list of supported commands, run:\n  monodesign --help`);
    process.exit(1);
  }
}

main().catch(error => {
  if (error?.code === 'MONODESIGN_PROMPT_ABORT') {
    console.log('\nAborted.');
    process.exit(130);
  }

  console.error(error?.message || error);
  process.exit(1);
});
