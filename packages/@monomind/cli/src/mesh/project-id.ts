import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';

function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Stable, path-safe project id: `<basename>-<16 hex of sha256(realpath)>`. */
export function projectIdFor(projectPath: string): string {
  const real = realOrSelf(projectPath);
  const name =
    basename(real)
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .slice(0, 64) || 'project';
  return `${name}-${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}
