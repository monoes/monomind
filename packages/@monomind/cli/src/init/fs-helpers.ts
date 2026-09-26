/**
 * Filesystem helpers shared by the init write-* modules: atomic and
 * timestamp-stable writes, the conversion-target guard, and tree walkers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InitResult } from './types.js';

/**
 * Atomic write helper — writes to a sibling .tmp file then renames into place.
 * SIGINT or crash during a partial write would otherwise corrupt user-critical
 * files (.claude/settings.json, .mcp.json, helper scripts that Claude Code
 * executes on every hook). Without atomicity a half-written settings.json or
 * a zero-byte hook-handler.cjs disables Claude Code's protections silently.
 */
export function atomicWriteFile(
  target: string,
  content: string | Buffer,
  encoding?: BufferEncoding,
): void {
  const tmp = `${target}.${process.pid}.tmp`;
  if (encoding && typeof content === 'string') {
    fs.writeFileSync(tmp, content, encoding);
  } else if (typeof content === 'string') {
    fs.writeFileSync(tmp, content, 'utf-8');
  } else {
    fs.writeFileSync(tmp, content);
  }
  fs.renameSync(tmp, target);
}

/**
 * The `Generated: <ISO timestamp>` stamp that .monomind/config.yaml and
 * .monomind/CAPABILITIES.md carry, in whatever comment syntax their format
 * uses (`# Generated: …`, `> Generated: …`).
 */
const GENERATED_TIMESTAMP = /(Generated:[^\S\r\n]*)\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

function withoutGeneratedTimestamp(content: string): string {
  return content.replace(GENERATED_TIMESTAMP, '$1<generated>');
}

/**
 * Write a generated file that embeds a `Generated: <ISO timestamp>` line,
 * skipping the write entirely when that stamp is the only thing that would
 * change. Otherwise every `init --force` rewrote these files with a fresh
 * timestamp and left the repository dirty by exactly two files, for
 * information nobody can act on. Skipping the write (rather than reusing the
 * old stamp) keeps the mtime stable too, and the stamp keeps its meaning:
 * when this content was generated.
 */
export function writeGeneratedFile(target: string, content: string): void {
  try {
    const existing = fs.readFileSync(target, 'utf-8');
    if (withoutGeneratedTimestamp(existing) === withoutGeneratedTimestamp(content)) return;
  } catch {
    // No readable file on disk — fall through and write it.
  }
  atomicWriteFile(target, content);
}

/**
 * Guard for the write-opencode.ts / write-kimicode.ts converters, which read
 * `.claude/{agents,commands,skills}` and write the converted result into what
 * is expected to be a separate platform directory (`.opencode/...`,
 * `.kimi-code/...`). If that destination has been symlinked back into
 * `.claude/` (observed live: a committed `.opencode/command -> ../.claude/commands`
 * symlink), the atomic write-then-rename in `atomicWriteFile` resolves through
 * the symlink and lands the converted, flattened, field-injected output
 * straight back in the Claude source tree it was just read from — silently
 * corrupting hand-authored agent/skill/command files and resurrecting
 * "deleted" flattened command duplicates on every `--force` run.
 *
 * Checked once per destination directory (not per file) before its copy loop.
 * Returns false and records one `result.errors` entry when `destDir` resolves
 * inside `claudeDir`; the caller should skip the whole loop rather than write
 * file-by-file into the wrong place. A `destDir` that is itself a symlink to
 * `claudeDir/<mirrorOf>` is a deliberate mirror (this repo links
 * `.opencode/agent -> ../.claude/agents`), so it is skipped without the error.
 */
export function isSafeConversionTarget(
  destDir: string,
  claudeDir: string,
  result: InitResult,
  label: string,
  mirrorOf?: string,
): boolean {
  let realDest: string;
  try {
    realDest = fs.realpathSync(destDir);
  } catch {
    return true; // doesn't exist yet — mkdirSync will create a real directory
  }
  let realClaude: string;
  try {
    realClaude = fs.realpathSync(claudeDir);
  } catch {
    return true; // no .claude/ to collide with
  }
  if (realDest === realClaude || realDest.startsWith(`${realClaude}${path.sep}`)) {
    if (
      mirrorOf !== undefined &&
      fs.lstatSync(destDir).isSymbolicLink() &&
      realDest === path.join(realClaude, mirrorOf)
    ) {
      result.skipped.push(`${label} (symlink to .claude/${mirrorOf})`);
      return false;
    }
    result.errors.push(
      `${label} resolves inside .claude/ (likely a symlink) — skipping to avoid writing converted files back into the Claude source tree. Remove or repoint the symlink and re-run.`,
    );
    return false;
  }
  return true;
}

/** Relative file paths under `dir` (files only). Used by every o-38 mirror
 *  sweep (copySkills's `.gemini`/`.agents`, writeOpencodeFiles's
 *  `.opencode/skills`) to tell "content the source regenerated" from "a file
 *  someone added directly inside the mirror" (o-38 §2·0b). */
export function listFilesRecursive(dir: string): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.add(path.relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

/**
 * Copy directory recursively
 */
export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip exFAT/macOS AppleDouble junk files (e.g. "._foo.js") so they don't
    // get perpetuated into every newly-initialized project.
    if (entry.name.startsWith('._')) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Count files with extension in directory
 */
export function countFiles(dir: string, ext: string): number {
  let count = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (entry.name.endsWith(ext)) {
      count++;
    }
  }

  return count;
}

/** Recursively collect .md files under dir, returned relative to dir. */
export function walkMdFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}${path.sep}${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(d, e.name), rel);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(rel);
    }
  };
  visit(dir, '');
  return out;
}

/** Skip READMEs and other non-definition markdown. */
export function isLikelyUserFile(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  if (base === 'readme.md' || base === 'readme') return false;
  return true;
}

/** Pull the `name:` scalar from a frontmatter block (best-effort). */
export function extractFmName(md: string): string | null {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!m) return null;
  const fm = m[0];
  const nm = fm.match(/^name\s*:\s*(.+?)\s*$/m);
  return nm ? nm[1].replace(/^["']|["']$/g, '') : null;
}
