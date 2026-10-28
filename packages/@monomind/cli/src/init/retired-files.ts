/**
 * Retire single files an older monomind installed that this version no
 * longer ships (#418: monoswarm and autopilot were removed in 2.22.0).
 *
 * The init manifest tracks top-level entries (`commands/monoswarm`), so it
 * cannot see one retired file inside a category directory that still ships
 * (`commands/coordination/monoswarm-init.md`), and a project from before the
 * manifest has no record at all. This works per file instead, from an explicit
 * list, and only touches a file whose content matches a version some release
 * shipped (`retired-files-data.ts`, generated from git history). Such a file
 * is moved to `.monomind/backups/<run>/retired/files/<path>`, like a retired
 * directory. A file that matches no shipped version was edited by the user: it
 * stays, and init warns about it.
 *
 * Still-shipped READMEs whose old versions named the removed commands are
 * rewritten to the current copy, again only when unmodified.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-helpers.js';
import { retireGeneratedEntry } from './init-manifest.js';
import {
  RETIRED_BODY_HASHES,
  RETIRED_FILE_HASHES,
  STALE_README_HASHES,
} from './retired-files-data.js';
import type { InitResult } from './types.js';

/** First 16 hex chars of sha256 over LF-normalised text. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

/** Hash of the text after its YAML frontmatter, trimmed. The Kimi Code and
 *  OpenCode converters rewrite only frontmatter, so an older converter's copy
 *  still carries the shipped body. */
export function bodyHash(text: string): string {
  const normalised = text.replace(/\r\n/g, '\n');
  const body = normalised.replace(/^---\n[\s\S]*?\n---\n?/, '');
  return contentHash(body.trim());
}

const isHelperScript = (rel: string): boolean => /^\.(claude|gemini)\/helpers\//.test(rel);
const DERIVED_TREE = /^\.(kimi-code|opencode|agents|gemini)\//;
const bodyHashes = new Set(RETIRED_BODY_HASHES);

/** Did some release ship exactly this content at `rel`? */
function isShippedCopy(rel: string, text: string): boolean {
  if (RETIRED_FILE_HASHES[rel]?.includes(contentHash(text))) return true;
  return DERIVED_TREE.test(rel) && bodyHashes.has(bodyHash(text));
}

/** Remove `dir` and its now-empty parents, stopping at `stopAt`. */
function removeEmptyDirs(dir: string, stopAt: string): void {
  let current = dir;
  while (current.startsWith(`${stopAt}${path.sep}`) && current !== stopAt) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** Tree a project path lives in (`.claude/commands`, `.kimi-code/plugin/commands`, …). */
function treeRoot(targetDir: string, rel: string): string {
  const segs = rel.split('/');
  return path.join(targetDir, ...segs.slice(0, segs[1] === 'plugin' ? 3 : 2));
}

/**
 * Retire every listed file that still holds shipped content; warn about the
 * edited ones; refresh unmodified stale READMEs from `sourceClaudeDir` (the
 * `.claude` tree init copies from), when given.
 */
export function retireRemovedFiles(
  targetDir: string,
  result: InitResult,
  sourceClaudeDir?: string | null,
): void {
  for (const rel of Object.keys(RETIRED_FILE_HASHES)) {
    const file = path.join(targetDir, rel);
    let text: string;
    try {
      if (!fs.statSync(file).isFile()) continue;
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    if (!isShippedCopy(rel, text)) {
      result.warnings = [
        ...(result.warnings ?? []),
        isHelperScript(rel)
          ? `${rel} is no longer shipped (nothing loads it any more) but you edited it, so it was kept. Delete it unless you still use it.`
          : `${rel} was removed in 2.22.0 (monoswarm/autopilot, #418) but you edited it, so it was kept. It refers to tools that no longer exist: delete it or rewrite it for the Task tool / \`monomind org run\`.`,
      ];
      continue;
    }
    retireGeneratedEntry(targetDir, `files/${rel}`, file, result);
    if (!fs.existsSync(file)) removeEmptyDirs(path.dirname(file), treeRoot(targetDir, rel));
  }

  if (!sourceClaudeDir) return;
  for (const [rel, hashes] of Object.entries(STALE_README_HASHES)) {
    const file = path.join(targetDir, rel);
    const source = path.join(sourceClaudeDir, rel.replace(/^\.claude\//, ''));
    try {
      if (!fs.existsSync(file) || !fs.existsSync(source)) continue;
      const current = fs.readFileSync(file, 'utf-8');
      const shipped = fs.readFileSync(source, 'utf-8');
      if (current === shipped || !hashes.includes(contentHash(current))) continue;
      atomicWriteFile(file, shipped);
      result.updated.push(rel);
    } catch (error) {
      result.errors.push(
        `Could not refresh ${rel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
