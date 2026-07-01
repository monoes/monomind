'use strict';
const fs = require('fs');
const path = require('path');

// Walk up from cwd to find the project root containing master.md
function findMasterPath() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) candidates.push(process.env.CLAUDE_PROJECT_DIR);
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of candidates) {
    const p = path.join(base, '.claude', 'commands', 'mastermind', 'master.md');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Extract only the MASTERMIND PROTOCOL section (before the capability menu / execution flow).
// The protocol section ends at the separator before "**If $ARGUMENTS is empty:**"
function extractProtocol(content) {
  const marker = '\n---\n\n**If $ARGUMENTS is empty:**';
  const idx = content.indexOf(marker);
  if (idx !== -1) return content.slice(0, idx).trim();
  // Fallback: everything before the capability menu header
  const fallback = content.indexOf('\n**MASTERMIND** —');
  if (fallback !== -1) return content.slice(0, fallback).trim();
  return content.trim();
}

const masterPath = findMasterPath();
if (!masterPath) {
  process.stderr.write('[mastermind-activate] master.md not found — skipping injection\n');
  process.exit(0);
}

let raw;
try {
  raw = fs.readFileSync(masterPath, 'utf8');
} catch (e) {
  process.stderr.write('[mastermind-activate] Could not read master.md: ' + e.message + '\n');
  process.exit(0);
}

// Strip YAML frontmatter
const body = raw.replace(/^---[\s\S]*?---\s*/, '');
const protocol = extractProtocol(body);

process.stdout.write(protocol + '\n');
