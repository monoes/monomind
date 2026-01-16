#!/usr/bin/env node
/**
 * Toggles the Monobrain statusline between full (multi-line dashboard)
 * and compact (single-line) mode.
 *
 * Usage:
 *   node .claude/helpers/toggle-statusline.cjs          — toggle and print new state label
 *   node .claude/helpers/toggle-statusline.cjs --set full    — force full mode
 *   node .claude/helpers/toggle-statusline.cjs --set compact — force compact mode
 *   node .claude/helpers/toggle-statusline.cjs --get    — print current mode
 */
const fs = require('fs');
const path = require('path');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MODE_FILE = path.join(CWD, '.monobrain', 'statusline-mode.txt');

function readMode() {
  try {
    if (fs.existsSync(MODE_FILE)) return fs.readFileSync(MODE_FILE, 'utf-8').trim();
  } catch { /* ignore */ }
  return 'full';
}

function writeMode(mode) {
  try {
    fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true });
    fs.writeFileSync(MODE_FILE, mode, 'utf-8');
  } catch (e) {
    process.stderr.write(`toggle-statusline: failed to write mode file: ${e.message}\n`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);

if (args.includes('--get')) {
  console.log(readMode());
  process.exit(0);
}

if (args.includes('--set')) {
  const idx = args.indexOf('--set');
  const target = args[idx + 1];
  if (target !== 'full' && target !== 'compact') {
    process.stderr.write('Usage: toggle-statusline.cjs --set <full|compact>\n');
    process.exit(1);
  }
  writeMode(target);
  console.log(`statusline mode → ${target}`);
  process.exit(0);
}

// Default: toggle
const current = readMode();
const next = current === 'compact' ? 'full' : 'compact';
writeMode(next);
console.log(`statusline mode → ${next}  (was: ${current})`);
