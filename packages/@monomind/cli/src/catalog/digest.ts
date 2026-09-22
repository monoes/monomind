import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { CatalogEntry } from './types.js';

export const catalogDir = (root: string): string => join(root, '.monomind', 'catalog');
export const packagesDir = (root: string): string => join(catalogDir(root), 'packages');

function files(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error(`symlink in package: ${rel}`);
    if (e.isDirectory()) out.push(...files(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** sha256 over (u32 pathLen, path, u64 byteLen, bytes) for every file, paths sorted by code unit. */
export function packageDigest(dir: string): string {
  const h = createHash('sha256');
  for (const rel of files(dir).sort()) {
    const bytes = readFileSync(join(dir, rel));
    const p = Buffer.from(rel, 'utf8');
    const lens = Buffer.alloc(12);
    lens.writeUInt32BE(p.length, 0);
    lens.writeBigUInt64BE(BigInt(bytes.length), 4);
    h.update(lens.subarray(0, 4)).update(p).update(lens.subarray(4)).update(bytes);
  }
  return h.digest('hex');
}

/** `<packages>/<name>/<sha12>`, proven to stay inside the store after realpath. */
export function resolvePackageDir(
  root: string,
  entry: Pick<CatalogEntry, 'id' | 'sha256'>,
): string {
  const store = realpathSync(packagesDir(root));
  const name = entry.id.split(':')[1] ?? '';
  const dir = realpathSync(join(store, name, entry.sha256.slice(0, 12)));
  const rel = relative(store, dir);
  if (rel.startsWith('..') || rel.includes(`..${sep}`) || lstatSync(dir).isSymbolicLink())
    throw new Error(`package path escapes the store: ${entry.id}`);
  return dir;
}

export type DigestCheck =
  | { ok: true; dir: string }
  | { ok: false; reason: 'missing-package' | 'digest-mismatch' | 'escaping-path' };

export function verifyEntry(root: string, entry: Pick<CatalogEntry, 'id' | 'sha256'>): DigestCheck {
  let dir: string;
  try {
    dir = resolvePackageDir(root, entry);
  } catch (e) {
    return {
      ok: false,
      reason: String(e).includes('escapes') ? 'escaping-path' : 'missing-package',
    };
  }
  try {
    return packageDigest(dir) === entry.sha256
      ? { ok: true, dir }
      : { ok: false, reason: 'digest-mismatch' };
  } catch {
    return { ok: false, reason: 'digest-mismatch' };
  }
}
