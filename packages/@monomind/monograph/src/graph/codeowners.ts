import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import type Database from 'better-sqlite3';

export interface CodeownersEntry {
  pattern: string;
  owners: string[];
}

export interface OwnershipResult {
  filePath: string;
  declaredOwners: string[];
  unowned: boolean;
}

// Convert a CODEOWNERS glob pattern to a RegExp
function globToRegex(pattern: string): RegExp {
  // Strip leading slash (anchors to root — handle separately)
  const anchored = pattern.startsWith('/');
  let p = pattern;
  if (anchored) p = p.slice(1);

  // Trailing slash: match directory and everything beneath it
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  // Escape special regex chars except * and ?
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // ** → match anything (including slashes)
  p = p.replace(/\*\*/g, '§DOUBLESTAR§');
  // * → match anything except slash
  p = p.replace(/\*/g, '[^/]*');
  // ? → match any single char except slash
  p = p.replace(/\?/g, '[^/]');
  // Restore **
  p = p.replace(/§DOUBLESTAR§/g, '.*');

  let regexStr: string;
  if (anchored) {
    // Anchored to repo root
    if (dirOnly) {
      regexStr = `^${p}(/|$)`;
    } else if (p.includes('/')) {
      // has slash → match full path from root
      regexStr = `^${p}(/.*)?$`;
    } else {
      regexStr = `^${p}(/.*)?$`;
    }
  } else if (p.includes('/')) {
    // Contains slash but not anchored → match from root
    regexStr = `(^|/)${p}(/.*)?$`;
  } else {
    // No slash → match filename anywhere in tree
    if (dirOnly) {
      regexStr = `(^|/)${p}(/|$)`;
    } else {
      regexStr = `(^|/)${p}(/.*)?$`;
    }
  }

  return new RegExp(regexStr);
}

// Parse CODEOWNERS from repoRoot/.github/CODEOWNERS, repoRoot/CODEOWNERS, or repoRoot/docs/CODEOWNERS
// Last matching rule wins (GitHub semantics)
export function parseCodeowners(repoRoot: string): CodeownersEntry[] {
  const candidates = [
    join(repoRoot, '.github', 'CODEOWNERS'),
    join(repoRoot, 'CODEOWNERS'),
    join(repoRoot, 'docs', 'CODEOWNERS'),
  ];

  let content: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      content = readFileSync(candidate, 'utf-8');
      break;
    }
  }

  if (!content) return [];

  const entries: CodeownersEntry[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).filter(o => o.startsWith('@') || o.includes('@'));

    if (pattern) {
      entries.push({ pattern, owners });
    }
  }

  return entries;
}

// Resolve owner for a single file path (relative to repoRoot)
// Last matching entry wins
export function resolveOwner(entries: CodeownersEntry[], filePath: string): string[] {
  // Normalize path to use forward slashes, remove leading ./
  const normalised = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  let lastMatch: CodeownersEntry | null = null;
  for (const entry of entries) {
    const regex = globToRegex(entry.pattern);
    if (regex.test(normalised)) {
      lastMatch = entry;
    }
  }

  return lastMatch ? lastMatch.owners : [];
}

// Annotate all File nodes in the DB with their owners (stored in properties.codeowners)
export function annotateOwnership(
  db: Database.Database,
  repoRoot: string,
): { annotated: number; unowned: number } {
  const entries = parseCodeowners(repoRoot);
  const fileNodes = db
    .prepare(`SELECT id, file_path, properties FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`)
    .all() as { id: string; file_path: string; properties: string | null }[];

  let annotated = 0;
  let unowned = 0;

  const update = db.prepare(`UPDATE nodes SET properties = ? WHERE id = ?`);

  const updateAll = db.transaction(() => {
    for (const node of fileNodes) {
      const relPath = relative(repoRoot, node.file_path).replace(/\\/g, '/');
      const owners = resolveOwner(entries, relPath);
      const existing = node.properties ? JSON.parse(node.properties) : {};
      const updated = { ...existing, codeowners: owners };
      update.run(JSON.stringify(updated), node.id);

      if (owners.length > 0) {
        annotated++;
      } else {
        unowned++;
      }
    }
  });

  updateAll();

  return { annotated, unowned };
}

// Group a list of findings by owner
// Findings with no filePath or no matching pattern bucket under 'unowned'
// If a file has multiple owners, the finding appears under each owner key
export function groupByOwner<T extends { filePath?: string | null }>(
  findings: T[],
  entries: CodeownersEntry[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();

  for (const finding of findings) {
    if (!finding.filePath) {
      const bucket = result.get('unowned') ?? [];
      bucket.push(finding);
      result.set('unowned', bucket);
      continue;
    }

    const owners = resolveOwner(entries, finding.filePath);
    if (owners.length === 0) {
      const bucket = result.get('unowned') ?? [];
      bucket.push(finding);
      result.set('unowned', bucket);
    } else {
      for (const owner of owners) {
        const bucket = result.get(owner) ?? [];
        bucket.push(finding);
        result.set(owner, bucket);
      }
    }
  }

  return result;
}
