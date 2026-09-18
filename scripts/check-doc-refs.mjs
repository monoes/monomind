#!/usr/bin/env node
/**
 * Verifies that source references in `doc/` point at things that still exist.
 *
 * Docs cite source as a markdown link whose target is a repo-relative path with
 * an optional symbol anchor:
 *
 *     [`orgrt/daemon.ts → startOrg`](packages/@monomind/cli/src/orgrt/daemon.ts#startOrg)
 *     [`orgrt/types.ts`](packages/@monomind/cli/src/orgrt/types.ts)
 *
 * Line-number anchors (`#L178`, `#L185-L204`) are rejected: they are correct
 * only for the commit they were written at and silently rot afterwards. A
 * symbol anchor rots loudly instead — renaming or deleting the symbol fails
 * this check.
 *
 * Checks, per reference:
 *   1. the target file exists;
 *   2. a `#Symbol` anchor names a symbol actually defined in that file;
 *   3. the anchor is not a line number.
 *
 * Usage: node scripts/check-doc-refs.mjs [--list] [docRoot]
 *   --list   print every reference with the line its symbol is defined at,
 *            instead of only the failures.
 *   docRoot  directory to scan, default `doc/`. Link targets still resolve
 *            against the repo root.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DOC_ROOT = resolve(REPO_ROOT, args.find((a) => !a.startsWith('--')) ?? 'doc');

/**
 * Review reports are dated snapshots that state the revision they were written
 * against ("Reviewed 5 September 2026 at commit `dd93c65…`"), so their line
 * references are pinned rather than rotting and are left as written.
 */
const FROZEN_DIRS = ['doc/reports'];

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Matches `[label](target#anchor)` and `[label](target)`. */
const LINK_RE = /\[([^\]]*)\]\(([^)\s#]+)(?:#([^)\s]+))?\)/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(md|html)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Line numbers (1-based) at which `name` is defined in `source`.
 *
 * Deliberately a line scan rather than a real parser: the check only has to
 * answer "does this symbol still exist here", and a line scan stays dependency
 * free and handles every language in the repo that docs cite.
 */
function definitionLines(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    // function / class / interface / type / enum / namespace declarations
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|type|enum|namespace)\\s+${escaped}\\b`,
    // const / let / var bindings, including arrow functions
    `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${escaped}\\b`,
    // class members and object-literal methods/properties
    `^\\s{2,}(?:(?:public|private|protected|readonly|static|abstract|override|async|get|set)\\s+)*\\*?${escaped}\\s*[(<:=]`,
    // `export { name }` re-exports
    `^\\s*export\\s*\\{[^}]*\\b${escaped}\\b`,
    // python / go / rust definitions
    `^\\s*(?:def|class)\\s+${escaped}\\b`,
    `^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${escaped}\\b`,
    `^\\s*(?:pub\\s+)?(?:fn|struct|trait|impl|enum)\\s+${escaped}\\b`,
  ];
  const re = new RegExp(patterns.join('|'));
  const hits = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) hits.push(i + 1);
  }
  return hits;
}

function isFrozen(docPath) {
  const rel = relative(REPO_ROOT, docPath);
  return FROZEN_DIRS.some((dir) => rel.startsWith(`${dir}/`));
}

function collect() {
  const refs = [];
  for (const docPath of walk(DOC_ROOT)) {
    const text = readFileSync(docPath, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      LINK_RE.lastIndex = 0;
      let m;
      while ((m = LINK_RE.exec(lines[i]))) {
        const [, label, target, anchor] = m;
        if (/^[a-z]+:/.test(target)) continue; // http:, mailto:, ...
        // `./x` and `../x` are relative to the doc; anything else (including a
        // repo path that merely starts with a dot, like `.gemini/helpers/x`)
        // is relative to the repo root.
        const absolute = /^\.\.?\//.test(target)
          ? resolve(dirname(docPath), target)
          : resolve(REPO_ROOT, target);
        if (!SOURCE_EXTENSIONS.test(target)) continue;
        refs.push({
          docPath,
          docLine: i + 1,
          label,
          target,
          anchor,
          absolute,
          frozen: isFrozen(docPath),
        });
      }
    }
  }
  return refs;
}

function main() {
  const list = args.includes('--list');
  const refs = collect();
  const problems = [];
  const resolved = [];

  for (const ref of refs) {
    if (ref.frozen) continue;
    const where = `${relative(REPO_ROOT, ref.docPath)}:${ref.docLine}`;
    if (ref.anchor && /^L\d+(-L?\d+)?$/.test(ref.anchor)) {
      problems.push(
        `${where}: line-number anchor \`#${ref.anchor}\` in ${ref.target} — cite a symbol (\`#symbolName\`) instead; line numbers go stale on every commit`,
      );
      continue;
    }
    if (!existsSync(ref.absolute)) {
      problems.push(`${where}: missing file ${ref.target}`);
      continue;
    }
    if (!ref.anchor) {
      resolved.push(`${where}: ${ref.target} (whole file)`);
      continue;
    }
    const hits = definitionLines(readFileSync(ref.absolute, 'utf8'), ref.anchor);
    if (hits.length === 0) {
      problems.push(`${where}: ${ref.target} has no definition of \`${ref.anchor}\``);
      continue;
    }
    resolved.push(`${where}: ${ref.target}#${ref.anchor} → L${hits.join(', L')}`);
  }

  if (list) for (const line of resolved) console.log(line);

  const checked = problems.length + resolved.length;
  if (problems.length > 0) {
    console.error(`\ndoc source references: ${problems.length} of ${checked} broken\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('');
    process.exit(1);
  }
  console.log(`doc source references: ${checked} checked, all resolve`);
}

main();
