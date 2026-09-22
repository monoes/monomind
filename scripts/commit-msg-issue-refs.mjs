#!/usr/bin/env node
/**
 * commit-msg advisory: an issue referenced as `(#310)` stays open after the
 * fix lands, because only a closing keyword (`Fixes #310`) closes it. Issues
 * left open that way cost later agents hours rediscovering finished work.
 *
 * Prints one suggestion per `#N` that no closing keyword covers. Advisory
 * only — a commit may legitimately mention an issue without resolving it —
 * so the CLI always exits 0. Dependency-free; called from .githooks/commit-msg.
 *
 * Usage: node scripts/commit-msg-issue-refs.mjs <commit-msg-file>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEYWORD = String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+`;
const CLOSED_BY_REF = new RegExp(`${KEYWORD}#(\\d+)\\b`, 'gi');
const CLOSED_BY_URL = new RegExp(
  `${KEYWORD}https?://github\\.com/[^\\s/]+/[^\\s/]+/issues/(\\d+)\\b`,
  'gi',
);
const URL = /\bhttps?:\/\/\S+/g;
// `#N` not glued to a word, path or entity (so `owner/repo#N`, `a#1` and
// `&#39;` are not same-repo issue references).
const REF = /(?<![\w/&#])#(\d+)\b/g;
const SKIP_SUBJECT = /^(?:Merge |Revert |fixup! |squash! |amend! )/;
const SCISSORS = /^# -+ >8 -+$/m;

/** Drop git's comment lines (`# ...`) and the verbose diff below the scissors. */
function stripGitComments(message) {
  const cut = message.search(SCISSORS);
  const body = cut === -1 ? message : message.slice(0, cut);
  return body
    .split('\n')
    .filter((line) => !/^#(?:\s|$)/.test(line))
    .join('\n');
}

/**
 * @param {string} message raw commit message
 * @returns {string[]} one suggestion line per unclosed issue, in order of first mention
 */
export function suggestClosingKeywords(message) {
  const text = stripGitComments(message);
  if (SKIP_SUBJECT.test(text.trimStart())) return [];

  const closed = new Set();
  for (const re of [CLOSED_BY_REF, CLOSED_BY_URL]) {
    for (const m of text.matchAll(re)) closed.add(m[1]);
  }

  const open = new Set();
  for (const m of text.replace(URL, ' ').matchAll(REF)) {
    if (!closed.has(m[1])) open.add(m[1]);
  }

  return [...open].map(
    (n) =>
      `[commit-msg] #${n} is referenced but not closed — add "Fixes #${n}" to the body if this commit resolves it`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    for (const line of suggestClosingKeywords(readFileSync(process.argv[2], 'utf8'))) {
      console.log(line);
    }
  } catch {
    // Advisory check: never block or noise up a commit over our own failure.
  }
  process.exit(0);
}
