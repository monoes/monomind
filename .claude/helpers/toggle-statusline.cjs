#!/usr/bin/env node
'use strict';
/**
 * toggle-statusline.cjs — Toggle or set the monomind statusline display mode.
 *
 * Modes:  full | compact
 * Storage: $CLAUDE_PROJECT_DIR/.monomind/statusline-mode.txt
 *
 * Usage:
 *   node toggle-statusline.cjs              # toggle current mode
 *   node toggle-statusline.cjs --get        # print current mode
 *   node toggle-statusline.cjs --set <mode> # set mode (full|compact)
 */

const fs = require('fs');
const path = require('path');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MODE_FILE = path.join(CWD, '.monomind', 'statusline-mode.txt');
const VALID_MODES = ['full', 'compact'];

function ensureDir() {
  try { fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true }); } catch (_) {}
}

function readMode() {
  try {
    if (!fs.existsSync(MODE_FILE)) return 'full';
    var val = fs.readFileSync(MODE_FILE, 'utf-8').trim();
    return VALID_MODES.includes(val) ? val : 'full';
  } catch (_) {
    return 'full';
  }
}

function writeMode(mode) {
  ensureDir();
  fs.writeFileSync(MODE_FILE, mode, 'utf-8');
}

function printUsage() {
  process.stderr.write(
    'Usage: toggle-statusline.cjs [--get | --set <full|compact>]\n' +
    '  (no args)        toggle between full and compact\n' +
    '  --get            print current mode\n' +
    '  --set <mode>     set mode to full or compact\n'
  );
}

var args = process.argv.slice(2);

if (args[0] === '--get') {
  process.stdout.write(readMode() + '\n');
  process.exit(0);
}

if (args[0] === '--set') {
  var newMode = args[1];
  if (!newMode || !VALID_MODES.includes(newMode)) {
    printUsage();
    process.exit(1);
  }
  writeMode(newMode);
  process.stdout.write('statusline mode → ' + newMode + '\n');
  process.exit(0);
}

// No args: toggle
var current = readMode();
var toggled = current === 'full' ? 'compact' : 'full';
writeMode(toggled);
process.stdout.write('statusline mode → ' + toggled + '  (was: ' + current + ')\n');
process.exit(0);
