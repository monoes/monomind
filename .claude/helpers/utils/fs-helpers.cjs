'use strict';
// Shared fs helpers for hook handlers.
//
// exFAT / macOS AppleDouble junk files (`._foo.json`, `.__protocol.md`, etc.)
// get created whenever files touch an exFAT volume (external drives, some
// network shares) and then get picked up by naive `readdirSync().filter(...)`
// calls as if they were real data — corrupting counts, getting parsed as
// JSON and failing, or (worst case) surfacing as garbage entries in
// Claude Code's own skill/command list. Every readdir in the hook handlers
// should route through `cleanEntries()` so this is filtered exactly once.

const fs = require('fs');
const path = require('path');

/**
 * Read a directory and filter out exFAT AppleDouble junk (`._*`) before
 * applying the caller's own filter predicate.
 * @param {string} dir - directory to read
 * @param {(name: string) => boolean} [filterFn] - optional additional filter
 * @returns {string[]} entry names (not full paths), junk-free
 */
function cleanEntries(dir, filterFn) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  entries = entries.filter(f => !f.startsWith('._'));
  return filterFn ? entries.filter(filterFn) : entries;
}

/**
 * Same as cleanEntries but returns full paths.
 */
function cleanEntryPaths(dir, filterFn) {
  return cleanEntries(dir, filterFn).map(f => path.join(dir, f));
}

module.exports = { cleanEntries, cleanEntryPaths };
